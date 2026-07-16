'use strict';
/**
 * method LIBRARY dispatch — the juncture of the two grammars (study 2026-06-30-creative-loop-two-level-grammar.md).
 * The structuring grammar names a target FrontierSignature (the abstract mechanism); the concept-DLL library is
 * indexed by `libraryKey`; dispatch = an O(1) bucket lookup → refine by application-conditions over the scope →
 * ranked candidates. Each claim carries a discriminating NEGATIVE control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { libraryKey, crystallizeStructural } = require('../../plugins/learning/lib/crystallize.js');
const { makeLibrary, indexMethod, bucketOf, dispatch } = require('../../plugins/learning/lib/library.js');
console.log = console.info = console.warn = () => {};

// a synthetic crystal candidate (frontier params + signature keys + application conditions), keyed like the real ones.
function mkCandidate( id, params, signatureKeys, appConditions ) {
	const frontier = { params, summaryFacts: [], appConditions: appConditions || { require: [], assert: [] }, summary: { facts: [] } };
	const key = libraryKey(frontier, signatureKeys);
	return { schema: { _id: id, _name: id, frontier, libraryKey: key }, frontier, libraryKey: key, signatureKeys };
}
const ENDPOINTS = [{ name: 'origin', role: 'endpoint', sort: 'node-ref' }, { name: 'target', role: 'endpoint', sort: 'node-ref' }];

test('dispatch — O(1) bucket lookup, then refine by application-conditions (structure-mapping within a bucket)', () => {
	// two methods with the SAME interface (same role:sort + signature) → SAME libraryKey bucket, but DIFFERENT NACs.
	const eu = mkCandidate('SplitEU', ENDPOINTS, ['Segment', 'kind'], { require: ['Segment'], assert: ["$region=='EU'"] });
	const us = mkCandidate('SplitUS', ENDPOINTS, ['Segment', 'kind'], { require: ['Segment'], assert: ["$region=='US'"] });
	assert.equal(eu.libraryKey, us.libraryKey, 'same interface → same bucket (the coarse body-blind index)');

	const lib = makeLibrary();
	indexMethod(lib, eu); indexMethod(lib, us);
	const target = { frontier: { params: ENDPOINTS }, signatureKeys: ['Segment', 'kind'] };

	const r = dispatch(lib, target, { Segment: true, region: 'EU', kind: 'hard' });
	assert.deepEqual(r.candidates.map(( c ) => c.candidate.schema._id), ['SplitEU'], 'the app-conditions discriminate within the bucket (EU scope → EU method)');
	assert.equal(r.scanned, 2, 'dispatch refined exactly the 2-entry bucket');

	// NEG — a scope matching NEITHER NAC → no candidate (falls through to forge), not a wrong pick.
	const none = dispatch(lib, target, { Segment: true, region: 'JP', kind: 'hard' });
	assert.deepEqual(none.candidates, [], 'no app-condition holds → empty (the structuring grammar must forge)');
});

test('dispatch — is a LOOKUP not a SEARCH: it touches only the bucket (NEG: an unknown signature → empty)', () => {
	const lib = makeLibrary();
	// fill many buckets: vary arity and sort so each lands in a distinct libraryKey.
	for ( let i = 0; i < 20; i++ ) {
		const params = i % 2 ? ENDPOINTS : ENDPOINTS.concat([{ name: 'c' + i, role: 'endpoint', sort: 'node-ref' }]);
		indexMethod(lib, mkCandidate('M' + i, params, ['Segment', 'k' + (i % 5)], { require: [], assert: [] }));
	}
	const probe = mkCandidate('PROBE', ENDPOINTS, ['Segment', 'k0'], { require: [], assert: [] });
	indexMethod(lib, probe);

	const r = dispatch(lib, { frontier: probe.frontier, signatureKeys: probe.signatureKeys }, {});
	assert.ok(r.candidates.some(( c ) => c.candidate.schema._id === 'PROBE'), 'the probe is found by its key');
	assert.ok(r.scanned < r.total, `dispatch scanned only its bucket (${r.scanned}) not the whole corpus (${r.total})`);
	assert.ok(r.scanned <= 5, 'the bucket is small — NOT an O(corpus) scan (no HRG-parse cliff)');

	// NEG — a target signature absent from the index → empty bucket, scanned 0 (no false match anywhere in the corpus).
	const miss = dispatch(lib, { frontier: { params: ENDPOINTS.concat([{ name: 'z', role: 'predicate', sort: 'predicate-ref' }]) }, signatureKeys: ['Nope'] }, {});
	assert.equal(miss.scanned, 0);
	assert.deepEqual(miss.candidates, []);
});

test('dispatch — ranks the bucket by weight ("plusieurs façons p-e": the supervisor takes top OR explores)', () => {
	const a = mkCandidate('Aw', ENDPOINTS, ['Segment'], { require: [], assert: [] });
	const b = mkCandidate('Bw', ENDPOINTS, ['Segment'], { require: [], assert: [] });
	const lib = makeLibrary();
	indexMethod(lib, a, { weight: 1 }); indexMethod(lib, b, { weight: 5 });
	const r = dispatch(lib, { frontier: { params: ENDPOINTS }, signatureKeys: ['Segment'] }, {});
	assert.deepEqual(r.candidates.map(( c ) => c.candidate.schema._id), ['Bw', 'Aw'], 'higher production weight ranks first');
	// NEG (not vacuous) — equal weights preserve insertion order (deterministic, no spurious reordering).
	const lib2 = makeLibrary();
	indexMethod(lib2, a, { weight: 2 }); indexMethod(lib2, b, { weight: 2 });
	const r2 = dispatch(lib2, { frontier: { params: ENDPOINTS }, signatureKeys: ['Segment'] }, {});
	assert.deepEqual(r2.candidates.map(( c ) => c.candidate.schema._id), ['Aw', 'Bw'], 'equal weight → stable order');
});

// ── integration: a REAL crystallizeStructural candidate indexes + dispatches by its own FrontierSignature ──
const STATE = { hard: 'split-hard', easy: 'split-easy' };
function makeRefine() {
	const Refine = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: mid, Node: true, state: STATE[scope._.kind] || '?' },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	return { Refine };
}
const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind ) => ({ _id: id, originNode: o, targetNode: t, kind });
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

test('dispatch — a REAL crystallized method indexes by its FrontierSignature and dispatches at a matching site', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')], segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: DECL });
	assert.equal(res.admitted, true);

	const lib = makeLibrary();
	const key = indexMethod(lib, res.candidate);
	assert.equal(key, res.candidate.schema.libraryKey, 'indexed under the candidate’s own libraryKey');

	// the structuring grammar asks for "a method over an origin/target pair, gated on Segment+kind" — the abstract mech.
	const target = { frontier: res.candidate.schema.frontier, signatureKeys: res.candidate.signatureKeys };
	const r = dispatch(lib, target, { Segment: true, kind: 'hard' });
	assert.deepEqual(r.candidates.map(( c ) => c.candidate.schema._id), ['CrystalRefine'], 'the learned method is dispatched at a matching site');

	// NEG — a site MISSING a required app-condition fact (no Segment) → the method does not dispatch.
	const miss = dispatch(lib, target, { kind: 'hard' });
	assert.deepEqual(miss.candidates, [], 'a site that fails the NACs does not dispatch (no spurious mount)');
});
