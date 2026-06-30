'use strict';
/**
 * combinator MOUNT — the dispatch→mount bridge (P2.5; study 2026-06-30-creative-loop-two-level-grammar.md, brick B).
 * A higher-order concept fills its behavioral hole with a DISPATCHED library fragment and mounts it at the site. The
 * demonstrative claim: a NEW concept (`Decompose`) reuses ANOTHER concept's (`Refine`'s) learned method purely because
 * their abstract FrontierSignatures match — recombination at 0 model calls. Each claim carries a NEG control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { crystallizeStructural } = require('../../lib/authoring/crystallize.js');
const { makeLibrary, indexMethod } = require('../../lib/authoring/library.js');
const { dispatchConcept } = require('../../lib/authoring/combinator.js');
console.log = console.info = console.warn = () => {};

const STATE = { hard: 'split-hard', easy: 'split-easy' };
function makeRefine() {
	const calls = [];
	const Refine = { refine( g, c, scope, argz, cb ) {
		calls.push(scope._._id);
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: mid, Node: true, state: STATE[scope._.kind] || '?' },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	return { Refine, calls };
}
const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind, extra ) => Object.assign({ _id: id, originNode: o, targetNode: t, kind }, extra || {});
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

// learn Refine into a library (the concept-DLL grammar's stock).
async function learnRefineLibrary() {
	const { Refine, calls } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')], segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	const lib = makeLibrary();
	indexMethod(lib, res.candidate);
	return { lib, candidate: res.candidate, learntCalls: calls.length };
}

async function boot( seed, conceptMap ) {
	const g = new Graph(JSON.parse(JSON.stringify(seed)), {
		label: 'combinator', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
	}, conceptMap);
	await nextStable(g);
	return g;
}

test('a higher-order concept MOUNTS a dispatched library fragment at a fresh site (0 calls — recombination)', async () => {
	const { lib, candidate, learntCalls } = await learnRefineLibrary();
	assert.equal(learntCalls, 2, 'the library was learned with 2 cold Refine calls');

	// a DIFFERENT concept `Decompose` (no provider of its own) dispatches Refine's learned method by FrontierSignature
	// and mounts it — the abstract mechanism "a method over origin/target gated on Segment+kind".
	const D = dispatchConcept({
		name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'],
		target: { frontier: candidate.schema.frontier, signatureKeys: candidate.signatureKeys },
		frontierFields: { origin: 'originNode', target: 'targetNode' }, lib,
	});
	Graph._providers = { Combinator: { Decompose: D.provider } };   // Refine's OWN provider is NOT wired

	const g = await boot({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('Z', 'X', 'Y', 'hard', { toDecompose: true }) ] },
		{ common: { childConcepts: { Decompose: D.schema } } });

	assert.equal(lib.methods.length, 1, 'the library is unchanged');
	assert.ok(g._objById['Z_m0'], 'Refine’s sub-graph was mounted at the Decompose site');
	assert.equal(g._objById['Z_m0']._etty._.state, 'split-hard', 'the learned content (kind=hard → split-hard) replayed verbatim');
	assert.equal(g._objById['Z_a0']._etty._.originNode, 'X', 'first child wired to the NEW origin (structural hole rebound)');
	assert.equal(g._objById['Z_b0']._etty._.targetNode, 'Y', 'second child wired to the NEW target');
	// the DURABLE evidence is the guard fact (the _name marker uncasts when the combinator de-applies after firing —
	// the re-fire guard is what persists, as the crystallizer relies on `Refined`, not `!$CrystalRefine`).
	assert.equal(g._objById['Z']._etty._.DecomposeDone, true, 'the durable guard is set (combinator fired once, no re-fire / divergence)');
	assert.ok(g.getRevisions().length < 50, 'bounded (no apply-cap runaway)');
	assert.ok(!g._objById['E1_m0'] && !g._objById['S'], 'no id-space from the learning episode leaked (sound)');
});

test('NEG — an UNSEEN signature class dispatches nothing → no mount (the structuring grammar must forge)', async () => {
	const { lib, candidate } = await learnRefineLibrary();
	const D = dispatchConcept({
		name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'],
		target: { frontier: candidate.schema.frontier, signatureKeys: candidate.signatureKeys },
		frontierFields: { origin: 'originNode', target: 'targetNode' }, lib,
	});
	Graph._providers = { Combinator: { Decompose: D.provider } };
	// kind=novel was never learned → the dispatched fragment has no template for this signature → no mount.
	const g = await boot({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('Z', 'X', 'Y', 'novel', { toDecompose: true }) ] },
		{ common: { childConcepts: { Decompose: D.schema } } });
	assert.ok(!g._objById['Z_m0'], 'no sub-graph mounted for the unseen signature (no false replay)');
	assert.equal(g._objById['Z']._etty._.DecomposeDone, true, 'cast as a NO-OP guard → it does not re-fire (no divergence)');
});

test('NEG — a site that fails the combinator require does NOT cast (no spurious mount)', async () => {
	const { lib, candidate } = await learnRefineLibrary();
	const D = dispatchConcept({
		name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'],
		target: { frontier: candidate.schema.frontier, signatureKeys: candidate.signatureKeys },
		frontierFields: { origin: 'originNode', target: 'targetNode' }, lib,
	});
	Graph._providers = { Combinator: { Decompose: D.provider } };
	// Z lacks `toDecompose` → the higher-order require never resolves → Decompose never casts.
	const g = await boot({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('Z', 'X', 'Y', 'hard') ] },
		{ common: { childConcepts: { Decompose: D.schema } } });
	assert.ok(!g._objById['Z_m0'], 'no mount without the behavioral-trigger fact');
	assert.ok(!g._objById['Z']._etty._.Decompose, 'Decompose did not cast (require unresolved)');
});
