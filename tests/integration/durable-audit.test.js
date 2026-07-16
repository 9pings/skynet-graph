'use strict';
/**
 * C-AUDIT — the durable executor's inspection surface (design §8, "a headline win with no owner"). The
 * auditability the conception sells over opaque CBR/RAG: reconstruct the DERIVATION FOREST (token lineage), a
 * per-record VERDICT (done/failed/pending + the result), and WHY a record failed (blame traceable to the exact
 * step). Read-only over the marking. Negative controls included.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryCheckpointStore } = require('../../plugins/durable/lib/checkpoint-store.js');
const { compileMethod } = require('../../plugins/durable/lib/xlate.js');
const { runFlow } = require('../../plugins/durable/lib/interpreter.js');
const { auditRun, auditSummary } = require('../../plugins/durable/lib/audit.js');

// a guarded map-reduce: score each element (score∈[0,100]) → sum. An out-of-range element fail-fasts the group.
const net = compileMethod({ methods: { agg: { map: { over: 'items', elemKey: 'n',
	body: [{ task: 'T::score', contract: { write: ['score'], post: ['score>=0 && score<=100'], effect: 'pure' } }],
	reduce: { monoid: 'sum', key: 'score', into: 'total' } } } } });

async function runStream() {
	const store = createMemoryCheckpointStore(); store.ensureRun('r', net);
	store.inject('r', [{ id: 'good', items: [10, 20, 30] }, { id: 'bad', items: [10, 999, 30] }]);
	await runFlow(store, 'r', net, { runTask: ( task, t ) => ({ payload: { score: t.payload.n } }), keyOf: ( tr, t ) => 'g:' + t.payload.n });
	return auditRun(store, 'r');
}

test('auditRun reconstructs the derivation forest + per-record verdict + the result', async () => {
	const a = await runStream();
	assert.equal(a.totals.records, 2);
	assert.equal(a.totals.done, 1);
	assert.equal(a.totals.failed, 1);
	// the SOUND record: done, fanned out + folded, the correct total
	const good = a.records.good;
	assert.equal(good.status, 'done');
	assert.equal(good.fannedOut, true, 'the map fan-out is visible in the lineage');
	assert.equal(good.folded, true, 'the fold-back collector reached a sink');
	assert.equal(good.result.total, 60, 'the audited result is the correct fold');
	// the lineage is the parentId forest: a consumed root (the map source) + 3 done leaves... actually the leaves
	// park as `joined` and ONE collector reaches done — assert the forest shape
	assert.ok(good.lineage.some(( l ) => l.status === 'consumed' ), 'the map source was consumed (fan-out)');
	assert.ok(good.lineage.filter(( l ) => l.status === 'joined' ).length === 3, 'three contributions parked (the fan-in inputs, retained for audit)');
	assert.ok(good.lineage.some(( l ) => l.status === 'done' && l.place === 'done' ), 'one collector reached the sink');
});

test('auditRun explains WHY a record failed (blame traceable to the exact step) — and totals collect it', async () => {
	const a = await runStream();
	const bad = a.records.bad;
	assert.equal(bad.status, 'failed', 'the out-of-range record failed');
	assert.match(bad.blame, /contract:post-violated/, 'the blame names the contract that fell (auditable WHY)');
	// the fail-fast forest: the source consumed, then the failed children (the violator + its fail-fasted siblings)
	assert.ok(bad.lineage.some(( l ) => l.status === 'consumed' ), 'the map source consumed');
	assert.equal(bad.lineage.filter(( l ) => l.status === 'failed' ).length, 3, 'the violator + 2 fail-fasted siblings');
	assert.equal(bad.result, undefined, 'no result for a failed record (negative control: nothing fabricated)');
	// run totals collect the blame for the run-level audit
	assert.equal(a.totals.blames.length, 1);
	assert.equal(a.totals.blames[0].recordId, 'bad');
});

test('auditSummary renders a compact one-line-per-record trace', async () => {
	const a = await runStream();
	const s = auditSummary(a);
	assert.match(s, /good: done \(map→fold\)/, 'the sound record is summarized as a folded map');
	assert.match(s, /bad: failed \(map\) — contract:post-violated/, 'the failed record shows its blame inline');
});
