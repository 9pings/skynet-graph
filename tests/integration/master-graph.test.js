'use strict';
/**
 * MASTER-GRAPH SUPERVISOR — the thin end-to-end PoC (capstone study §6, the go/no-go), pinned on the real
 * engine. Asserts the master loop COMPOSES: typed-tool reuse + combinatorial coverage (tools-from-tools) +
 * bounded context + sound partial-collapse-on-drift, each with a negative control.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { library, runPath } = require('../../examples/poc/master-graph.js');
const { conceptTree } = require('../../examples/poc/master-graph.js');

test('tools-from-tools: a few typed hop-methods cover a combinatorial space of novel path-compositions', async () => {
	const lib = library();
	const stream = [['A', 'B', 'C'], ['B', 'C', 'D'], ['A', 'B', 'C', 'D'], ['A', 'B'], ['C', 'D', 'A'], ['A', 'B', 'C', 'D', 'A']];
	let master = 0, naive = 0;
	const perPath = [];
	for ( const p of stream ) { const r = await runPath(lib, p); master += r.cost; naive += p.length - 1; perPath.push(r.cost); assert.ok(r.resolved, 'every hop resolved'); }

	assert.equal(lib.cache.stats.stores, 4, 'exactly 4 distinct hop-methods forged (A→B,B→C,C→D,D→A)');
	assert.equal(master, 4, 'master loop pays once per distinct typed hop, not per path-hop');
	assert.equal(naive, 14, 'naive replan-each would re-derive every hop of every path');
	// the multiplier: NOVEL whole-paths (never seen as a composition) cost 0 because their hops are known.
	assert.equal(perPath[2], 0, 'A→B→C→D (a novel 3-hop composition) solved FREE from known tools');
	assert.equal(perPath[5], 0, 'A→B→C→D→A (a novel 4-hop composition) solved FREE from known tools');
	assert.ok(master < naive, 'coverage (6 paths) >> library (4 tools) — punch above the ceiling in COVERAGE');
});

test('NEGATIVE control: a novel typed hop pays (no false replay)', async () => {
	const lib = library();
	await runPath(lib, ['A', 'B']);                       // warm A→B
	const before = lib.n.calls;
	const neg = await runPath(lib, ['E', 'F']);           // a hop never seen
	assert.equal(neg.cost, 1, 'a novel typed transition genuinely pays — the cache keys on the K1 signature');
	assert.equal(lib.n.calls - before, 1);
});

test('bounded context: each hop call’s local typed context is CONSTANT in path length', async () => {
	const lib = library();
	const small = await runPath(lib, ['A', 'B']);
	const big = await runPath(lib, ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D']);
	const all = small.ctxSizes.concat(big.ctxSizes);
	assert.equal(Math.max(...all), Math.min(...all), 'per-hop context size is identical for a 1-hop and an 8-hop path (independent of N)');
});

test('DRIFT → PARTIAL collapse → RE-FORGE: only the failed hop retracts; re-forge under a new version pays', async () => {
	const lib = library();
	Graph._providers = lib.providers;
	const live = new Graph({ lastRev: 0,
		nodes: [{ _id: 'm0', Node: true }, { _id: 'm1', Node: true }, { _id: 'm2', Node: true }, { _id: 'm3', Node: true }],
		segments: [
			{ _id: 'h0', Segment: true, originNode: 'm0', targetNode: 'm1', hop: true, oKind: 'A', tKind: 'B', srcOk: true },
			{ _id: 'h1', Segment: true, originNode: 'm1', targetNode: 'm2', hop: true, oKind: 'B', tKind: 'C', srcOk: true },
			{ _id: 'h2', Segment: true, originNode: 'm2', targetNode: 'm3', hop: true, oKind: 'C', tKind: 'D', srcOk: true }
		] }, { label: 'live', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(live);
	assert.deepEqual(['h0', 'h1', 'h2'].map(( id ) => live.getEtty(id)._.Hop === true), [true, true, true], 'all 3 hops cast');

	const before = lib.n.calls;
	await new Promise(( res ) => live.ingest([{ id: 'h1', fields: { srcOk: false } }], res));   // DRIFT on the middle hop
	assert.deepEqual(['h0', 'h1', 'h2'].map(( id ) => live.getEtty(id)._.Hop === true), [true, false, true],
		'PARTIAL collapse: only the middle hop retracted; siblings intact (bounded JTMS, E4/#31)');
	assert.equal(lib.n.calls - before, 0, '0 wasted re-derivation on the collapse');

	// RE-FORGE the recovered hop as a NEW version (B8): without the bump, restoring the premise would serve a
	// STALE v1 replay; the version bump forces a genuine re-derivation of the invalidated method.
	lib.bump();
	const beforeReforge = lib.n.calls;
	await new Promise(( res ) => live.ingest([{ id: 'h1', fields: { srcOk: true } }], res));
	assert.equal(live.getEtty('h1')._.Hop, true, 'the hop re-cast after re-forge');
	assert.equal(lib.n.calls - beforeReforge, 1, 're-forge under the new version is a genuine new derivation (not a stale replay)');
});
