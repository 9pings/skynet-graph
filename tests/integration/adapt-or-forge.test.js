'use strict';
/**
 * adapt-or-forge CONTROLLER — the creative loop's drive (study 2026-06-30-creative-loop-two-level-grammar.md, brick C).
 * Retrieve (hit, 0 calls) → forge/adapt via the model (reusing dispatched neighbours) → verifier-gate (a sound
 * contract) → index back (amortise: the next encounter hits). Each claim carries a discriminating NEG control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { crystallizeStructural } = require('../../lib/authoring/crystallize.js');
const { makeLibrary, indexMethod } = require('../../lib/authoring/library.js');
const { adaptOrForge } = require('../../lib/authoring/adapt.js');
const { digest } = require('../../lib/providers/canonicalize.js');
console.log = console.info = console.warn = () => {};

const STATE = { hard: 'split-hard', easy: 'split-easy' };
const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind ) => ({ _id: id, originNode: o, targetNode: t, kind });
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( k in facts ) o[k] = facts[k]; return o; };

async function learnRefine() {
	const Refine = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true, alts: [{ mid: STATE[scope._.kind] || '?' }] },
			{ _id: mid, Node: true, state: STATE[scope._.kind] || '?' },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	Graph._providers = Object.assign({}, Graph._providers, { Refine });
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')], segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	return res.candidate;
}

// a stub "model" that ADAPTS (reuses a neighbour's structure, forges only the content for the new signature) or, with
// no neighbour, forges FRESH. Counts every invocation (the model-call meter).
function deepReplaceState( x, kind ) {
	if ( Array.isArray(x) ) return x.map(( e ) => deepReplaceState(e, kind));
	if ( x && typeof x === 'object' ) { const o = {}; for ( const k of Object.keys(x) ) o[k] = deepReplaceState(x[k], kind); return o; }
	return (typeof x === 'string' && /^split-/.test(x)) ? 'split-' + kind : x;
}
function makeForge( opts ) {
	opts = opts || {};
	const calls = { n: 0 };
	const forge = ( scope, neighbours ) => {
		calls.n++;
		if ( opts.giveUp ) return null;
		const nb = neighbours[0];
		if ( !nb ) {                                                  // FRESH — no structure to reuse
			const cand = { schema: { _id: 'Fresh', contract: opts.noContract ? undefined : { read: [], write: ['Fresh'], pre: [], post: ['Fresh==true'], effect: 'pure' } },
				signatureKeys: ['shape'], frontier: { params: [{ name: 'x', role: 'endpoint', sort: 'node-ref' }], appConditions: { require: [], assert: [] } },
				templatesBySig: { [digest(projectFacts(scope, ['shape']))]: [{ $_id: '_parent', Fresh: true }] } };
			return { candidate: cand, outcome: 'forge', calls: 1 };
		}
		// ADAPT — reuse nb's structure, forge ONLY the content (split-<kind>) for this site's signature.
		const sig = digest(projectFacts(scope, nb.signatureKeys));
		const proto = Object.values(nb.templatesBySig)[0];
		const cand = Object.assign({}, nb, { schema: opts.noContract ? Object.assign({}, nb.schema, { contract: undefined }) : nb.schema,
			templatesBySig: Object.assign({}, nb.templatesBySig, { [sig]: deepReplaceState(proto, scope.kind) }) });
		return { candidate: cand, outcome: 'adapt', calls: 1 };
	};
	return { forge, calls };
}

test('RETRIEVE — a learned method is a HIT at a seen signature (0 model calls; forge never invoked)', async () => {
	const cand = await learnRefine();
	const lib = makeLibrary(); indexMethod(lib, cand);
	const { forge, calls } = makeForge();
	const r = adaptOrForge({ lib, target: { frontier: cand.schema.frontier, signatureKeys: cand.signatureKeys }, scopeFacts: { Segment: true, kind: 'hard' }, forge });
	assert.equal(r.outcome, 'hit');
	assert.equal(r.calls, 0, 'a hit costs 0 model calls');
	assert.equal(calls.n, 0, 'forge was never invoked');
});

test('ADAPT — an unseen signature forges by structural reuse, then AMORTISES (second encounter is a hit)', async () => {
	const cand = await learnRefine();
	const lib = makeLibrary(); indexMethod(lib, cand);
	const { forge, calls } = makeForge();
	const target = { frontier: cand.schema.frontier, signatureKeys: cand.signatureKeys };

	const r1 = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, forge });
	assert.equal(r1.outcome, 'adapt', 'an unseen signature with a reusable neighbour → adapt (structural reuse)');
	assert.equal(r1.calls, 1, 'one model call (the content forge)');
	assert.equal(calls.n, 1);

	// AMORTISATION — the adapted method was indexed, so the SAME signature now HITS at 0 calls.
	const r2 = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, forge });
	assert.equal(r2.outcome, 'hit', 'the adapted method amortises → a hit');
	assert.equal(r2.calls, 0);
	assert.equal(calls.n, 1, 'forge was NOT invoked again (amortised)');
});

test('FORGE — no reusable neighbour → a fresh forge (the model builds it, then it amortises)', async () => {
	const lib = makeLibrary();                                       // empty library → no neighbour to adapt
	const { forge, calls } = makeForge();
	const target = { frontier: { params: [{ name: 'x', role: 'endpoint', sort: 'node-ref' }] }, signatureKeys: ['shape'] };
	const r = adaptOrForge({ lib, target, scopeFacts: { shape: 'star' }, forge });
	assert.equal(r.outcome, 'forge', 'no neighbour → a fresh forge');
	assert.equal(calls.n, 1);
	const r2 = adaptOrForge({ lib, target, scopeFacts: { shape: 'star' }, forge });
	assert.equal(r2.outcome, 'hit', 'the forged method amortises');
	assert.equal(calls.n, 1);
});

test('VERIFIER GATE — a forged method with NO sound contract is REJECTED (and not indexed)', async () => {
	const cand = await learnRefine();
	const lib = makeLibrary(); indexMethod(lib, cand);
	const { forge, calls } = makeForge({ noContract: true });        // the model returns a method with no post
	const target = { frontier: cand.schema.frontier, signatureKeys: cand.signatureKeys };
	const r = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, forge });
	assert.equal(r.outcome, 'reject');
	assert.match(r.reason, /no sound contract/);
	assert.equal(calls.n, 1, 'the model was invoked (the gate is post-forge)');
	// NEG (control) — the SAME forge WITH a contract is accepted → the gate is not vacuously rejecting everything.
	const ok = makeForge();
	const r2 = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, forge: ok.forge });
	assert.equal(r2.outcome, 'adapt');
});

test('REJECT — when the model gives up (no library hit, forge returns null), the loop rejects (escalate)', async () => {
	const cand = await learnRefine();
	const lib = makeLibrary(); indexMethod(lib, cand);
	const { forge, calls } = makeForge({ giveUp: true });
	const r = adaptOrForge({ lib, target: { frontier: cand.schema.frontier, signatureKeys: cand.signatureKeys }, scopeFacts: { Segment: true, kind: 'medium' }, forge });
	assert.equal(r.outcome, 'reject');
	assert.equal(calls.n, 1, 'the model was tried');
});
