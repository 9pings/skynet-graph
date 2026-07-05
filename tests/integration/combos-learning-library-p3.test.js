'use strict';
/**
 * Combos C3 — the LEARNING METHOD LIBRARY P3 gate verification (design doc 2026-07-05-p3-c3-wiring-design.md §5).
 *
 * DETERMINISTIC (no GPU, no network): a REAL trace is captured off a live engine run via `methodTrace`, then the
 * whole P3 surface of `lib/combos/learning-library.js` is exercised end-to-end —
 *   crystallizeFrom (admit + auto-index) → dispatch (O(1)) → the learning FORGE arm (adaptOrForgeAsync: hit 0-call /
 *   adapt 1-call / fail-closed reject) → drift (BOTH layers) → `.sgc` round-trip cross-restart.
 * It mirrors the verified-green smoke (scratchpad/smoke-p3-c3.js) and reuses the Refine fixture + helpers of
 * `adapt-or-forge.test.js`. Every positive gate carries a discriminating NEGATIVE control (junk-refused /
 * cross-role-inadmissible / cross-version-refused / drift-re-forge / reject-never-cached).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { methodTrace } = require('../../lib/authoring/mine.js');
const { digest } = require('../../lib/providers/canonicalize.js');
const { createLearningLibrary } = require('../../lib/combos/learning-library.js');
console.log = console.info = console.warn = () => {};

// ── the Refine fixture (from adapt-or-forge.test.js): a structural cast that SPLITS a segment into two. ──────
const STATE = { hard: 'split-hard', easy: 'split-easy' };
const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind ) => ({ _id: id, originNode: o, targetNode: t, kind });
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'c3-p3', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const SIG = ( p ) => ({ structure: { cls: 'refine' }, content: { kind: p.kind } });
const FACTS = ( p ) => ({ Segment: true, kind: p.kind });
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };
const deepReplaceState = ( x, kind ) => Array.isArray(x) ? x.map(( e ) => deepReplaceState(e, kind))
	: (x && typeof x === 'object') ? Object.fromEntries(Object.entries(x).map(( [k, v] ) => [k, deepReplaceState(v, kind)]))
	: (typeof x === 'string' && /^split-/.test(x)) ? 'split-' + kind : x;

const Refine = { refine( g, c, scope, argz, cb ) {
	const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
	cb(null, [
		{ $_id: '_parent', Refine: true, Refined: true, alts: [{ mid: STATE[scope._.kind] || '?' }] },
		{ _id: mid, Node: true, state: STATE[scope._.kind] || '?' },
		{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
		{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
	]);
} };

// ── capture a REAL trace off a live run ONCE (methodTrace on the engine); reuse it (records are read-only). ──
let CAPTURE = null;
async function capture() {
	if ( CAPTURE ) return CAPTURE;
	Graph._providers = Object.assign({}, Graph._providers, { Refine });
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')], segments: [seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard')] };
	const mt = methodTrace();
	const g = new Graph(JSON.parse(JSON.stringify(seed)), CFG, { common: TREE });
	mt.listen(g);
	await nextStable(g);
	CAPTURE = { records: mt.records, g };
	return CAPTURE;
}

// ── the ASYNC host forge = the makeForge 'adapt' branch of adapt-or-forge.test.js, async + reading ctx.scopeFacts.
// meter.n counts invocations; meter.nb records the last-seen neighbour count; meter.noContract flips the fail-closed test.
function makeAsyncForge() {
	const meter = { n: 0, nb: 0, noContract: false };
	const forge = async ( problem, ctx ) => {
		meter.n++; meter.nb = (ctx.neighbours || []).length;
		const nb = (ctx.neighbours || [])[0];
		if ( !nb ) return null;                                       // no structure to reuse → give up (a fresh forge is not modeled)
		const sig = digest(projectFacts(ctx.scopeFacts, nb.signatureKeys));
		const proto = Object.values(nb.templatesBySig)[0];
		const schema = meter.noContract ? Object.assign({}, nb.schema, { contract: undefined }) : nb.schema;
		const candidate = Object.assign({}, nb, { schema, templatesBySig: Object.assign({}, nb.templatesBySig, { [sig]: deepReplaceState(proto, problem.kind) }) });
		return { candidate, outcome: 'adapt', calls: 1 };
	};
	return { forge, meter };
}

// ── build a learning combo, crystallize the captured trace into its catalog, arm its host projections. ──────
async function warmCombo() {
	const { records, g } = await capture();
	const F = makeAsyncForge();
	const state = { target: null };
	const lib = createLearningLibrary({
		learning: true, signature: SIG, target: () => state.target, dispatchFacts: FACTS, forge: F.forge,
	});
	const res = lib.crystallizeFrom(records, { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' });
	state.target = { frontier: res.candidate.schema.frontier, signatureKeys: res.candidate.signatureKeys };
	return { lib, F, res, target: state.target };
}

// ── constructor guard — learning:true REQUIRES the host projections ─────────────────────────────────────────
test('guard: learning:true without target/dispatchFacts throws (naming opts.target)', () => {
	assert.throws(() => createLearningLibrary({ learning: true, forge: async () => null }), /opts\.target/);
});

// ── G-P3-1 — crystallizeFrom admits a real trace + auto-indexes; junk is refused (and indexes nothing) ──────
test('G-P3-1 crystallizeFrom admits a REAL trace + auto-indexes; junk is refused (not indexed)', async () => {
	const { records, g } = await capture();
	const F = makeAsyncForge();
	const lib = createLearningLibrary({ learning: true, signature: SIG, target: () => null, dispatchFacts: FACTS, forge: F.forge });
	const res = lib.crystallizeFrom(records, { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' });
	assert.equal(res.admitted, true, 'a structural method crystallizes from the captured firings');
	assert.ok(res.candidate.schema.contract, 'the method is BORN with a defeasible contract');
	assert.ok(res.candidate.schema.frontier, 'the FrontierSignature is reified');
	assert.ok(res.candidate.schema.libraryKey, 'the O(1) libraryKey is posted');
	assert.equal(lib.library.methods.length, 1, 'the admitted candidate is auto-indexed into the dispatch catalog');
	// NEG — records that yield no admissible structural method are refused WITH a reason and index NOTHING.
	const before = lib.library.methods.length;
	const neg = lib.crystallizeFrom([{ concept: 'Nope', target: 'x', patch: [], premise: {} }], { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL });
	assert.equal(neg.admitted, false);
	assert.ok(neg.reason, 'the refusal carries a reason (the gate is not vacuous)');
	assert.equal(lib.library.methods.length, before, 'a refused crystallization indexes nothing');
});

// ── G-P3-2 — a re-mounted method serves a sibling problem at 0 fire (FORGE arm = catalog hit), then MATCH ────
test('G-P3-2 re-mount at 0 fire: dispatch O(1), FORGE arm served by a catalog HIT, then MATCH', async () => {
	const { lib, F, target } = await warmCombo();
	const disp = lib.dispatch(target, { Segment: true, kind: 'hard' });
	assert.equal(disp.candidates.length, 1, 'dispatch finds exactly the crystallized method');
	assert.equal(disp.scanned, 1, 'it scanned ONLY the O(1) bucket, never the corpus');
	const r1 = await lib.solve({ kind: 'hard' });
	assert.equal(r1.arm, 'forge', 'the master-loop FORGE arm handled it');
	assert.equal(r1.cost, 0, 'served by a catalog HIT — 0 model calls');
	assert.equal(F.meter.n, 0, 'the host forge was NEVER invoked (the learned template served)');
	assert.ok(r1.result, 'a method was returned');
	const r2 = await lib.solve({ kind: 'hard' });
	assert.equal(r2.arm, 'match', 'the exact cache replays the repeat');
	assert.equal(r2.cost, 0);
	assert.equal(F.meter.n, 0, 'still 0 host-forge calls');
});

// ── G-P3-3 — an unseen content of the same class costs exactly one adapt call, then amortizes ────────────────
// (the adapt here is the HOST-forge branch reusing ctx.neighbours — the antiUnifyAdapt path needs ≥2
//  differing templates to generalize, and this crystal has one signature class; both satisfy the gate's
//  claim: 1 call on unseen content, then amortized.)
test('G-P3-3 adapt = exactly 1 host-forge call (structural reuse of the neighbour), then amortized', async () => {
	const { lib, F } = await warmCombo();
	const a1 = await lib.solve({ kind: 'medium' });               // unseen content, same class → adapt
	assert.equal(a1.arm, 'forge');
	assert.ok(a1.result);
	assert.equal(F.meter.n, 1, 'exactly one host-forge call (the content forge)');
	assert.ok(F.meter.nb >= 1, 'the forge received a NON-EMPTY ctx.neighbours (structural reuse)');
	const a2 = await lib.solve({ kind: 'medium' });               // repeat → amortized at the exact layer
	assert.equal(a2.arm, 'match', 'the adapted method amortizes → MATCH');
	assert.equal(F.meter.n, 1, 'no additional host-forge call');
});

// ── G-P3-4 — blame/credit localize per slot; a cross-role failure is INADMISSIBLE (the blame-gate) ──────────
test('G-P3-4 blame/credit localize per-slot (fail-closed on a cross-role failure)', () => {
	const lib = createLearningLibrary({ forge: async () => ({ result: 1, cost: 0 }) });   // learning OFF — blame/credit are pure pass-throughs
	const postSlots = { 'a==1': 'filter', 'b==2': 'aggregate' };
	const b1 = lib.blame({ postSlots, failedAtoms: ['a==1'] });
	assert.equal(b1.admissible, true);
	assert.equal(b1.role, 'filter', 'a single-role failure localizes');
	const b2 = lib.blame({ postSlots, failedAtoms: ['a==1', 'b==2'] });
	assert.equal(b2.admissible, false, 'a cross-role failure is INADMISSIBLE (the blame-gate)');
	assert.equal(b2.role, null);
	const c1 = lib.credit({ postSlots, verifiedAtoms: ['b==2'] });
	assert.deepEqual(c1.roles, ['aggregate'], 'credit localizes to exactly the exercised role');
});

// ── G-P3-5 — `.sgc` round-trip cross-restart: a v-match replays at 0 calls; a v-mismatch re-forges ──────────
test('G-P3-5 .sgc round-trip cross-restart: v-match replays at 0 calls, v-mismatch re-forges', async () => {
	const w = await warmCombo();
	await w.lib.solve({ kind: 'hard' });                          // warm the loop (populates the recall index + exact cache)
	const bundle = w.lib.pack({ name: 'c3', version: 'v1' });
	const armed = ( F ) => createLearningLibrary({ learning: true, signature: SIG, forge: F.forge, dispatchFacts: FACTS,
		target: () => ({ frontier: w.res.candidate.schema.frontier, signatureKeys: w.res.candidate.signatureKeys }) });

	// SAME-VERSION: a fresh deployment loads the bundle → re-indexes the catalog → replays at 0 host-forge calls.
	const F1 = makeAsyncForge();
	const fresh = armed(F1);
	const r = fresh.load(bundle, { version: 'v1' });
	assert.equal(r.exactReplaySafe, true, 'the version gate passed');
	assert.ok(r.catalogued >= 1, 'the loaded candidate was re-indexed into the fresh catalog');
	const s = await fresh.solve({ kind: 'hard' });
	assert.equal(F1.meter.n, 0, 'the receiver forged NOTHING — it replayed the shipped method');
	assert.equal(s.cost, 0, 'the shipped replay costs 0');

	// CROSS-VERSION: the same v1 bundle under v2 → the gate refuses (skipped>0, catalogued unset) → the receiver must re-forge.
	const F2 = makeAsyncForge();
	const fresh2 = armed(F2);
	const stale = fresh2.load(bundle, { version: 'v2' });
	assert.ok(stale.skipped > 0, 'the mismatched entries were skipped, never replayed');
	assert.ok(!stale.catalogued, 'a refused load re-indexes nothing');
	await assert.rejects(fresh2.solve({ kind: 'hard' }));         // empty receiver → the forge is invoked (no stale 0-call replay)
	assert.equal(F2.meter.n, 1, 'the cross-version receiver INVOKED the forge (re-derive, never a stale replay)');
});

// ── CONFRONT — drift ALSO invalidates the catalog template: the next solve re-forges, no stale 0-call re-hit ─
test('CONFRONT drift→catalog: a drifted method re-forges (no stale 0-call re-hit)', async () => {
	const { lib, F } = await warmCombo();
	await lib.solve({ kind: 'hard' });                            // forge arm, catalog hit, 0 calls
	const warm = await lib.solve({ kind: 'hard' });               // match
	assert.equal(warm.arm, 'match');
	assert.equal(F.meter.n, 0, 'the warm loop cost 0 host-forge calls');
	const dr = lib.drift({ kind: 'hard' });
	assert.ok(Array.isArray(dr.invalidated) && dr.invalidated.length >= 1, 'drift ALSO deletes the catalog-side template');
	const re = await lib.solve({ kind: 'hard' });
	assert.equal(re.arm, 'forge', 'the next solve re-forges (the exact cache was evicted)');
	assert.equal(F.meter.n, 1, 'the host forge was invoked EXACTLY once — the stale template did NOT re-hit at 0 calls');
	assert.ok(re.result);
});

// ── CONFRONT — a contractless forge is REJECTED (fail-closed) and the rejection is NEVER cached ─────────────
test('CONFRONT reject-not-cached: a contractless forge is REJECTED (fail-closed) and never cached', async () => {
	const { lib, F } = await warmCombo();
	F.meter.noContract = true;                                    // the forge returns a method with no sound contract
	await assert.rejects(lib.solve({ kind: 'medium' }), ( e ) => /no sound contract/.test(e.message) && e.outcome === 'reject');
	assert.equal(F.meter.n, 1, 'the forge was invoked (the gate is post-forge)');
	// FIX the forge → the SAME problem now forges (the reject was NOT cached as a 0-call result — the meter climbs again).
	F.meter.noContract = false;
	const ok = await lib.solve({ kind: 'medium' });
	assert.equal(ok.arm, 'forge', 'the fixed forge re-derives');
	assert.ok(ok.result);
	assert.equal(F.meter.n, 2, 'the meter incremented again — the rejection was never cached');
});
