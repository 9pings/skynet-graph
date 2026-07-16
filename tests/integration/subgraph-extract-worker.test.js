'use strict';
/**
 * BOUNDED SUBGRAPH EXTRACTION — the CROSS-PROCESS arm (the multi-process lever the fork-perf measure identified as the
 * real one: ship a bounded SLICE to a separate process — no shared memory, so the frozen frontier MUST travel in the
 * seed). Proves the full loop: `extractSubgraph` → `spawnGraph({seed})` to a worker_thread → the slice stabilizes THERE
 * (re-derives the frontier-dependent cast from the FROZEN frontier, cross-process) → `mergeSlice` reintegrates the
 * worker's JSON snapshot soundly (factsGetter over the serialized child + the single-writer / assumption-recheck gates).
 * ZERO-CORE (host-side over spawnGraph/serialize/mergeSlice).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');                 // the facade — carries spawnGraph
const { extractSubgraph, mergeSlice } = require('../../lib/authoring/core/extract.js');
console.log = console.info = console.warn = () => {};

const TREE = { common: { childConcepts: {
	Vertice:    { _id: 'Vertice', _name: 'Vertice', require: ['Node'] },
	Edge:       { _id: 'Edge', _name: 'Edge', require: ['Segment'], childConcepts: {
		SameRegion: { _id: 'SameRegion', _name: 'SameRegion', require: ['Segment'], ensure: ['$originNode:region==$targetNode:region'] },
	} },
} } };
function seed() {
	return { lastRev: 0,
		nodes: [ { _id: 'A', Node: true, region: 'EU' }, { _id: 'B', Node: true, region: 'EU' }, { _id: 'C', Node: true, region: 'US' } ],
		segments: [ { _id: 's_AB', Segment: true, originNode: 'A', targetNode: 'B' }, { _id: 's_AC', Segment: true, originNode: 'A', targetNode: 'C' } ] };
}
const settle = ( g ) => new Promise(( res ) => { let d = false; g.cfg.onStabilize = () => { if ( !d ) { d = true; res(); } }; });
const factsOf = ( g, id ) => { const o = g._objById[id]; return o && o._etty && o._etty._; };
const snapFacts = ( parsed, id ) => (parsed.conceptMaps.find(( o ) => o._id === id ) || {});

test('cross-process — extract a slice, stabilize it in a WORKER, re-derive the frozen-frontier-dependent cast', async () => {
	const g = new Graph(seed(), { label: 'p', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, TREE);
	await settle(g);
	assert.equal(factsOf(g, 's_AB').SameRegion, true, 'parent baseline: s_AB (EU/EU) casts SameRegion');

	const ex = extractSubgraph(g, 'A');
	assert.deepEqual(ex.frontier.sort(), ['B', 'C'], 'B and C are the frozen frontier');
	const s_ab = ex.seed.conceptMaps.find(( o ) => o._id === 's_AB' ); delete s_ab.SameRegion;   // force re-derivation in the worker

	// SHIP the bounded slice to a separate process; it stabilizes there and returns serialize().
	const snapshot = await Graph.spawnGraph({ conceptMap: TREE, seed: ex.seed });
	const parsed = JSON.parse(snapshot.graph);
	assert.equal(snapFacts(parsed, 's_AB').SameRegion, true,
		'the WORKER re-derived SameRegion on s_AB from the FROZEN frontier B (region=EU travelled in the seed — cross-process, no shared memory)');
	assert.equal(snapFacts(parsed, 's_AC').SameRegion, undefined, 'and correctly not on the EU/US s_AC');

	// MERGE BACK the worker's JSON snapshot — factsGetter reads the serialized child; single-writer + drift gates apply.
	const child = parsed;
	const r = mergeSlice(g, child, ex, { factsGetter: ( c, id ) => snapFacts(c, id), project: () => [{ $$_id: 'A', workerReached: true }] });
	assert.equal(r.merged, true, 'no frontier drift + single-writer (writes interior A) → merges');
	await settle(g);
	assert.equal(factsOf(g, 'A').workerReached, true, 'the cross-process result flows back into the parent through the taskflow');
});

test('cross-process — the single-writer gate holds over a JSON worker child too (writing a frozen frontier → REJECT)', async () => {
	const g = new Graph(seed(), { label: 'p2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, TREE);
	await settle(g);
	const ex = extractSubgraph(g, 'A');
	const snapshot = await Graph.spawnGraph({ conceptMap: TREE, seed: ex.seed });
	const child = JSON.parse(snapshot.graph);
	const r = mergeSlice(g, child, ex, { factsGetter: ( c, id ) => snapFacts(c, id), project: () => [{ $$_id: 'B', region: 'XX' }] });
	assert.equal(r.merged, false, 'writing the frozen frontier B (cross-cut write) is rejected regardless of the child being a JSON snapshot');
	assert.match(r.reason, /single-writer|frontier/i);
});
