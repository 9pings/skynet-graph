'use strict';
/**
 * BOUNDED SUBGRAPH EXTRACTION (lib/authoring/extract.js) — program slicing at the fork/ship boundary (2026-07-01
 * fork-perf measure + Laurie confront, SOUND-WITH-CORRECTION). A ship-able slice = a segment-closed 1-hop ball with the
 * other-endpoint nodes FROZEN as inputs. Soundness = contract.js G1 at the fork boundary (the frozen frontier is
 * frame-complete) + single-writer merge + an assumption-recheck. ZERO-CORE.
 *
 * The two LOAD-BEARING neg controls (both must fail as predicted or the design is wrong):
 *   A — a DANGLING frontier (frozen node omitted) → an interior concept that reads the cross-cut ref does NOT fire →
 *       the slice under-stabilizes → its result ≠ the in-parent counterpart. Proves the FREEZE is load-bearing.
 *   B — a MULTI-WRITER frontier (a merge that writes a frozen frontier object) → REJECTED (single-writer discipline).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { extractSubgraph, mergeSlice } = require('../../lib/authoring/extract.js');
console.log = console.info = console.warn = () => {};

// a concept tree: Edge casts on every segment; SameRegion casts iff the segment's two endpoints share a region — an
// ENSURE that ref-walks BOTH endpoints (the cross-cut read the freeze must satisfy).
const TREE = { common: { childConcepts: {
	Vertice:    { _id: 'Vertice', _name: 'Vertice', require: ['Node'] },
	Edge:       { _id: 'Edge', _name: 'Edge', require: ['Segment'], childConcepts: {
		SameRegion: { _id: 'SameRegion', _name: 'SameRegion', require: ['Segment'], ensure: ['$originNode:region==$targetNode:region'] },
	} },
} } };

// parent: A(EU) — s_AB → B(EU), A — s_AC → C(US); a chain off C (D..H) that focus=A must NOT pull in (1-hop bound).
function seed() {
	return { lastRev: 0,
		nodes: [
			{ _id: 'A', Node: true, region: 'EU' }, { _id: 'B', Node: true, region: 'EU' }, { _id: 'C', Node: true, region: 'US' },
			{ _id: 'D', Node: true, region: 'US' }, { _id: 'E', Node: true, region: 'US' }, { _id: 'F', Node: true, region: 'EU' },
		],
		segments: [
			{ _id: 's_AB', Segment: true, originNode: 'A', targetNode: 'B' },
			{ _id: 's_AC', Segment: true, originNode: 'A', targetNode: 'C' },
			{ _id: 's_CD', Segment: true, originNode: 'C', targetNode: 'D' },
			{ _id: 's_DE', Segment: true, originNode: 'D', targetNode: 'E' },
			{ _id: 's_EF', Segment: true, originNode: 'E', targetNode: 'F' },
		] };
}
const settle = ( g ) => new Promise(( res ) => { let d = false; g.cfg.onStabilize = () => { if ( !d ) { d = true; res(); } }; });
function boot() {
	const g = new Graph(seed(), { label: 'p', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, TREE);
	return g;
}
const fact = ( g, id, k ) => { const o = g._objById[id]; return o && o._etty && o._etty._[k]; };
// strip a derived fact from a seed object → force the child to RE-DERIVE it (else the copied cast masks under-stabilization).
function stripFromSeed( extraction, id, key ) { const o = extraction.seed.conceptMaps.find(( x ) => x._id === id ); if ( o ) delete o[key]; }

test('extractSubgraph — a segment-closed 1-hop ball: focus A → {A, s_AB, s_AC} interior + {B,C} frozen frontier; the C-chain is NOT pulled in', async () => {
	const g = boot(); await settle(g);
	assert.equal(fact(g, 's_AB', 'SameRegion'), true, 'parent: s_AB is intra-EU → SameRegion');
	assert.equal(fact(g, 's_AC', 'SameRegion'), undefined, 'parent: s_AC crosses EU/US → not SameRegion');

	const ex = extractSubgraph(g, 'A');
	assert.deepEqual(ex.focusNodes.sort(), ['A']);
	assert.deepEqual(ex.segments.sort(), ['s_AB', 's_AC'], 'incident segments of A');
	assert.deepEqual(ex.frontier.sort(), ['B', 'C'], 'the other endpoints are the frozen frontier');
	const sliceIds = ex.seed.conceptMaps.map(( o ) => o._id ).sort();
	assert.deepEqual(sliceIds, ['A', 'B', 'C', 's_AB', 's_AC'], 'the slice is EXACTLY the 1-hop ball — D,E,F and their segments are excluded (bounded)');
	assert.ok(ex.seed.conceptMaps.length < Object.keys(g._objById).length, 'the slice (5) << the whole graph (11) — the extraction win');
	g.destroy && g.destroy();
});

test('extractSubgraph hops:2 — interior grows one ring (A + B,C); frontier at 2 hops (D); s_CD included, s_DE excluded', async () => {
	const g = boot(); await settle(g);
	assert.equal(fact(g, 's_CD', 'SameRegion'), true, 'parent: s_CD (US/US) casts SameRegion');
	const ex = extractSubgraph(g, 'A', { hops: 2 });
	assert.deepEqual(ex.interior.sort(), ['A', 'B', 'C'], 'interior = focus + its 1-hop neighbours (B, C)');
	assert.deepEqual(ex.frontier.sort(), ['D'], 'the 2-hop node D is the frozen frontier (E, F beyond are excluded)');
	assert.deepEqual(ex.segments.sort(), ['s_AB', 's_AC', 's_CD'], 's_CD (C→D) is included; s_DE and beyond are excluded (bounded at 2 hops)');
	// a 2-HOP-dependent cast: s_CD.SameRegion reads C (interior) and D (FROZEN 2-hop frontier) — re-derives from frozen D.
	stripFromSeed(ex, 's_CD', 'SameRegion');
	const child = g.fork(ex.seed); await settle(child);
	assert.equal(fact(child, 's_CD', 'SameRegion'), true, 'the 2-hop slice re-derives s_CD SameRegion from the frozen 2-hop frontier D (US==US)');
	child.destroy && child.destroy(); g.destroy && g.destroy();
});

test('SOUNDNESS (positive) — the slice, forked, RE-DERIVES SameRegion identically to the in-parent counterpart', async () => {
	const g = boot(); await settle(g);
	const ex = extractSubgraph(g, 'A');
	stripFromSeed(ex, 's_AB', 'SameRegion');                    // force re-derivation (the frozen B must carry the cast)
	const child = g.fork(ex.seed); await settle(child);
	assert.equal(fact(child, 's_AB', 'SameRegion'), true, 'the child RE-DERIVES SameRegion on s_AB (frozen B.region=EU present)');
	assert.equal(fact(child, 's_AC', 'SameRegion'), undefined, 'and correctly does NOT cast on the EU/US s_AC');
	child.destroy && child.destroy(); g.destroy && g.destroy();
});

test('NEG CONTROL A (load-bearing) — a DANGLING frontier (B omitted) → SameRegion cannot re-derive → slice ≠ parent', async () => {
	const g = boot(); await settle(g);
	const ex = extractSubgraph(g, 'A');
	stripFromSeed(ex, 's_AB', 'SameRegion');
	ex.seed.conceptMaps = ex.seed.conceptMaps.filter(( o ) => o._id !== 'B' );   // drop the frozen frontier node B
	const child = g.fork(ex.seed); await settle(child);
	assert.equal(fact(child, 's_AB', 'SameRegion'), undefined,
		'with B absent the cross-cut ref $targetNode:region is unresolved → SameRegion does NOT fire → the slice under-stabilizes (freeze is load-bearing)');
	child.destroy && child.destroy(); g.destroy && g.destroy();
});

test('merge-back — assumption-recheck: a frozen frontier fact that DRIFTS in the parent since extraction → mergeSlice REJECTS', async () => {
	const g = boot(); await settle(g);
	const ex = extractSubgraph(g, 'A');
	const child = g.fork(ex.seed); await settle(child);
	// the parent drifts the frozen frontier premise (B leaves the EU) AFTER extraction.
	g.pushMutation({ $$_id: 'B', region: 'US' }); await settle(g);
	const r = mergeSlice(g, child, ex);
	assert.equal(r.merged, false, 'the slice stabilized on a dead premise (B.region) → REJECT, do not merge stale');
	assert.match(r.reason, /drift/i);
	child.destroy && child.destroy(); g.destroy && g.destroy();
});

test('NEG CONTROL B (load-bearing) — a MULTI-WRITER merge (writes a frozen frontier object) → REJECTED (single-writer)', async () => {
	const g = boot(); await settle(g);
	const ex = extractSubgraph(g, 'A');
	const child = g.fork(ex.seed); await settle(child);
	// a bad project that writes a FRONTIER object (C) — the cross-cut write that would be the ATMS multi-context.
	const r = mergeSlice(g, child, ex, { project: () => [{ $$_id: 'A', touched: true }, { $$_id: 'C', region: 'XX' }] });
	assert.equal(r.merged, false, 'writing the frozen frontier object C is a write across the cut → REJECTED');
	assert.match(r.reason, /single-writer|frontier/i);
	child.destroy && child.destroy(); g.destroy && g.destroy();
});

test('merge-back (positive) — no drift, single-writer project → merges the focus produced facts through the taskflow', async () => {
	const g = boot(); await settle(g);
	const ex = extractSubgraph(g, 'A');
	const child = g.fork(ex.seed); await settle(child);
	const r = mergeSlice(g, child, ex, { project: () => [{ $$_id: 'A', sliceVisited: true }] });
	assert.equal(r.merged, true);
	await settle(g);
	assert.equal(fact(g, 'A', 'sliceVisited'), true, 'the focus produced fact is written back into the parent');
	child.destroy && child.destroy(); g.destroy && g.destroy();
});
