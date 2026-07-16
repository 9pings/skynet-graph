'use strict';
/**
 * DECLARED-FRONTIER crystallizer (Phase 1, study doc/WIP/studies/2026-06-30-segment-as-subgraph-hrg.md).
 *
 * The §4.1 crystallizer inferred its method frontier from the literal-id surface (`inferCtx` + a `knownIds`
 * gate). That breaks the moment an endpoint is wired by a `$`-ref token, and blocks k-ary / reified signatures.
 * Phase 1 switches it to a DECLARED frontier (`declaredCtx`) — ZERO-CORE, a pure substitution at the ctx layer.
 * Each claim carries a discriminating NEGATIVE control (the test is not vacuous). I1 is the KILL-GATE: if the
 * declared path does not reproduce the existing Gap-A transfer byte-identical at equal call count, STOP.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { declaredCtx, normalizeFrontierParams, inferCtx, methodTrace, emitEquivalence, mineMethods } = require('../../plugins/learning/lib/mine.js');
const { relativize, instantiate, canon } = require('../../lib/authoring/core/abstract.js');
const { crystallizeStructural, adopt, libraryKey } = require('../../plugins/learning/lib/crystallize.js');
console.log = console.info = console.warn = () => {};

// the modeled structural provider (mirrors crystallize-miner.test.js): one intermediate between origin & target,
// the intermediate state a FUNCTION of the typed premise `kind` (so it is signature-determined / sound to crystallize).
const STATE = { hard: 'split-hard', easy: 'split-easy' };
function makeRefine() {
	const calls = [];
	const Refine = { refine( g, c, scope, argz, cb ) {
		calls.push(scope._._id);
		const base = scope._._id, origin = scope._.originNode, target = scope._.targetNode, mid = base + '_m0';
		const state = STATE[scope._.kind] || 'split-?';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true, alts: [{ mid: state, segA: base + '_a0', segB: base + '_b0' }] },
			{ _id: mid, Node: true, state },
			{ _id: base + '_a0', Segment: true, originNode: origin, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: target, parentSeg: base },
		]);
	} };
	return { Refine, calls };
}
const TREE = { childConcepts: {
	Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] },
} };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind ) => ({ _id: id, originNode: o, targetNode: t, kind });
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

async function bootGrammar( seed, conceptMap ) {
	const g = new Graph(JSON.parse(JSON.stringify(seed)), {
		label: 'decl', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
	}, conceptMap);
	await nextStable(g);
	return g;
}

// ───────────────────────────── U1 — declaredCtx round-trips a `$`-ref endpoint ─────────────────────────────
test('U1 — declaredCtx reads a `$`-ref endpoint off its declared field and round-trips (NEG: absent field → null bypass)', () => {
	// a ground patch whose endpoints are `$`-ref TOKENS, not literal ids — the case inferCtx cannot see.
	const ground = [
		{ $_id: '_parent', Refine: true, Refined: true },
		{ _id: 'E1_m0', Node: true, state: 'split-hard' },
		{ _id: 'E1_a0', Segment: true, originNode: '$start', targetNode: 'E1_m0', parentSeg: 'E1' },
		{ _id: 'E1_b0', Segment: true, originNode: 'E1_m0', targetNode: '$goal', parentSeg: 'E1' },
	];
	const params = normalizeFrontierParams(DECL);
	const ctx = declaredCtx(ground, 'E1', params);
	assert.deepEqual(ctx.refs, { origin: '$start', target: '$goal' }, 'the `$`-ref tokens are read off their declared fields (no knownIds gate)');
	assert.deepEqual(ctx.fields, { origin: 'originNode', target: 'targetNode' });

	const param = relativize(ground, ctx);
	// POS: the `$`-ref endpoints became holes and rebind to a fresh call site.
	const bound = instantiate(param, { base: 'E2', refs: { origin: 'P', target: 'Q' } });
	const a0 = bound.find(( o ) => o._id === 'E2_a0'), b0 = bound.find(( o ) => o._id === 'E2_b0');
	assert.equal(a0.originNode, 'P', 'the `$`-ref origin rebound to the new site');
	assert.equal(b0.targetNode, 'Q', 'the `$`-ref target rebound to the new site');
	assert.equal(bound.find(( o ) => o._id === 'E2_m0').state, 'split-hard', 'content replays verbatim');

	// NEG-1 (the inferred path is BLIND to a `$`-ref): inferCtx yields an empty frontier → the endpoints stay literal.
	const inf = inferCtx(ground, 'E1', new Set(['E1', 'E1_m0', 'E1_a0', 'E1_b0']));   // `$start`/`$goal` ∉ knownIds
	assert.deepEqual(inf.refs, {}, 'inferCtx cannot see a `$`-ref endpoint → empty frontier (the breakage)');
	const infBound = instantiate(relativize(ground, inf), { base: 'E2', refs: { origin: 'P', target: 'Q' } });
	assert.equal(infBound.find(( o ) => o._id === 'E2_a0').originNode, '$start', 'inferred path never rebinds the `$`-ref (wrong) — declared path fixes it');

	// NEG-2 (bypass safety): a new site MISSING the origin field → the hole is unbound → instantiate returns null.
	const miss = instantiate(param, { base: 'E2', refs: { target: 'Q' } });
	assert.equal(miss, null, 'an unbound frontier hole → null (bypass, never a silent mis-bind)');
});

// ───────────────────────────── I1 — THE KILL-GATE ─────────────────────────────
// Snapshot the re-mounted sub-graph at a fresh site E4, learning from a 3-site episode, via crystallizeStructural.
async function transferSnapshot( declaredFrontier ) {
	const { Refine, calls } = makeRefine();
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B'), node('C'), node('D')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard'), seg('E3', 'C', 'D', 'easy') ] };
	const res = await crystallizeStructural(Object.assign(
		{ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' },
		declaredFrontier ? { declaredFrontier } : {}));
	assert.equal(res.admitted, true, 'an admissible structural method is crystallized');
	const cold = calls.length;

	// adopt into a FRESH, otherwise-EMPTY grammar (cold Refine NOT wired here) + a new site E4 (kind=hard, a seen class).
	Graph._providers = {};
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'hard') ] },
		{ common: { childConcepts: {} } });
	await adopt(g2, res.candidate);
	await nextStable(g2);
	const replay = calls.length - cold;

	const ids = ['E4', 'E4_m0', 'E4_a0', 'E4_b0'];
	const sub = {};
	for ( const id of ids ) sub[id] = g2._objById[id] ? JSON.parse(JSON.stringify(g2._objById[id]._etty._)) : null;
	return { cold, replay, sub, schema: res.candidate.schema };
}

test('I1 (KILL-GATE) — the DECLARED frontier reproduces the Gap-A transfer byte-identical at 3 cold / 0 replay', async () => {
	const declared = await transferSnapshot(DECL);
	const inferred = await transferSnapshot(null);   // NEG: omit declaredFrontier → the inferred path is unchanged

	assert.equal(declared.cold, 3, 'cold: each learning site is one real provider call');
	assert.equal(declared.replay, 0, 'the re-mount cost 0 model calls (F6 transfer)');
	assert.equal(inferred.cold, 3);
	assert.equal(inferred.replay, 0);

	// the re-mounted sub-graph at E4 is byte-identical between the declared and the inferred (incumbent) paths.
	assert.deepEqual(declared.sub, inferred.sub, 'declared frontier reproduces the inferred transfer BYTE-IDENTICAL');

	// and it is the RIGHT sub-graph (the gate is not vacuously comparing two nulls).
	assert.equal(declared.sub['E4_m0'].state, 'split-hard', 'the learned content (kind=hard → split-hard) replayed');
	assert.equal(declared.sub['E4_a0'].originNode, 'X', 'first child wired to the NEW origin (structural hole rebound)');
	assert.equal(declared.sub['E4_b0'].targetNode, 'Y', 'second child wired to the NEW target');
	assert.equal(declared.sub['E4'].CrystalRefine, true, 'the crystal cast marker is set (no re-fire / divergence)');
	assert.ok(!declared.sub['E4_m0'].state.includes('easy'), 'no cross-class leak');
});

// ───────────────────────────── U2 — emitMethodAsSubgraph reproduces the body (validated, behind opts.graph) ─────────
test('U2 — the engine-native emit reproduces the captured body up to bookkeeping; the crystallizer keeps the captured param', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	Graph._providers = Object.assign({}, Graph._providers, { Refine });
	const mt = methodTrace();
	const g = new Graph(JSON.parse(JSON.stringify(seed)), {
		label: 'u2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
	}, { common: JSON.parse(JSON.stringify(TREE)) });
	mt.listen(g);
	await nextStable(g);

	// mined WITH a live graph → the engine-native emit is exercised + validated per method.
	const methods = mt.methods(TREE, { declaredFrontier: normalizeFrontierParams(DECL), graph: g });
	const m = methods.find(( x ) => x.concept === 'Refine');
	assert.equal(m.emitEquivalent, true, 'emitMethodAsSubgraph reproduces the relativized body (same skeleton/holes/content)');

	// HONESTY control — the RAW forms are NOT byte-identical: emit serializes the live body only (no parent cast object)
	// and keeps `_origin` + uses `_id` where the captured patch carries `$$_id`. THAT is why the crystallizer keeps the
	// captured-patch param (which also carries the parent's Refined/alts the emit drops), not the bare emit.
	const chk = emitEquivalence(g, m.instances[0].ground, m.instances[0].ctx, m.instances[0].target);
	assert.equal(chk.equivalent, true);
	assert.notEqual(canon(chk.emit), canon(chk.captured), 'raw emit ≠ raw captured (engine bookkeeping: _origin / _id vs $$_id) → fall back to the captured param');
	assert.ok(JSON.stringify(chk.emit).includes('_origin'), 'the engine-native emit carries _origin (bookkeeping the captured patch strips)');
});

// ───────────────────────────── T3 — the reified FrontierSignature lands on the schema ─────────────────────────────
test('T3 — crystallizeStructural reifies the FrontierSignature (params/sort/field + summaryFacts + appConditions + summary) onto the schema', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	const f = res.candidate.schema.frontier;
	assert.ok(f, 'schema.frontier is reified (sibling of schema.contract)');
	assert.deepEqual(f.params.map(( p ) => p.name).sort(), ['origin', 'target'], 'the declared endpoints are the params');
	for ( const p of f.params ) {
		assert.equal(p.role, 'endpoint');
		assert.equal(p.sort, 'node-ref', 'the Laurie param.sort field is present');
	}
	assert.deepEqual(f.params.find(( p ) => p.name === 'origin').field, 'originNode', 'the param records its frontier field');
	assert.deepEqual(f.summaryFacts, ['Refined==true'], 'summaryFacts ← the contract post (the Phase-2 proxy summary)');
	assert.deepEqual(f.appConditions.require, ['Segment', 'kind'], 'appConditions ← the parent require (the NACs)');
	assert.ok(f.summary && Array.isArray(f.summary.facts), 'the Laurie summary slot is declared (Phase-1 declared / Phase-2 enforced)');
	// the signature serializes with the tree (round-trips through JSON — rollback coherence).
	assert.deepEqual(JSON.parse(JSON.stringify(f)), f, 'the FrontierSignature is plain-serializable (serializes with the tree / rollback)');
});

// ───────────────────────────── I2 — `$`-ref endpoint: inferred fails, declared rebinds ─────────────────────────────
test('I2 — a `$`-ref endpoint: the inferred miner cannot rebind it (NEG), the declared miner does', () => {
	const mkRec = ( base, oRef, tRef ) => ({
		concept: 'Refine', target: base,
		patch: [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: base + '_m0', Node: true, state: 'split-hard' },
			{ _id: base + '_a0', Segment: true, originNode: oRef, targetNode: base + '_m0', parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: base + '_m0', targetNode: tRef, parentSeg: base },
		],
		premise: { Segment: true, kind: 'hard' },
	});
	const records = [ mkRec('E1', '$start1', '$goal1'), mkRec('E2', '$start2', '$goal2') ];

	// INFERRED (the `$`-ref tokens are not among knownIds) → the endpoint reads as within-class varying CONTENT →
	// not signature-determined → REFUSED, and no frontier is recovered. This is the breakage the declared path fixes.
	const knownIds = new Set(['E1', 'E1_m0', 'E1_a0', 'E1_b0', 'E2', 'E2_m0', 'E2_a0', 'E2_b0']);
	const inf = mineMethods(records, TREE, { knownIds }).find(( m ) => m.concept === 'Refine');
	assert.deepEqual(inf.frontier, [], 'inferred: the `$`-ref endpoint is invisible → empty frontier');
	assert.equal(inf.signatureDetermined, false, 'inferred: the endpoint looks like nondeterministic content → refused');

	// DECLARED → origin/target are frontier holes → the param is identical across sites → signature-determined + rebinds.
	const dec = mineMethods(records, TREE, { declaredFrontier: normalizeFrontierParams(DECL) }).find(( m ) => m.concept === 'Refine');
	assert.deepEqual(dec.frontier, ['origin', 'target'], 'declared: both endpoints are frontier params');
	assert.equal(dec.signatureDetermined, true);
	assert.equal(dec.admissible, true);
	const bound = instantiate(dec.skeleton, { base: 'E9', refs: { origin: 'NEW_O', target: 'NEW_T' } });
	assert.equal(bound.find(( o ) => o._id === 'E9_a0').originNode, 'NEW_O', 'declared: the `$`-ref origin rebinds to a fresh site');
	assert.equal(bound.find(( o ) => o._id === 'E9_b0').targetNode, 'NEW_T', 'declared: the `$`-ref target rebinds to a fresh site');
});

// ───────────────────────────── I3 — k-ary (3-frontier) admits + rebinds ─────────────────────────────
const STAR_TREE = { childConcepts: {
	Star: { _id: 'Star', _name: 'Star', require: ['hub', 'kind'], ensure: ['!$Starred'], provider: ['Star::star'] },
} };
function makeStar() {
	const calls = [];
	const Star = { star( g, c, scope, argz, cb ) {
		calls.push(scope._._id);
		const base = scope._._id, n0 = scope._.n0, n1 = scope._.n1, n2 = scope._.n2, center = base + '_c';
		cb(null, [
			{ $_id: '_parent', Star: true, Starred: true },
			{ _id: center, Node: true, role: 'hub', n0, n1, n2 },                         // echoes the endpoints under their declared fields
			{ _id: base + '_s0', Segment: true, originNode: center, targetNode: n0, parentSeg: base },
			{ _id: base + '_s1', Segment: true, originNode: center, targetNode: n1, parentSeg: base },
			{ _id: base + '_s2', Segment: true, originNode: center, targetNode: n2, parentSeg: base },
		]);
	} };
	return { Star, calls };
}
const hub = ( id, n0, n1, n2 ) => ({ _id: id, hub: true, kind: 'star', n0, n1, n2 });
const STAR_DECL = { a: { field: 'n0' }, b: { field: 'n1' }, c: { field: 'n2' } };

test('I3 — a k-ary (3-frontier) structural method admits and rebinds all three endpoints', async () => {
	const { Star, calls } = makeStar();
	const seed = { lastRev: 0,
		nodes: [node('P'), node('Q'), node('R'), node('P2'), node('Q2'), node('R2'), hub('H1', 'P', 'Q', 'R'), hub('H2', 'P2', 'Q2', 'R2')],
		segments: [] };
	const res = await crystallizeStructural({ episodeTree: STAR_TREE, seed, providers: { Star }, equivKeys: ['Starred'], idFor: () => 'CrystalStar', declaredFrontier: STAR_DECL });
	assert.equal(res.admitted, true, 'the 3-frontier method is admissible (not baked rank-2)');
	assert.deepEqual(res.candidate.schema.frontier.params.map(( p ) => p.name).sort(), ['a', 'b', 'c'], 'three declared frontier endpoints');
	const cold = calls.length;
	assert.equal(cold, 2, 'two learning sites, cold');

	// adopt into a fresh empty grammar + a new hub with THREE fresh endpoints (a seen signature class: kind=star).
	Graph._providers = {};
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y'), node('Z'), hub('F1', 'X', 'Y', 'Z')], segments: [] },
		{ common: { childConcepts: {} } });
	await adopt(g2, res.candidate);
	await nextStable(g2);

	assert.equal(calls.length, cold, '0 new model calls (k-ary F6 transfer)');
	assert.ok(g2._objById['F1_c'], 'the center is re-mounted');
	assert.equal(g2._objById['F1_s0']._etty._.targetNode, 'X', 'endpoint a rebound to the new site');
	assert.equal(g2._objById['F1_s1']._etty._.targetNode, 'Y', 'endpoint b rebound');
	assert.equal(g2._objById['F1_s2']._etty._.targetNode, 'Z', 'endpoint c rebound');
	assert.equal(g2._objById['F1']._etty._.CrystalStar, true, 'cast marker set (no divergence)');
});

// ───────────────────────────── I4 — behavioral-param sort routes selection; untyped → rejected (H3) ──────────────
test('I4 — a behavioral-param sort routes library selection; an untyped behavioral param is rejected at author time', async () => {
	const base = [{ name: 'origin', role: 'endpoint', sort: 'node-ref' }, { name: 'target', role: 'endpoint', sort: 'node-ref' }];
	const withSub  = { params: base.concat([{ name: 'step', role: 'submethod', sort: 'method-ref' }]) };
	const withPred = { params: base.concat([{ name: 'stop', role: 'predicate', sort: 'predicate-ref' }]) };
	const k1 = libraryKey(withSub, ['Segment', 'kind']);
	assert.notEqual(k1, libraryKey(withPred, ['Segment', 'kind']), 'different behavioral-param sort → different library key (sort routes selection)');
	assert.equal(k1, libraryKey(withSub, ['Segment', 'kind']), 'the key is deterministic');
	assert.notEqual(k1, libraryKey(withSub, ['Segment', 'region']), 'the typed signature also routes (different signature → different key)');

	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };

	// a TYPED behavioral param: admits (lint clean) + is indexed in the FrontierSignature, NOT yet mounted (Phase 1).
	const { Refine } = makeRefine();
	const typed = { origin: { field: 'originNode' }, target: { field: 'targetNode' },
		step: { role: 'submethod', sort: 'method-ref', in: 'kase', out: 'kase', frontier: ['elem'] } };
	const okRes = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: typed });
	assert.equal(okRes.admitted, true, 'a typed behavioral param admits');
	assert.ok(okRes.candidate.schema.frontier.params.some(( p ) => p.role === 'submethod' && p.sort === 'method-ref'), 'the behavioral param is indexed in the FrontierSignature');
	assert.ok(okRes.candidate.schema.libraryKey, 'the schema carries the O(1) library-dispatch key');

	// an UNTYPED behavioral param (no in/out/frontier): rejected at author time (H3 lint).
	const { Refine: R2 } = makeRefine();
	const untyped = { origin: { field: 'originNode' }, target: { field: 'targetNode' }, step: { role: 'submethod', sort: 'method-ref' } };
	const badRes = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine: R2 }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: untyped });
	assert.equal(badRes.admitted, false, 'an untyped behavioral param is rejected');
	assert.match(badRes.reason, /untyped-behavioral-param/);
});

// ───────────────────────────── SOUNDNESS — an under-declared (ambiguous) frontier field is refused ──────────────
test('SOUNDNESS — a declared field resolving to >1 external value is refused (no silent leak); distinct fields admit', async () => {
	// declaredCtx unit: two distinct external sources under ONE declared field → flagged ambiguous (NEG); the same body
	// with the sources echoed under DISTINCT fields, declared as two params → clean (CONTROL).
	const ground = [
		{ $_id: '_parent', Join: true, Joined: true },
		{ _id: 'J1_c', Node: true, role: 'join', srcA: 'U', srcB: 'V' },
		{ _id: 'J1_a0', Segment: true, originNode: 'U', targetNode: 'J1_c', parentSeg: 'J1' },
		{ _id: 'J1_b0', Segment: true, originNode: 'V', targetNode: 'J1_c', parentSeg: 'J1' },
	];
	const amb = declaredCtx(ground, 'J1', normalizeFrontierParams({ x: { field: 'originNode' } }));
	assert.ok(amb.ambiguous, 'two externals under one field → ambiguous (would leak the second on replay)');
	assert.deepEqual(amb.ambiguous[0].values.sort(), ['U', 'V']);
	const ok = declaredCtx(ground, 'J1', normalizeFrontierParams({ a: { field: 'srcA' }, b: { field: 'srcB' } }));
	assert.ok(!ok.ambiguous, 'distinct fields → one external each → no ambiguity');
	assert.deepEqual(ok.refs, { a: 'U', b: 'V' });

	// end-to-end: crystallizeStructural REFUSES the under-declared field, ADMITS the distinct-field declaration.
	const calls = [];
	const Join = { join( g, c, scope, argz, cb ) {
		calls.push(scope._._id);
		const base = scope._._id, u = scope._.srcA, v = scope._.srcB, center = base + '_c';
		cb(null, [
			{ $_id: '_parent', Join: true, Joined: true },
			{ _id: center, Node: true, role: 'join', srcA: u, srcB: v },
			{ _id: base + '_a0', Segment: true, originNode: u, targetNode: center, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: v, targetNode: center, parentSeg: base },
		]);
	} };
	const JTREE = { childConcepts: { Join: { _id: 'Join', _name: 'Join', require: ['join', 'kind'], ensure: ['!$Joined'], provider: ['Join::join'] } } };
	const jnode = ( id, a, b ) => ({ _id: id, join: true, kind: 'merge', srcA: a, srcB: b });
	// both learning sites share the SAME two sources (U,V) → the un-holed second external is CONSTANT across the corpus,
	// so signatureDetermined PASSES; only the explicit ambiguity guard stops the leak (V would replay verbatim onto a
	// fresh site). This is the case the guard uniquely catches.
	const seed = { lastRev: 0, nodes: [node('U'), node('V'), jnode('J1', 'U', 'V'), jnode('J2', 'U', 'V')], segments: [] };

	const bad = await crystallizeStructural({ episodeTree: JTREE, seed, providers: { Join }, equivKeys: ['Joined'], idFor: () => 'CJ', declaredFrontier: { x: { field: 'originNode' } } });
	assert.equal(bad.admitted, false, 'the under-declared field is refused (the constant second external would leak at replay)');
	assert.match(bad.reason, /frontier-field-ambiguous/);

	const good = await crystallizeStructural({ episodeTree: JTREE, seed, providers: { Join }, equivKeys: ['Joined'], idFor: () => 'CJ', declaredFrontier: { a: { field: 'srcA' }, b: { field: 'srcB' } } });
	assert.equal(good.admitted, true, 'declaring one param per endpoint admits (sound, not a cap on expressivity)');
	assert.deepEqual(good.candidate.schema.frontier.params.map(( p ) => p.name).sort(), ['a', 'b']);
});

// ───────────── REGRESSION (adversarial review) — the declared path keeps the id-space invariant ─────────────
// Hole 1: an external endpoint OMITTED from the declaration, CONSTANT across the corpus, would leak its learning id
// into a fresh re-mount (orphan / silent mis-wire). The crystallizer must refuse — and the inferred path (which
// auto-holes every knownId external) must still succeed on the same corpus (proving it is the omission that is caught).
test('REGRESSION hole-1 — an undeclared constant endpoint is refused (frontier-endpoint-leak); inferred holes it', async () => {
	const seed = { lastRev: 0, nodes: [node('S'), node('A'), node('G')], segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'G', 'hard') ] };
	const { Refine } = makeRefine();
	const leak = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CR', declaredFrontier: { origin: { field: 'originNode' } } });
	assert.equal(leak.admitted, false, 'omitting the (constant) target endpoint → refused, not a silent leak');
	assert.match(leak.reason, /frontier-endpoint-leak/);

	// CONTROL — the inferred path auto-holes G (a knownId external) and rebinds soundly on the SAME corpus.
	const { Refine: R2, calls } = makeRefine();
	const inferred = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine: R2 }, equivKeys: ['Refined'], idFor: () => 'CR' });
	assert.equal(inferred.admitted, true, 'inferred path admits (G is holed as a knownId external) — it is the declared OMISSION that leaks');
	Graph._providers = {};
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'hard') ] }, { common: { childConcepts: {} } });
	await adopt(g2, inferred.candidate); await nextStable(g2);
	assert.equal(g2._objById['E4_b0']._etty._.targetNode, 'Y', 'inferred re-mount wires to the NEW target (no leak)');

	// and the FIX is not over-broad: declaring BOTH endpoints admits + rebinds.
	const { Refine: R3 } = makeRefine();
	const ok = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine: R3 }, equivKeys: ['Refined'], idFor: () => 'CR', declaredFrontier: DECL });
	assert.equal(ok.admitted, true, 'declaring both endpoints admits (the guard is targeted, not a cap)');
});

// Hole 3: two DISTINCT declared endpoints that coincide in value during learning (self-loops) collapse to one hole
// under relativize's match-by-value → a fresh site where they differ mis-binds. Refuse the indistinguishable pair.
test('REGRESSION hole-3 — coincident distinct endpoints are refused (frontier-endpoints-collapsed); non-coincident admit', async () => {
	const loops = { lastRev: 0, nodes: [node('U'), node('W')], segments: [ seg('E1', 'U', 'U', 'hard'), seg('E2', 'W', 'W', 'hard') ] };
	const { Refine } = makeRefine();
	const collapse = await crystallizeStructural({ episodeTree: TREE, seed: loops, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CR', declaredFrontier: DECL });
	assert.equal(collapse.admitted, false, 'origin==target across the corpus → indistinguishable → refused');
	assert.match(collapse.reason, /frontier-endpoints-collapsed/);

	// CONTROL — non-coincident endpoints (origin≠target) admit + rebind both ends distinctly.
	const distinct = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')], segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const { Refine: R2 } = makeRefine();
	const ok = await crystallizeStructural({ episodeTree: TREE, seed: distinct, providers: { Refine: R2 }, equivKeys: ['Refined'], idFor: () => 'CR', declaredFrontier: DECL });
	assert.equal(ok.admitted, true);
	Graph._providers = {};
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'hard') ] }, { common: { childConcepts: {} } });
	await adopt(g2, ok.candidate); await nextStable(g2);
	assert.equal(g2._objById['E4_a0']._etty._.originNode, 'X');
	assert.equal(g2._objById['E4_b0']._etty._.targetNode, 'Y', 'distinct endpoints rebind to distinct fresh ends (no collapse)');
});

// Review nit (H1/H3): a behavioral role with a NON-behavioral sort (e.g. submethod + node-ref) is a mis-declaration.
test('REGRESSION lint — a behavioral role with a node-ref sort is rejected (role-sort-mismatch)', async () => {
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')], segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const { Refine } = makeRefine();
	const bad = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CR',
		declaredFrontier: { origin: { field: 'originNode' }, target: { field: 'targetNode' }, step: { role: 'submethod', sort: 'node-ref', in: 'kase', out: 'kase', frontier: ['elem'] } } });
	assert.equal(bad.admitted, false, 'a submethod param with a node-ref sort is a mis-declaration');
	assert.match(bad.reason, /untyped-behavioral-param/);
	assert.ok(bad.lint.errors.some(( e ) => e.kind === 'role-sort-mismatch'), 'the lint flags the role/sort mismatch');
});

// Hole (focused review) — an external endpoint id starting with `<castTarget>_` is mis-holed as ⟦@base⟧… by
// relativizeVal (it looks base-derived) → at replay it resolves to a non-existent `<newBase>…` phantom. Guard A's
// LITERAL check is blind (hasHoles===true); the PHANTOM check (a base-derived endpoint hole must name a CREATED object)
// catches it. Control: a non-base-prefixed external of the same shape admits + rebinds soundly.
test('REGRESSION phantom — a base-prefixed external endpoint (mis-holed) is refused; a non-prefixed one admits', async () => {
	function makeR() {
		const calls = [];
		const Refine = { refine( g, c, scope, argz, cb ) {
			calls.push(scope._._id);
			const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
			cb(null, [
				{ $_id: '_parent', Refine: true, Refined: true },
				{ _id: mid, Node: true, state: 'split-' + scope._.kind },
				{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
				{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
			]);
		} };
		return { Refine, calls };
	}
	// targets named `<segId>_goal` (base-prefixed) → relativizeVal absorbs them into the ⟦@base⟧ id-space.
	const { Refine } = makeR();
	const prefixed = { lastRev: 0, nodes: [node('S'), node('A'), node('E1_goal'), node('E2_goal')],
		segments: [ seg('E1', 'S', 'E1_goal', 'hard'), seg('E2', 'A', 'E2_goal', 'hard') ] };
	const bad = await crystallizeStructural({ episodeTree: TREE, seed: prefixed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CR', declaredFrontier: DECL });
	assert.equal(bad.admitted, false, 'a base-prefixed (mis-holed) external endpoint is refused, not a phantom replay');
	assert.match(bad.reason, /frontier-endpoint-leak.*phantom/);

	// CONTROL — same shape, non-base-prefixed targets → declared frontier holes them as ⟦@ref:target⟧ → admits + rebinds.
	const { Refine: R2 } = makeR();
	const plain = { lastRev: 0, nodes: [node('S'), node('A'), node('GoalA'), node('GoalB')],
		segments: [ seg('E1', 'S', 'GoalA', 'hard'), seg('E2', 'A', 'GoalB', 'hard') ] };
	const ok = await crystallizeStructural({ episodeTree: TREE, seed: plain, providers: { Refine: R2 }, equivKeys: ['Refined'], idFor: () => 'CR', declaredFrontier: DECL });
	assert.equal(ok.admitted, true, 'a non-prefixed external endpoint is a proper ⟦@ref⟧ hole → admits');
	Graph._providers = {};
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'hard') ] }, { common: { childConcepts: {} } });
	await adopt(g2, ok.candidate); await nextStable(g2);
	assert.equal(g2._objById['E4_b0']._etty._.targetNode, 'Y', 'control re-mount wires to the real new target Y (no phantom)');
	assert.ok(!g2._objById['E4_goal'], 'no phantom node was referenced');
});
