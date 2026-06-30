'use strict';
/**
 * conceptual BLENDING — Boden's COMBINATIONAL creativity (creative loop, brick C, the deepest adapt; study
 * 2026-06-30-creative-loop-two-level-grammar.md). Graft a DONOR method's body into a HOST method's segment SLOT →
 * a NEW method that is neither parent (a 1-level decompose host + a 1-level decompose donor → a 2-level decompose).
 * The blend's OUTER interface is the host's (it dispatches/mounts like the host); the BODY is recombined. Each claim
 * carries a discriminating NEG control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { crystallizeStructural } = require('../../lib/authoring/crystallize.js');
const { blendMethods, segmentSlots, composeContract, synthesizeByBlend, methodDepth } = require('../../lib/authoring/adapt.js');
const { makeLibrary, indexMethod } = require('../../lib/authoring/library.js');
const { blendAtSegment, instantiate, ctxFromScope, BASE, hasHoles } = require('../../lib/authoring/abstract.js');
const { injectMarker, guardKey } = require('../../lib/authoring/combinator.js');
console.log = console.info = console.warn = () => {};

const ground = ( kind ) => 'plan-' + kind;
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, Segment: true, originNode: o, targetNode: t }, extra || {});
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

async function learn( kind ) {
	const Refine = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: mid, Node: true, state: ground(scope._.kind) },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
	const nodes = [], segments = [];
	for ( let s = 0; s < 2; s++ ) { const a = `${kind}a${s}`, b = `${kind}b${s}`; nodes.push(node(a), node(b)); segments.push(seg(`${kind}E${s}`, a, b, { kind })); }
	const res = await crystallizeStructural({ episodeTree: TREE, seed: { lastRev: 0, nodes, segments }, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'Crystal' + kind, declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	return res.candidate;
}

test('blendAtSegment — grafts a DONOR method into a host segment slot → a 2-level CROSS-METHOD blend (no id collision)', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const hostTpl = Object.values(host.templatesBySig)[0], donorTpl = Object.values(donor.templatesBySig)[0];
	const slot = BASE + '_a0';                                        // graft into the host's first child segment
	const blended = blendAtSegment(hostTpl, slot, donorTpl);
	assert.ok(blended, 'blend produced a template');
	assert.equal(blended.length, 7, '4 host objects (1 now decomposed) + 3 donor body objects nested under the slot');
	const g = instantiate(blended, { base: 'Z', refs: { origin: 'X', target: 'Y' } });
	const ids = g.map(( o ) => o.$$_id || o.$_id || o._id);
	assert.equal(new Set(ids).size, ids.length, 'all ids unique — no collision (donor nested under the slot id-space)');
	assert.ok(!JSON.stringify(g).includes('⟦@'), 'fully ground (every hole bound)');
	const byId = ( id ) => g.find(( o ) => (o.$$_id || o._id) === id );
	assert.equal(byId('Z_m0').state, 'plan-hard', "the HOST's mid content is kept");
	assert.equal(byId('Z_a0_m0').state, 'plan-easy', "the DONOR's content is grafted at the slot — a genuine cross-method blend");
	assert.equal(byId('Z_a0').Refined, true, 'the grafted slot segment became a decomposed parent');
	assert.equal(byId('Z_a0_a0').originNode, 'X', 'interface re-bound: sub-path starts at the OUTER origin');
	assert.equal(byId('Z_a0_b0').targetNode, 'Z_m0', 'interface re-bound: sub-path ends at the host mid → X→subMid→midA→Y');
});

test('blendMethods — a blended CANDIDATE keeps the host OUTER interface, inherits the contract, MOUNTS a 2-level decomposition on the real engine', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const blended = blendMethods(host, donor);
	assert.ok(blended, 'a blended candidate is built');
	assert.deepEqual(blended.signatureKeys, host.signatureKeys, 'the OUTER signature is the host’s (dispatches/mounts like the host)');
	assert.ok(blended.schema && blended.schema.contract, 'inherits the host contract (the verifier gate passes)');
	assert.deepEqual(blended.blendedFrom, ['Crystalhard', 'Crystaleasy'], 'provenance recorded');

	// mount the blended method on a real graph via a Decompose combinator that dispatches it.
	const tpl = Object.values(blended.templatesBySig)[0];
	const provider = function ( g, c, scope, argz, cb ) {
		const ctx = ctxFromScope(scope, { frontier: { origin: 'originNode', target: 'targetNode' } });
		const gr = ctx && instantiate(tpl, ctx);
		return cb(null, gr ? injectMarker(gr, ctx.base, 'Decompose') : { $_id: '_parent', Decompose: true, [guardKey('Decompose')]: true });
	};
	Graph._providers = { Creative: { Decompose: provider } };
	const D = { _id: 'Decompose', _name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'], ensure: ['!$' + guardKey('Decompose')], provider: ['Creative::Decompose'] };
	const gph = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] }, { label: 'blend', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: { childConcepts: { Decompose: D } } });
	await nextStable(gph);
	await new Promise(( res ) => gph.pushMutation(seg('Z', 'X', 'Y', { kind: 'hard', toDecompose: true }), null, undefined, undefined, undefined, () => res()));
	await nextStable(gph);

	const o = ( id ) => gph._objById[id] && gph._objById[id]._etty._;
	assert.ok(o('Z_m0') && o('Z_a0_m0'), 'BOTH mids mounted — the 2-level blended decomposition');
	assert.equal(o('Z_m0').state, 'plan-hard', "host's mid");
	assert.equal(o('Z_a0_m0').state, 'plan-easy', "donor's grafted sub-mid");
	assert.equal(o('Z_a0_a0').originNode, 'X', 'sub-path wired from the new origin');
	assert.equal(o('Z_a0_b0').targetNode, 'Z_m0', 'sub-path wired to the host mid');
	assert.ok(gph.getRevisions().length < 100, 'bounded — no apply-cap runaway');
	assert.ok(!gph._objById['hardE0'] && !gph._objById['easya0'], 'no learning-episode id-space leaked (sound)');
});

// mount a candidate's template at a fresh site via a Decompose combinator (instantiate + self-flag). Returns the graph.
async function mountCandidate( cand, baseId ) {
	const tpl = Object.values(cand.templatesBySig)[0];
	const provider = function ( g, c, scope, argz, cb ) {
		const ctx = ctxFromScope(scope, { frontier: { origin: 'originNode', target: 'targetNode' } });
		const gr = ctx && instantiate(tpl, ctx);
		return cb(null, gr ? injectMarker(gr, ctx.base, 'Decompose') : { $_id: '_parent', Decompose: true, [guardKey('Decompose')]: true });
	};
	Graph._providers = { Creative: { Decompose: provider } };
	const D = { _id: 'Decompose', _name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'], ensure: ['!$' + guardKey('Decompose')], provider: ['Creative::Decompose'] };
	const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] }, { label: 'mt', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: { childConcepts: { Decompose: D } } });
	await nextStable(g);
	await new Promise(( res ) => g.pushMutation(seg(baseId, 'X', 'Y', { kind: 'hard', toDecompose: true }), null, undefined, undefined, undefined, () => res()));
	await nextStable(g);
	return g;
}

test('BLEND = zero-shot compositional synthesis — a DEPTH-2 method built from ONE library part at 0 model calls, producing structure the parent ALONE cannot', async () => {
	const m1 = await learn('hard');                                  // a depth-1 decompose method (kind-triggered)
	// synthesize a depth-2 method by blending M1 into itself — 0 model calls, 0 training examples (pure surgery over
	// the library). A cache can only REPLAY a derived method (it never derived this one); crystallize would need ≥2
	// observed depth-2 traces (which do not exist). This is the one capability beyond both.
	const blend = blendMethods(m1, m1);
	assert.ok(blend && blend.contractDerived, 'the blend carries a DERIVED (composed) contract, not merely inherited');

	// the blend produces a 2-LEVEL decomposition; M1 ALONE produces only 1 level (its children lack the `kind`
	// trigger, so it does NOT recurse — the confound is closed). So the blend solves "reach depth 2" that M1 cannot.
	const gBlend = await mountCandidate(blend, 'Z');
	assert.ok(gBlend._objById['Z_m0'] && gBlend._objById['Z_a0_m0'], 'blend → a level-1 mid AND a level-2 sub-mid (depth-2)');

	const gM1 = await mountCandidate(m1, 'Z');
	assert.ok(gM1._objById['Z_m0'], 'M1 produced its level-1 mid');
	assert.ok(!gM1._objById['Z_a0_m0'], 'M1 ALONE cannot reach depth-2 (no kind on its children → no recursion) — neither parent solves it');
	assert.ok(gM1._objById['Z_a0'] && !gM1._objById['Z_a0']._etty._.Refined, 'M1’s child segment is NOT itself decomposed (depth-1 only)');
});

test('synthesizeByBlend — the controller AUTO-DISCOVERS the blend to reach a goal depth, at 0 model calls, with bounded μ-descent termination', async () => {
	const m1 = await learn('hard');                                  // a depth-1 library method
	assert.equal(methodDepth(m1), 1, 'M1 is depth-1');
	const lib = makeLibrary(); indexMethod(lib, m1);
	const target = { frontier: m1.schema.frontier, signatureKeys: m1.signatureKeys };
	const scopeFacts = { Segment: true, kind: 'hard' };
	const deep = ( n ) => ( c ) => methodDepth(c) >= n;              // the goal: reach structural depth n

	// goal depth-1 → a single dispatched method SATISFIES → no blend (retrieve).
	const r0 = synthesizeByBlend({ lib, target, scopeFacts, satisfies: deep(1), maxDepth: 3 });
	assert.equal(r0.outcome, 'retrieve'); assert.equal(r0.calls, 0);

	// goal depth-2 → the controller BLENDS once (synthesizes depth-2) at 0 model calls.
	const r2 = synthesizeByBlend({ lib, target, scopeFacts, satisfies: deep(2), maxDepth: 3 });
	assert.equal(r2.outcome, 'blend'); assert.equal(r2.depth, 2); assert.equal(r2.calls, 0, 'compositional synthesis is 0 model calls');

	// goal depth-3 → iterated deepening at the DEEPEST slot reaches depth-3 (still 0 calls).
	const r3 = synthesizeByBlend({ lib, target, scopeFacts, satisfies: deep(3), maxDepth: 4 });
	assert.equal(r3.outcome, 'blend'); assert.equal(r3.depth, 3);
	// the depth-3 synthesized method is SOUND (instantiates with all-unique ids, no leftover hole).
	const g = instantiate(Object.values(r3.candidate.templatesBySig)[0], { base: 'Z', refs: { origin: 'X', target: 'Y' } });
	const ids = g.map(( o ) => o.$$_id || o.$_id || o._id);
	assert.equal(new Set(ids).size, ids.length, 'depth-3 synthesis: all ids unique (no collision)');
	assert.ok(!JSON.stringify(g).includes('⟦@'), 'depth-3 synthesis: fully ground');

	// NEG (TERMINATION) — an unsatisfiable goal (depth-9) under maxDepth → bounded reject, NO runaway.
	const rej = synthesizeByBlend({ lib, target, scopeFacts, satisfies: deep(9), maxDepth: 3 });
	assert.equal(rej.outcome, 'reject'); assert.match(rej.reason, /maxDepth|μ-descent/);
	assert.ok(rej.depth <= 4, 'bounded: depth reached ≤ 1 + maxDepth (the μ-measure terminated the search)');

	// NEG — an empty library → reject (nothing to compose), not a crash.
	const empty = synthesizeByBlend({ lib: makeLibrary(), target, scopeFacts, satisfies: deep(2), maxDepth: 3 });
	assert.equal(empty.outcome, 'reject'); assert.match(empty.reason, /no neighbour/);
});

test('composeContract — the blend contract is the UNION of both parents (derived, not inherited); NEG: drops nothing', () => {
	const a = { read: ['Segment', 'kind'], write: ['Refined', 'state'], pre: [], post: ['Refined==true'], effect: 'pure' };
	const b = { read: ['Segment', 'priority'], write: ['Refined', 'subState'], pre: [], post: ['subState!=null'], effect: 'pure' };
	const c = composeContract(a, b);
	assert.deepEqual(c.read.sort(), ['Segment', 'kind', 'priority'].sort(), 'reads unioned');
	assert.deepEqual(c.write.sort(), ['Refined', 'state', 'subState'].sort(), 'writes unioned (the donor’s writes are NOT dropped — closes the inherited-contract hole)');
	assert.deepEqual(c.post.sort(), ['Refined==true', 'subState!=null'].sort(), 'both posts conjoined (the runtime monitor checks BOTH)');
	assert.equal(composeContract(a, null).write.length, 2, 'a missing donor contract → host contract verbatim (no crash)');
	assert.equal(composeContract(null, null), null, 'both absent → null');
});

test('segmentSlots — lists the GRAFTABLE child-segment slots of a method (the outer parent is not a slot)', async () => {
	const host = await learn('hard');
	const slots = segmentSlots(Object.values(host.templatesBySig)[0]);
	assert.deepEqual(slots.sort(), [BASE + '_a0', BASE + '_b0'], 'the two child segments are the slots; the parent (⟦@base⟧) is not');
});

test('blendMethods / blendAtSegment — NEG controls (no false blend)', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const hostTpl = Object.values(host.templatesBySig)[0];
	// NEG — an unknown slot id → null (no graft anywhere).
	assert.equal(blendAtSegment(hostTpl, '⟦@base⟧_nope', Object.values(donor.templatesBySig)[0]), null, 'unknown slot → null');
	// NEG — a non-segment slot (the mid NODE, no endpoints) → null.
	assert.equal(blendAtSegment(hostTpl, BASE + '_m0', Object.values(donor.templatesBySig)[0]), null, 'a node slot (no originNode/targetNode) → null');
	// NEG — a host with NO child-segment slot → blendMethods returns null (nothing graftable).
	const leaf = { schema: { _id: 'Leaf', contract: { post: [] } }, signatureKeys: ['k'], templatesBySig: { x: [{ $_id: '_parent', Leaf: true, $$_id: BASE }] } };
	assert.equal(blendMethods(leaf, donor), null, 'no segment slot in the host → null');
});
