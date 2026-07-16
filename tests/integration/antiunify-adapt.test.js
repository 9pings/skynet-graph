'use strict';
/**
 * antiUnify CONTENT-FORGE adapt — built INTO the adapt-or-forge controller (creative loop, brick C, the richer
 * adapt; study 2026-06-30-creative-loop-two-level-grammar.md). On a MISS, instead of re-forging the whole method
 * (or a host hard-coding "swap field X"), the controller GENERALIZES the neighbour's own templates (Plotkin LGG)
 * to auto-discover the content holes, forges ONLY those (the model), and reuses the skeleton + structural holes
 * verbatim — inheriting the neighbour's contract. Each claim carries a discriminating NEG control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { crystallizeStructural } = require('../../plugins/learning/lib/crystallize.js');
const { makeLibrary, indexMethod } = require('../../plugins/learning/lib/library.js');
const { adaptOrForge, antiUnifyAdapt, methodContentHoles } = require('../../plugins/learning/lib/adapt.js');
const { instantiate, hasHoles } = require('../../lib/authoring/core/abstract.js');
const { digest } = require('../../lib/providers/canonicalize.js');
console.log = console.info = console.warn = () => {};

const ground = ( kind ) => 'plan-' + kind;
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, Segment: true, originNode: o, targetNode: t }, extra || {});
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( k in facts ) o[k] = facts[k]; return o; };

// learn a structural decompose method under `Refine` over the given kinds (≥2 distinct sites per kind).
async function learn( kinds ) {
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
	kinds.forEach(( k, ki ) => { for ( let s = 0; s < 2; s++ ) { const a = `L${ki}_${s}a`, b = `L${ki}_${s}b`; nodes.push(node(a), node(b)); segments.push(seg(`LE${ki}_${s}`, a, b, { kind: k })); } });
	const res = await crystallizeStructural({ episodeTree: TREE, seed: { lastRev: 0, nodes, segments }, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	return res.candidate;
}
// the host's content-forger: fills EACH discovered hole for the new kind — WITHOUT knowing the field name (the
// controller hands it the hole paths). Counts invocations (the model meter).
function makeContentFor() {
	const calls = { n: 0 };
	return { calls, contentFor: ( contentVars, scopeFacts ) => { calls.n++; const v = {}; for ( const cv of contentVars ) v[cv.path] = ground(scopeFacts.kind); return v; } };
}

test('antiUnifyAdapt — auto-discovers the content hole on a REAL crystal, forges it, inherits the contract', async () => {
	const cand = await learn(['hard', 'easy']);                      // 2 templates → the content hole is discoverable
	const holes = methodContentHoles(cand);
	assert.equal(holes.stable, true);
	assert.equal(holes.contentVars.length, 1, 'exactly one content hole (the mid state) auto-discovered — no field name given');

	const { calls, contentFor } = makeContentFor();
	const a = antiUnifyAdapt({ neighbour: cand, scopeFacts: { Segment: true, kind: 'medium' }, signatureKeys: cand.signatureKeys, contentFor });
	assert.ok(a && a.candidate, 'an adapted candidate is built');
	assert.equal(a.outcome, 'adapt');
	assert.equal(calls.n, 1, 'the model filled the holes once');
	const sig = digest(projectFacts({ Segment: true, kind: 'medium' }, cand.signatureKeys));
	const tpl = a.candidate.templatesBySig[sig];
	assert.ok(tpl, 'a new template keyed on the medium signature');
	assert.ok(tpl.some(( o ) => o && o.state === 'plan-medium'), 'the forged content landed in the discovered hole');
	assert.ok(tpl.some(( o ) => o && o.originNode === '⟦@ref:origin⟧'), 'the structural holes are reused verbatim (skeleton kept)');
	assert.ok(a.candidate.schema && a.candidate.schema.contract, 'the neighbour CONTRACT is inherited (the verifier gate passes)');
});

test('antiUnifyAdapt — NEG: a single-class method has no discoverable content hole → returns null (fall back to fresh forge)', async () => {
	const cand = await learn(['hard']);                              // ONE template → no content variation to generalize
	const holes = methodContentHoles(cand);
	assert.equal(holes.stable, false, 'one template → not stable');
	const { contentFor } = makeContentFor();
	const a = antiUnifyAdapt({ neighbour: cand, scopeFacts: { Segment: true, kind: 'medium' }, signatureKeys: cand.signatureKeys, contentFor });
	assert.equal(a, null, 'no auto-discoverable holes → null → the controller forges fresh');
});

test('adaptOrForge — opts.adaptContent drives the antiUnify adapt on a miss, then AMORTISES (2nd encounter = hit)', async () => {
	const cand = await learn(['hard', 'easy']);
	const lib = makeLibrary(); indexMethod(lib, cand);
	const target = { frontier: cand.schema.frontier, signatureKeys: cand.signatureKeys };
	const { calls, contentFor } = makeContentFor();

	const r1 = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, adaptContent: contentFor });
	assert.equal(r1.outcome, 'adapt', 'a miss with a reusable neighbour → antiUnify content-forge adapt');
	assert.equal(r1.calls, 1);
	assert.equal(calls.n, 1, 'the content-forger ran once');

	const r2 = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, adaptContent: contentFor });
	assert.equal(r2.outcome, 'hit', 'the adapted method amortises → a hit');
	assert.equal(r2.calls, 0);
	assert.equal(calls.n, 1, 'the content-forger was NOT invoked again (amortised)');
});

test('adaptOrForge — NEG: no discoverable holes → falls back to opts.forge (fresh), not a silent reject', async () => {
	const cand = await learn(['hard']);                              // single-class neighbour → adaptContent yields null
	const lib = makeLibrary(); indexMethod(lib, cand);
	const target = { frontier: cand.schema.frontier, signatureKeys: cand.signatureKeys };
	const { contentFor } = makeContentFor();
	let forged = 0;
	const forge = () => { forged++; return { candidate: cand, outcome: 'forge', calls: 1 }; };   // the fresh fallback
	const r = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, adaptContent: contentFor, forge });
	assert.equal(forged, 1, 'the fresh forge ran (adaptContent could not auto-adapt a single-class method)');
	assert.equal(r.outcome, 'forge');
});

test('the antiUnify-forged template is engine-mountable — structural holes rebind at a fresh call site', async () => {
	const cand = await learn(['hard', 'easy']);
	const { contentFor } = makeContentFor();
	const a = antiUnifyAdapt({ neighbour: cand, scopeFacts: { Segment: true, kind: 'medium' }, signatureKeys: cand.signatureKeys, contentFor });
	const sig = digest(projectFacts({ Segment: true, kind: 'medium' }, cand.signatureKeys));
	const tpl = a.candidate.templatesBySig[sig];
	assert.ok(hasHoles(tpl), 'still parameterized (structural holes present) before mounting');
	const ground2 = instantiate(tpl, { base: 'Z', refs: { origin: 'X', target: 'Y' } });
	assert.ok(ground2, 'instantiates at a fresh site (no unbound hole → no bypass)');
	const byId = ( suffix ) => ground2.find(( o ) => o.$$_id === 'Z' + suffix || o.$_id === 'Z' + suffix);
	assert.equal(byId('_m0').state, 'plan-medium', 'the forged content rode the mount');
	assert.equal(byId('_a0').originNode, 'X', 'first child rebound to the NEW origin');
	assert.equal(byId('_b0').targetNode, 'Y', 'second child rebound to the NEW target');
	assert.ok(!JSON.stringify(ground2).includes('⟦@'), 'no hole sentinel survived instantiation (fully ground)');
});
