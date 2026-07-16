'use strict';
/**
 * §3.3 (A2) — FOLD-SURVIVORS on the durable executor: a `survivors`-mode map-reduce DROPS a failed shard and folds
 * the rest + an explicit `_partial`/`_dropped` marker (never a silently-wrong partial). The ONE Layer-A add is
 * `joinFail` + `joinArrive({mode})`; the interpreter's C-fail ladder terminal routes a reducing-child failure to
 * joinFail (survivors) vs failGroup (failfast); xlate emits the `onFail` stamp + a REQUIRED `reduce.then`
 * completeness gate (a HARD lint forbids a survivors fold routing straight to a sink); audit reports done(partial).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
const { createMemoryCheckpointStore, createSqliteCheckpointStore } = require('../../plugins/durable/lib/checkpoint-store.js');
const { compileMethod } = require('../../plugins/durable/lib/xlate.js');
const { runFlow } = require('../../plugins/durable/lib/interpreter.js');
const { auditRun } = require('../../plugins/durable/lib/audit.js');

const spec = (onFail) => ({ methods: { M: { map: { over: 'items', elemKey: 'it', body: [{ task: 'T::proc' }],
	reduce: { monoid: 'sum', key: 'v', into: 'total', onFail, then: [{ task: null }] } } } } });
// a body task that processes an element, but THROWS on the poison value 'bad'.
const runTask = (task, t) => { if (t.payload.it === 'bad') throw new Error('bad-elem'); return { payload: { v: t.payload.it } }; };

async function runOnce(store, onFail, items) {
	const net = compileMethod(spec(onFail));
	store.ensureRun('r', net); store.inject('r', [{ id: 'rec1', items }]);
	const c = await runFlow(store, 'r', net, { runTask });
	return { c, st: store.stats('r'), audit: auditRun(store, 'r', { sinks: ['done'] }).records['rec1'] };
}
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-surv-')), 'ckpt.sqlite');

test('§3.3-A2 SURVIVORS folds over the good shards + a _partial marker; a dropped shard does NOT fail the record', async () => {
	const { st, audit } = await runOnce(createMemoryCheckpointStore(), 'survivors', [1, 2, 'bad', 4]);
	assert.equal(audit.status, 'done', 'the record completed (not failed) despite one bad shard');
	assert.equal(audit.partial, true, 'flagged partial');
	assert.equal(audit.dropped, 1, 'exactly one shard dropped');
	assert.equal(audit.result.total, 7, 'folded the survivors 1+2+4 = 7 (the bad shard excluded)');
	assert.equal(audit.result._partial, true, 'the completeness marker travels WITH the value');
	assert.equal(st.failed, 1, 'the dropped shard is a FAILED token (audit-visible), not lost');
});

test('§3.3-A2 all-good: not partial, the full fold', async () => {
	const { audit } = await runOnce(createMemoryCheckpointStore(), 'survivors', [1, 2, 3, 4]);
	assert.equal(audit.status, 'done');
	assert.equal(audit.partial, false);
	assert.equal(audit.result.total, 10);
});

test('§3.3-A2 all-bad: the collector folds the empty survivor set to the monoid IDENTITY, partial, dropped=all', async () => {
	const { audit } = await runOnce(createMemoryCheckpointStore(), 'survivors', ['bad', 'bad', 'bad']);
	assert.equal(audit.status, 'done');
	assert.equal(audit.partial, true);
	assert.equal(audit.dropped, 3);
	assert.equal(audit.result.total, 0, 'sum identity over no survivors');
});

test('§3.3-A2 REGRESSION: failfast (the default) still fails the WHOLE group on one bad shard', async () => {
	const ff = await runOnce(createMemoryCheckpointStore(), 'failfast', [1, 2, 'bad', 4]);
	assert.equal(ff.audit.status, 'failed', 'failfast quarantines the record');
	assert.equal(ff.audit.partial, false);
	const def = await runOnce(createMemoryCheckpointStore(), undefined, [1, 2, 'bad', 4]);
	assert.equal(def.audit.status, 'failed', 'default = failfast');
});

test('§3.3-A2 LINT: a survivors fold MUST be followed by a completeness gate (no silent partial)', () => {
	assert.throws(() => compileMethod({ methods: { M: { map: { over: 'items', body: [{ task: 'T::p' }],
		reduce: { monoid: 'sum', onFail: 'survivors' } } } } }), /survivors.*completeness gate/, 'no `then` → HARD compile error');
	assert.doesNotThrow(() => compileMethod(spec('survivors')), 'with `reduce.then` it compiles');
	assert.doesNotThrow(() => compileMethod({ methods: { M: { map: { over: 'items', body: [{ task: 'T::p' }],
		reduce: { monoid: 'sum' } } } } }), 'a failfast fold to a sink is fine (no partial risk)');
});

test('§3.3-A2 SQLITE backend reproduces survivors (cross-backend contract) + cross-restart replay', async () => {
	const file = tmpFile();
	let store = createSqliteCheckpointStore({ file });
	const { audit } = await runOnce(store, 'survivors', [1, 2, 'bad', 4]);
	assert.equal(audit.status, 'done'); assert.equal(audit.partial, true); assert.equal(audit.dropped, 1); assert.equal(audit.result.total, 7);
	store.close();                                                   // ── restart ──
	store = createSqliteCheckpointStore({ file });
	const a2 = auditRun(store, 'r', { sinks: ['done'] }).records['rec1'];
	assert.equal(a2.status, 'done'); assert.equal(a2.partial, true); assert.equal(a2.result.total, 7, 'the partial fold is durable across a restart');
	store.close();
});

test('§3.3-A2 CRASH-RESUME: survivors completes across a fuel-cut sweep — no double collector, stable totals', async () => {
	for ( let fuelCut = 1; fuelCut <= 8; fuelCut++ ) {
		const net = compileMethod(spec('survivors'));
		const store = createMemoryCheckpointStore();
		store.ensureRun('r', net); store.inject('r', [{ id: 'rec1', items: [1, 2, 'bad', 4, 'bad', 6] }]);
		let guard = 0;
		while ( (store.stats('r').done) < 1 && guard++ < 80 ) {
			await runFlow(store, 'r', net, { runTask, maxSteps: fuelCut });
			store.rollbackInflight('r');                              // simulate a crash between chunks
		}
		const audit = auditRun(store, 'r', { sinks: ['done'] }).records['rec1'];
		assert.equal(audit.status, 'done', 'completed at fuelCut=' + fuelCut);
		assert.equal(audit.partial, true);
		assert.equal(audit.dropped, 2, 'both bad shards dropped, none double-counted at fuelCut=' + fuelCut);
		assert.equal(audit.result.total, 13, '1+2+4+6 survivors at fuelCut=' + fuelCut);
		// exactly ONE collector reached done (no double-spawn): the done tokens that are fold collectors.
		const dones = []; const marking = store.marking('r');
		for ( const pl of Object.keys(marking) ) for ( const t of marking[pl] ) if ( t.status === 'done' ) dones.push(t);
		assert.equal(dones.filter((t) => t.payload && t.payload._partial !== undefined).length, 1, 'exactly one survivors collector at fuelCut=' + fuelCut);
	}
});

test('§3.3-A2 Layer-A joinFail: completes at joined+failed==expected, ONE collector, not before', () => {
	// drive the store directly: 3 siblings of a group; one joins, one drops (joinFail), the group is NOT complete;
	// the third joins → complete over the 2 survivors. Mirrors the _checkpoint-suite style.
	const store = createMemoryCheckpointStore();
	const net = { start: 'b', sinks: ['fold'], fail: 'failed', transitions: [] };
	store.ensureRun('run', net);
	// fan out 3 children of a parent by injecting a parent, LEASING it (move requires the lease holder), then 1->N.
	store.inject('run', [{ id: 'p' }]);
	const [parent] = store.claim('run', { limit: 1 });
	store.move(parent, ['b', 'b', 'b'], { payloads: [{ _i: 0, v: 1 }, { _i: 1, v: 2 }, { _i: 2, v: 3 }] });
	const claim1 = store.claim('run', { limit: 3 });                  // lease all three to fire joins/fails
	const byId = Object.fromEntries(claim1.map((t) => [t.payload._i, t]));
	const j = { expected: 3, foldPlace: 'fold', failPlace: 'failed', mode: 'survivors' };
	const r0 = store.joinArrive(byId[0], 'join', j);                  assert.equal(r0.ready, false, 'one joined, not complete');
	const r1 = store.joinFail(byId[1], 'join', j);                    assert.equal(!!r1.ready, false, 'one joined + one dropped, still not complete (2/3)');
	const r2 = store.joinArrive(byId[2], 'join', j);                  // 2 joined + 1 dropped = 3 accounted → complete
	assert.equal(r2.ready, true, 'completes once all 3 are accounted for');
	assert.equal(r2.partial, true, 'a drop happened → partial');
	assert.equal(r2.collector.payload._dropped, 1);
	assert.deepEqual(r2.collector.payload._siblings.map((s) => s.v).sort(), [1, 3], 'collector carries the 2 survivors, not the dropped one');
});
