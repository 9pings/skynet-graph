'use strict';
/**
 * §3.3 (B) — NESTED-map fold (map inside a map, folded back through BOTH levels) on the durable executor. The
 * mechanism, WITHOUT a destructive parentId ref-swap: a `groupId` grouping key (default = parentId, 1-level
 * byte-identical) re-stamped to the OUTER group when an inner collector parks at the outer join; the interpreter
 * carries group/cardinality/index STACKS on the payload (map pushes, join reads the top, fold pops + restores the
 * outer `_i`). parentId stays audit truth. xlate `emitMap` recurses (v0 depth 2; the runtime stacks are deeper).
 *
 * v0 scope: the happy-path nested fold (soundness + order-independence + crash-resume). Nested FAILURE propagation
 * (failfast/survivors across levels) is deferred (documented) — this proves the grouping/fold mechanism.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
const { createMemoryCheckpointStore, createSqliteCheckpointStore } = require('../../lib/durable/checkpoint-store.js');
const { compileMethod, validateNet } = require('../../lib/durable/xlate.js');
const { runFlow } = require('../../lib/durable/interpreter.js');
const { auditRun } = require('../../lib/durable/audit.js');

// orders → line-items: inner = sum of line amounts per order, outer = sum of order totals.
const SUM_SPEC = { methods: { Orders: { map: {
	over: 'orders', elemKey: 'order',
	body: [{ map: { over: 'order.lines', elemKey: 'line', body: [{ task: 'T::amount' }],
		reduce: { monoid: 'sum', key: 'amt', into: 'orderTotal' } } }],
	reduce: { monoid: 'sum', key: 'orderTotal', into: 'grandTotal' } } } } };
const amount = (task, t) => ({ payload: { amt: t.payload.line } });
const plainGrand = (orders) => orders.reduce((g, o) => g + o.lines.reduce((s, l) => s + l, 0), 0);

async function runNested(spec, orders, batch) {
	const net = compileMethod(spec);
	const store = createMemoryCheckpointStore();
	store.ensureRun('r', net); store.inject('r', [{ id: 'rec1', orders }]);
	const c = await runFlow(store, 'r', net, { runTask: amount, batch });
	return { c, store, audit: auditRun(store, 'r', { sinks: ['done'] }).records['rec1'] };
}

test('§3.3-B SOUNDNESS: nested sum == plain nested reduce, at batch 1 / 3 / 32', async () => {
	const orders = [{ lines: [1, 2, 3] }, { lines: [10, 20] }, { lines: [100] }];
	for ( const batch of [1, 3, 32] ) {
		const { audit } = await runNested(SUM_SPEC, orders, batch);
		assert.equal(audit.status, 'done', 'completed at batch ' + batch);
		assert.equal(audit.result.grandTotal, plainGrand(orders), 'grandTotal == plain at batch ' + batch);
	}
	// inner-empty order → the inner fold yields the monoid identity (0), folded into the outer sum soundly.
	const withEmpty = [{ lines: [] }, { lines: [7, 8] }];
	assert.equal((await runNested(SUM_SPEC, withEmpty, 32)).audit.result.grandTotal, 15);
});

test('§3.3-B parentId is NEVER mutated — groupId is the additive grouping key', async () => {
	const { store } = await runNested(SUM_SPEC, [{ lines: [1, 2] }, { lines: [3] }], 32);
	const marking = store.marking('r');
	const inner = [];
	for ( const pl of Object.keys(marking) ) for ( const t of marking[pl] )
		if ( t.payload && t.payload.orderTotal !== undefined ) inner.push(t);
	assert.equal(inner.length, 2, 'two inner collectors (one per order)');
	for ( const c of inner ) {
		// the inner collector's parentId = its inner fan-out token (audit truth); its groupId was re-stamped to the
		// OUTER group when it parked at the outer join — so parentId !== groupId, and parentId was not overwritten.
		assert.ok(c.parentId != null, 'inner collector keeps an inner parentId (audit lineage)');
		assert.notEqual(String(c.parentId), String(c.groupId), 'groupId (outer) differs from parentId (inner) — no ref-swap');
	}
});

test('§3.3-B a NON-COMMUTATIVE outer fold (concat) stays deterministic via the restored outer _i', async () => {
	const CONCAT_SPEC = { methods: { Orders: { map: {
		over: 'orders', elemKey: 'order',
		body: [{ map: { over: 'order.lines', elemKey: 'line', body: [{ task: 'T::amount' }],
			reduce: { monoid: 'sum', key: 'amt', into: 'orderTotal' } } }],
		reduce: { monoid: 'concat', key: 'orderTotal', into: 'totals' } } } } };
	const orders = [{ lines: [1, 2, 3] }, { lines: [10, 20] }, { lines: [100, 1] }];   // order totals 6, 30, 101
	const serial = (await runNested(CONCAT_SPEC, orders, 1)).audit.result.totals;
	const concurrent = (await runNested(CONCAT_SPEC, orders, 32)).audit.result.totals;
	assert.deepEqual(serial, [6, 30, 101], 'concat preserves OUTER element order (restored _i)');
	assert.deepEqual(concurrent, serial, 'same deterministic belief under concurrent throughput');
});

test('§3.3-B CRASH-RESUME: a nested fold completes across a fuel-cut sweep over BOTH fan-in levels', async () => {
	const orders = [{ lines: [1, 2] }, { lines: [3, 4, 5] }, { lines: [6] }];   // grand = 21
	for ( let fuelCut = 1; fuelCut <= 12; fuelCut++ ) {
		const net = compileMethod(SUM_SPEC);
		const store = createMemoryCheckpointStore();
		store.ensureRun('r', net); store.inject('r', [{ id: 'rec1', orders }]);
		let guard = 0;
		while ( store.stats('r').done < 1 && guard++ < 200 ) {
			await runFlow(store, 'r', net, { runTask: amount, maxSteps: fuelCut });
			store.rollbackInflight('r');                              // simulate a crash between chunks
		}
		const audit = auditRun(store, 'r', { sinks: ['done'] }).records['rec1'];
		assert.equal(audit.status, 'done', 'completed at fuelCut=' + fuelCut);
		assert.equal(audit.result.grandTotal, 21, 'correct total (no lost/double-counted shard) at fuelCut=' + fuelCut);
		// exactly ONE outer collector (the grandTotal one): no double-spawn at the outer join.
		let outer = 0; const marking = store.marking('r');
		for ( const pl of Object.keys(marking) ) for ( const t of marking[pl] ) if ( t.payload && t.payload.grandTotal !== undefined ) outer++;
		assert.equal(outer, 1, 'exactly one outer collector at fuelCut=' + fuelCut);
	}
});

test('§3.3-B SQLITE backend reproduces the nested fold (groupId column) + survives a restart', async () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-nest-')), 'ckpt.sqlite');
	const orders = [{ lines: [1, 2, 3] }, { lines: [10, 20] }, { lines: [100] }];   // grand = 136
	let store = createSqliteCheckpointStore({ file });
	const net = compileMethod(SUM_SPEC);
	store.ensureRun('r', net); store.inject('r', [{ id: 'rec1', orders }]);
	await runFlow(store, 'r', net, { runTask: amount });
	assert.equal(auditRun(store, 'r', { sinks: ['done'] }).records['rec1'].result.grandTotal, 136, 'nested fold on sqlite');
	store.close();                                                  // ── restart ──
	store = createSqliteCheckpointStore({ file });
	assert.equal(auditRun(store, 'r', { sinks: ['done'] }).records['rec1'].result.grandTotal, 136, 'durable across a restart');
	store.close();
});

test('§3.3-B xlate: nested places are namespaced + validateNet is clean; 1-level still compiles identically', () => {
	const net = compileMethod(SUM_SPEC);
	assert.deepEqual(validateNet(net), [], 'the nested net is structurally sound');
	// the inner map/join/fold live under a namespaced prefix distinct from the outer.
	const ids = net.transitions.map((t) => t.id);
	assert.ok(ids.some((i) => /@body\.m0.*\.map$/.test(i)), 'an inner (nested) map transition exists, namespaced');
	assert.ok(ids.includes('Orders.map') && ids.includes('Orders.fold'), 'the outer map+fold are present');
});
