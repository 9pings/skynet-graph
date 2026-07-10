'use strict';
/**
 * G-0 — the interleave-robust structural go/no-go on a LIVE ENGINE dispatch trace (roadmap graft G-0; confront:
 * Laurie Q2/Q5 + babble/Stitch SOTA). The STAGE-0 flat screen tallied CONTIGUOUS method-id adjacency in a per-task
 * EMISSION-order sequence; this proves — on REAL engine firings, not hand-built symbol sequences — that:
 *   (1) MECHANISM: the stabilize loop (a fixpoint over `_unstable`) emits HETEROGENEOUS concurrent sub-problem
 *       chains INTERLEAVED (level-order): a task's parse-chain Parse→Validate is split by a concurrent fetch-chain's
 *       Fetch firing → emission order [Parse, Fetch, Validate, …]. (Same-method level batching does NOT break a
 *       composite — only a DIFFERENT chain's firing landing between the members does; hence the heterogeneous setup.)
 *   (2) the FLAT screen on that emission order is DOUBLY WRONG: it MISSES the real Parse∘Validate (false NEGATIVE,
 *       the expensive gate error) AND it FABRICATES a spurious cross-lane Parse∘Fetch (false POSITIVE — Parse and
 *       Fetch are on INDEPENDENT segments with NO data-flow, so the "composite" is uncompressible; the positional
 *       tally invented it from the interleaving coincidence). Its "GO" is on garbage.
 *   (3) the PROVENANCE gate (chains from data-flow, not emission order) is CORRECT on both counts: it RECOVERS the
 *       real Parse∘Validate (compose-candidate across two DISTINCT whole-tasks) and fabricates NO Parse∘Fetch.
 * Plus the honest negatives: a workload with NO cross-task composite → no candidate; a single repeated whole-task →
 * already-flat-covered. Deterministic (no LLM), ZERO-CORE. Laurie Q5: this is INSTRUMENT validation on a LIVE trace
 * (the composite is earned by the grammar's data-flow, but the DOMAIN is author-designed to compose) — it does NOT
 * establish that real domains compose; the real-workload measurement (the `common` grammar) is the separate go/no-go.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { methodTrace } = require('../../lib/authoring/mine.js');
const { buildConceptTree } = require('../../lib/authoring/concepts.js');
const { register, CommonGeo } = require('../../lib/providers');
const C = require('../../lib/authoring/compose-hotspot');
console.log = console.info = console.warn = () => {};

// ── the grammar: two HETEROGENEOUS chains a whole-task runs CONCURRENTLY.
//   parse lane:  Parse → Validate → (Store | Emit)      (the composite of interest = Parse∘Validate)
//   fetch lane:  Fetch → Clean                          (the concurrent sub-problem that INTERLEAVES)
// Every provider self-flags its cast (the provider-cast-marker discipline) and writes ONE data fact a downstream
// concept requires → the produce→consume data-flow is explicit and same-target.
const P = {
	Parse( g, c, s, a, cb )    { cb(null, { $_id: '_parent', Parse: true, parsed: 'p' }); },
	Validate( g, c, s, a, cb ) { cb(null, { $_id: '_parent', Validate: true, validated: 'v' }); },
	Store( g, c, s, a, cb )    { cb(null, { $_id: '_parent', Store: true, done: true }); },
	Emit( g, c, s, a, cb )     { cb(null, { $_id: '_parent', Emit: true, done: true }); },
	Fetch( g, c, s, a, cb )    { cb(null, { $_id: '_parent', Fetch: true, fetched: 'f' }); },
	Clean( g, c, s, a, cb )    { cb(null, { $_id: '_parent', Clean: true, cleaned: 'c' }); },
};
const TREE = { childConcepts: {
	Parse:    { _id: 'Parse',    _name: 'Parse',    require: ['lane'],            ensure: ["$lane=='parse'", '!$parsed'],    provider: ['P::Parse'] },
	Validate: { _id: 'Validate', _name: 'Validate', require: ['parsed'],          ensure: ['!$validated'],                   provider: ['P::Validate'] },
	Store:    { _id: 'Store',    _name: 'Store',    require: ['validated', 'route'], ensure: ["$route=='store'", '!$done'],  provider: ['P::Store'] },
	Emit:     { _id: 'Emit',     _name: 'Emit',     require: ['validated', 'route'], ensure: ["$route=='emit'", '!$done'],   provider: ['P::Emit'] },
	Fetch:    { _id: 'Fetch',    _name: 'Fetch',    require: ['lane'],            ensure: ["$lane=='fetch'", '!$fetched'],   provider: ['P::Fetch'] },
	Clean:    { _id: 'Clean',    _name: 'Clean',    require: ['fetched'],         ensure: ['!$cleaned'],                     provider: ['P::Clean'] },
} };

// derive the WRITTEN fact keys off a firing's captured patch (the facts it set on its parent = provenance producers).
const SYS = new Set(['_id', '$_id', '$$_id', '_rev', '_origin', 'parentSeg']);
function writesOf( patch, target ) {
	for ( const o of (Array.isArray(patch) ? patch : [patch]) ) {
		if ( !o || typeof o !== 'object' ) continue;
		const idv = o.$_id === '_parent' ? target : String(o.$$_id || o.$_id || o._id || '').replace(/^\$+/, '');
		if ( o.$_id === '_parent' || idv === target ) return Object.keys(o).filter(( k ) => !SYS.has(k)).map(( k ) => k.replace(/^\$+/, ''));
	}
	return [];
}

const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, facts ) => Object.assign({ _id: id, originNode: o, targetNode: t }, facts);

// run ONE whole-task (a graph with concurrent parse+fetch segments), return its firings as gate records tagged `task`.
async function runTask( taskSig, segs ) {
	Graph._providers = Object.assign({}, Graph._providers, { P });
	const mt = methodTrace();
	const nodes = [], segments = [];
	for ( const sg of segs ) { nodes.push(node(sg.o), node(sg.t)); segments.push(seg(sg.id, sg.o, sg.t, sg.facts)); }
	const g = new Graph({ lastRev: 0, nodes, segments }, {
		label: taskSig, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
	}, { common: JSON.parse(JSON.stringify(TREE)) });
	mt.listen(g);
	await nextStable(g);
	// methodTrace records are pushed in APPLY order → the live emission order. Derive reads (premise keys) + writes.
	return mt.records.map(( r, i ) => ({
		task: taskSig, rev: i, concept: r.concept, target: r.target,
		reads: Object.keys(r.premise || {}), writes: writesOf(r.patch, r.target),
	}));
}

test('MECHANISM — the stabilize loop INTERLEAVES a task’s heterogeneous chains (Fetch lands between Parse and Validate)', async () => {
	// one whole-task, one parse segment + one fetch segment running concurrently.
	const fA = await runTask('docA', [
		{ id: 'PA', o: 'pa0', t: 'pa1', facts: { lane: 'parse', route: 'store' } },
		{ id: 'FA', o: 'fa0', t: 'fa1', facts: { lane: 'fetch' } },
	]);
	const emission = fA.map(( f ) => f.concept );
	// the composite members on the parse segment PA, and the interleaving fetch firing.
	const iParse = emission.indexOf('Parse'), iValidate = emission.indexOf('Validate'), iFetch = emission.indexOf('Fetch');
	assert.ok(iParse >= 0 && iValidate >= 0 && iFetch >= 0, 'all three fired');
	assert.ok(iParse < iFetch && iFetch < iValidate,
		`INTERLEAVED: emission [${emission.join(', ')}] — Fetch sits between Parse and Validate (level-order fixpoint)`);
});

test('THE CENTRAL RESULT — FLAT screen MISSES the interleaved composite; PROVENANCE gate RECOVERS it, cross-task = candidate', async () => {
	// two DISTINCT whole-tasks, each parse-chain (Parse→Validate→tail) concurrent with a fetch-chain. docA ends Store,
	// docB ends Emit → the shared composite is Parse∘Validate across the two DISTINCT tasks.
	const fA = await runTask('docA', [
		{ id: 'PA', o: 'pa0', t: 'pa1', facts: { lane: 'parse', route: 'store' } },
		{ id: 'FA', o: 'fa0', t: 'fa1', facts: { lane: 'fetch' } },
	]);
	const fB = await runTask('docB', [
		{ id: 'PB', o: 'pb0', t: 'pb1', facts: { lane: 'parse', route: 'emit' } },
		{ id: 'FB', o: 'fb0', t: 'fb1', facts: { lane: 'fetch' } },
	]);
	const firings = fA.concat(fB).map(( f, i ) => Object.assign({}, f, { rev: i }));

	// (a) FLAT screen on the raw EMISSION order per task → DOUBLY WRONG.
	const flat = C.trackCompositions();
	flat.observe({ taskSig: 'docA', seq: fA.map(( f ) => f.concept) });
	flat.observe({ taskSig: 'docB', seq: fB.map(( f ) => f.concept) });
	const flatRows = C.composeHotspots(flat, { minCount: 2, minDistinctTasks: 2 });
	const flatPV = flatRows.find(( r ) => r.composite.join('>') === 'Parse>Validate' );
	assert.ok(!flatPV, 'FLAT MISSES the real data-flow composite Parse∘Validate (false NEGATIVE — Fetch splits it)');
	const flatSpurious = flatRows.find(( r ) => r.composite.join('>') === 'Parse>Fetch' && r.verdict === 'compose-candidate' );
	assert.ok(flatSpurious, 'FLAT FABRICATES a spurious cross-lane Parse∘Fetch candidate (false POSITIVE — no data-flow between the segments)');
	// ⇒ the flat "GO" is on garbage: the double failure of a purely-positional tally on an interleaved live trace.

	// (b) PROVENANCE gate on the SAME firings → CORRECT on both counts.
	const prov = C.trackFromFirings(firings);
	const provRows = C.composeHotspots(prov, { minCount: 2, minDistinctTasks: 2 });
	const provPV = provRows.find(( r ) => r.composite.join('>') === 'Parse>Validate' );
	assert.ok(provPV, 'PROV recovers the real Parse∘Validate composite despite the interleaving');
	assert.equal(provPV.verdict, 'compose-candidate', 'frequent ∧ cross-DISTINCT-task ∧ compressible → GO');
	assert.equal(provPV.distinctTasks, 2, 'across the two DISTINCT whole-tasks docA/docB');
	const provSpurious = provRows.find(( r ) => r.composite.join('>') === 'Parse>Fetch' );
	assert.ok(!provSpurious, 'PROV fabricates NO Parse∘Fetch (no data-flow edge between the independent segments)');
	assert.equal(C.anyComposeCandidate(provRows), true, 'the interleave-robust gate → correct GO on the REAL composite(s)');
});

test('DETERMINISM — the live result re-runs identically (the flat false-negative / provenance GO is stable)', async () => {
	const run = async () => {
		const fA = await runTask('docA', [
			{ id: 'PA', o: 'pa0', t: 'pa1', facts: { lane: 'parse', route: 'store' } },
			{ id: 'FA', o: 'fa0', t: 'fa1', facts: { lane: 'fetch' } } ]);
		const fB = await runTask('docB', [
			{ id: 'PB', o: 'pb0', t: 'pb1', facts: { lane: 'parse', route: 'emit' } },
			{ id: 'FB', o: 'fb0', t: 'fb1', facts: { lane: 'fetch' } } ]);
		const firings = fA.concat(fB).map(( f, i ) => Object.assign({}, f, { rev: i }));
		const flatRows = C.composeHotspots((() => { const t = C.trackCompositions();
			t.observe({ taskSig: 'docA', seq: fA.map(( f ) => f.concept) }); t.observe({ taskSig: 'docB', seq: fB.map(( f ) => f.concept) }); return t; })(), { minCount: 2, minDistinctTasks: 2 });
		const provRows = C.composeHotspots(C.trackFromFirings(firings), { minCount: 2, minDistinctTasks: 2 });
		const has = ( rows, leaf ) => !!rows.find(( r ) => r.composite.join('>') === leaf && r.verdict === 'compose-candidate' );
		return { emissionA: fA.map(( f ) => f.concept).join('>'),
			flatMissesReal: !has(flatRows, 'Parse>Validate'), flatSpurious: has(flatRows, 'Parse>Fetch'),
			provReal: has(provRows, 'Parse>Validate'), provNoSpurious: !provRows.find(( r ) => r.composite.join('>') === 'Parse>Fetch') };
	};
	const r1 = await run(), r2 = await run();
	assert.deepEqual(r1, r2, 'deterministic across a re-run');
	assert.equal(r1.flatMissesReal, true, 'flat: stable false-NEGATIVE (misses the real composite)');
	assert.equal(r1.flatSpurious, true, 'flat: stable false-POSITIVE (fabricates the cross-lane pair)');
	assert.equal(r1.provReal, true, 'provenance: stable correct GO on the real composite');
	assert.equal(r1.provNoSpurious, true, 'provenance: stable no spurious cross-lane candidate');
});

test('HONEST NEG — no cross-task composite (distinct chains) → the provenance gate also says NO (not vacuous)', async () => {
	// docA is Parse→Validate→Store; docC is a DIFFERENT chain Fetch→Clean only. No shared cross-task composite.
	const fA = await runTask('docA', [ { id: 'PA', o: 'pa0', t: 'pa1', facts: { lane: 'parse', route: 'store' } } ]);
	const fC = await runTask('docC', [ { id: 'FC', o: 'fc0', t: 'fc1', facts: { lane: 'fetch' } } ]);
	const firings = fA.concat(fC).map(( f, i ) => Object.assign({}, f, { rev: i }));
	const rows = C.composeHotspots(C.trackFromFirings(firings), { minCount: 2, minDistinctTasks: 2 });
	assert.equal(C.anyComposeCandidate(rows), false, 'no shared cross-task sub-chain → correct NO-GO (the gate is not a yes-machine)');
});

test('HONEST OFF-RAMP — a single repeated whole-task is already-flat-covered (whole-task memo serves it)', async () => {
	// one whole-task type "batch", run with THREE parse segments → Parse∘Validate recurs but distinctTasks = 1.
	const f = await runTask('batch', [
		{ id: 'S0', o: 'a0', t: 'a1', facts: { lane: 'parse', route: 'store' } },
		{ id: 'S1', o: 'b0', t: 'b1', facts: { lane: 'parse', route: 'store' } },
		{ id: 'S2', o: 'c0', t: 'c1', facts: { lane: 'parse', route: 'store' } },
	]);
	const rows = C.composeHotspots(C.trackFromFirings(f), { minCount: 2, minDistinctTasks: 2 });
	const pv = rows.find(( r ) => r.composite.join('>') === 'Parse>Validate' );
	assert.ok(pv, 'Parse∘Validate recurs…');
	assert.equal(pv.verdict, 'already-flat-covered', '…but within ONE whole-task → flat memo covers it (the off-ramp)');
	assert.equal(C.anyComposeCandidate(rows), false, 'correct no-go');
});

// ── REAL-DOMAIN measurement (Laurie Q5's strongest test): the actual `common` travel grammar, a domain NOT designed to
//    compose. Several distinct trips (long-haul + short-hop). The honest go/no-go — no planted composite. (`writesOf`
//    above is reused for the produced-fact derivation.)
test('REAL-DOMAIN — the `common` travel grammar yields NO path-composite (fork-shallow data-flow) → compress.js FILED', async () => {
	register(Graph, [{ CommonGeo }]);
	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });
	const trips = [
		{ task: 'paris-singapore', a: 'paris', b: 'singapore', pa: { lat: 48.8566, lng: 2.3522 }, pb: { lat: 1.3521, lng: 103.8198 } },
		{ task: 'london-tokyo', a: 'london', b: 'tokyo', pa: { lat: 51.5074, lng: -0.1278 }, pb: { lat: 35.6762, lng: 139.6503 } },
		{ task: 'paris-versailles', a: 'paris2', b: 'versailles', pa: { lat: 48.8566, lng: 2.3522 }, pb: { lat: 48.8049, lng: 2.1204 }, theoric: true },
		{ task: 'london-oxford', a: 'london2', b: 'oxford', pa: { lat: 51.5074, lng: -0.1278 }, pb: { lat: 51.752, lng: -1.2577 }, theoric: true },
	];
	let all = [];
	for ( const t of trips ) {
		const mt = methodTrace();
		const s = { _id: t.a + '-' + t.b, originNode: t.a, targetNode: t.b };
		if ( t.theoric ) s.Theoric = true;
		const g = new Graph({ lastRev: 0, nodes: [{ _id: t.a, Position: t.pa }, { _id: t.b, Position: t.pb }], segments: [s] },
			{ label: t.task, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: tree });
		mt.listen(g);
		await nextStable(g);
		all = all.concat(mt.records.map(( r ) => ({ task: t.task, concept: r.concept, target: r.target,
			reads: Object.keys(r.premise || {}), writes: writesOf(r.patch, r.target) })));
	}
	all = all.map(( f, i ) => Object.assign({}, f, { rev: i }));

	// the real data-flow is a FORK at Distance: Distance→Travel AND Distance→Long/ShortTravel (both key on `Distance`).
	const edges = C.provenanceEdges(all);
	const distOut = new Set(edges.filter(( e ) => e.fromConcept === 'Distance' ).map(( e ) => e.toConcept ));
	assert.ok(distOut.has('Travel') && (distOut.has('LongTravel') || distOut.has('ShortTravel')),
		'Distance FANS OUT to Travel AND a Long/Short classifier — a real fork (out-degree > 1)');
	// ⇒ G-a: the fork breaks every chain → NO depth-≥2 linear path composite → the gate correctly says NO candidate.
	const chains = C.provenanceChains(all);
	assert.equal(chains.length, 0, 'no maximal degree-1 path of ≥2 firings survives the fork (the G-a ceiling, on a REAL grammar)');
	const rows = C.composeHotspots(C.trackFromFirings(all), { minCount: 2, minDistinctTasks: 2 });
	assert.equal(C.anyComposeCandidate(rows), false, 'REAL-DOMAIN go/no-go: NO compose-candidate → compress.js stays FILED (honest floor, now on the actual `common` grammar)');
});
