'use strict';
/**
 * worker-pool (roadmap P3, ex invoke-pool) — the warm method-dispatch pool keyed by contract: N invokes of the
 * same key reuse ONE warm worker (never one sub-graph per case), STATELESS-PER-INVOKE (each invoke stabilizes a
 * fresh graph from its seed → no cross-invoke state). ZERO-CORE host orchestration over createGraphWorker.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { makeSegmentProxy } = require('../../plugins/planner/lib/segment-proxy.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
console.log = console.info = console.warn = () => {};

const METHOD_TREE = { common: { childConcepts: {
	Hot: { _id: 'Hot', _name: 'Hot', require: ['Segment'], ensure: ['$originNode:temp >= 100'] },
} } };
const OTHER_TREE = { common: { childConcepts: {
	Cold: { _id: 'Cold', _name: 'Cold', require: ['Segment'], ensure: ['$originNode:temp < 100'] },
} } };
const seed = ( temp ) => ({ lastRev: 0,
	nodes: [ { _id: 'IN', Node: true, temp: temp }, { _id: 'OUT', Node: true } ],
	segments: [ { _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' } ] });

test('N invokes of the same key → ONE warm instance, reused, correct each time', async () => {
	const pool = Graph.createWorkerPool();
	try {
		const a = await pool.invoke('hot', { conceptMap: METHOD_TREE, seed: seed(120), boundedFrom: 's', boundedKeys: ['Hot'] });
		const b = await pool.invoke('hot', { conceptMap: METHOD_TREE, seed: seed(130), boundedFrom: 's', boundedKeys: ['Hot'] });
		const c = await pool.invoke('hot', { conceptMap: METHOD_TREE, seed: seed(140), boundedFrom: 's', boundedKeys: ['Hot'] });
		assert.deepEqual([a.summary, b.summary, c.summary], [{ Hot: true }, { Hot: true }, { Hot: true }], 'each invoke correct');
		assert.equal(pool.size(), 1, 'N cases → 1 instance (the worker was reused, not respawned)');
		assert.equal(pool.stats().uses, 3, 'three invokes on the one warm instance');
	} finally { await pool.close(); }
});

test('STATELESS-PER-INVOKE — a reused warm worker carries NO cross-invoke graph state', async () => {
	const pool = Graph.createWorkerPool();
	try {
		const hot = await pool.invoke('hot', { conceptMap: METHOD_TREE, seed: seed(120), boundedFrom: 's', boundedKeys: ['Hot'] });
		const cold = await pool.invoke('hot', { conceptMap: METHOD_TREE, seed: seed(50), boundedFrom: 's', boundedKeys: ['Hot'] });
		assert.deepEqual(hot.summary, { Hot: true });
		assert.deepEqual(cold.summary, {}, 'the second invoke is a FRESH graph — no leftover Hot from the first');
		assert.equal(pool.size(), 1);
	} finally { await pool.close(); }
});

test('distinct keys → distinct instances; close() tears them all down', async () => {
	const pool = Graph.createWorkerPool();
	const h = await pool.invoke('hot',  { conceptMap: METHOD_TREE, seed: seed(120), boundedFrom: 's', boundedKeys: ['Hot'] });
	const c = await pool.invoke('cold', { conceptMap: OTHER_TREE,  seed: seed(50),  boundedFrom: 's', boundedKeys: ['Cold'] });
	assert.deepEqual(h.summary, { Hot: true }); assert.deepEqual(c.summary, { Cold: true });
	assert.equal(pool.size(), 2, 'two distinct contracts → two warm instances');
	await pool.close();
	assert.equal(pool.size(), 0, 'close() clears the pool');
});

test('LRU cap — max evicts the least-recently-used instance', async () => {
	const pool = Graph.createWorkerPool({ max: 1 });
	try {
		await pool.invoke('hot',  { conceptMap: METHOD_TREE, seed: seed(120), boundedFrom: 's', boundedKeys: ['Hot'] });
		assert.deepEqual(pool.keys(), ['hot']);
		await pool.invoke('cold', { conceptMap: OTHER_TREE,  seed: seed(50),  boundedFrom: 's', boundedKeys: ['Cold'] });
		assert.equal(pool.size(), 1, 'capped at max=1'); assert.deepEqual(pool.keys(), ['cold'], 'the LRU (hot) was evicted');
	} finally { await pool.close(); }
});

test('P2 × P3 — a segment-proxy backed by the pool: N casts reuse ONE instance', async () => {
	const pool = Graph.createWorkerPool();
	const proxy = makeSegmentProxy({ name: 'HotProxy', libraryKey: 'hot', pool, castWhen: ['Task'],
		contract: { write: ['Hot'], post: ['$Hot == true'] }, methodMap: METHOD_TREE,
		buildSeed: ( scope ) => seed(scope._.temp), boundedFrom: 's', boundedKeys: ['Hot'] });
	const saved = Graph._providers; Graph._providers = Object.assign({}, saved, proxy.provider);
	try {
		const CONF = ( l ) => ({ label: l, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' });
		const tree = { common: { childConcepts: Object.assign({ Alert: { _id: 'Alert', _name: 'Alert', require: ['Segment'], ensure: ['$Hot == true'] } }, proxy.conceptFragment) } };
		// two separate caller graphs, each with a Task at temp>=100 → each cast delegates to the SAME pooled instance.
		for ( const temp of [120, 150] ) {
			const g = new Graph({ lastRev: 0, nodes: [{ _id: 'a', Node: true }, { _id: 'b', Node: true }],
				segments: [{ _id: 'task', Segment: true, Task: true, temp: temp, originNode: 'a', targetNode: 'b' }] }, CONF('c' + temp), tree);
			await nextStable(g);
			assert.equal((g._objById['task']._etty._).Alert, true, 'proxy delegated via the pool + posted Hot JTMS-visible at temp=' + temp);
		}
		assert.equal(pool.size(), 1, 'both proxy casts reused the ONE warm instance keyed by libraryKey');
	} finally { Graph._providers = saved; await pool.close(); }
});
