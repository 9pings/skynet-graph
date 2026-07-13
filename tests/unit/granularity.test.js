'use strict';
/**
 * granularity (P2 arbiter) — cluster grounded notions into candidate DIMENSIONS by co-citation of witnesses,
 * and arbitrate the lazy 2-régime (structural vs escalate-to-Q2). Each claim carries a discriminating NEGATIVE
 * control. Grounded, deterministic, ZERO-CORE. These are the P2-GRAN barres, locked as regression.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clusterByGrounding, arbitrate } = require('../../lib/authoring/granularity');

test('P2-GRAN-1 — connected components on shared-witness graph (transitive)', () => {
	const r = clusterByGrounding([
		{ id: 'n1', witnesses: ['a', 'b'] },
		{ id: 'n2', witnesses: ['b', 'c'] },   // ~n1 (share b)
		{ id: 'n3', witnesses: ['c', 'd'] },   // ~n2 (share c) → transitively with n1
		{ id: 'n4', witnesses: ['x', 'y'] } ]);// disjoint
	assert.deepEqual(r.clusters, [['n1', 'n2', 'n3'], ['n4']], 'transitive closure groups n1-n2-n3; n4 alone');
	assert.deepEqual(r.separability, { components: 2, singletons: 1, sizes: [3, 1], edges: 2 });
});

test('P2-GRAN-2 — arbitrate MIXED: two grounded groups sharing no witnesses across → the re-plan TOO-NARROW signal', () => {
	// a "moral" cluster (share m*) and a "legal" cluster (share l*), disjoint across — morale⊥legal, structurally
	const a = arbitrate([
		{ id: 'nM1', witnesses: ['m1', 'm2'], side: 'PRO' },
		{ id: 'nM2', witnesses: ['m2', 'm3'], side: 'CON' },
		{ id: 'nL1', witnesses: ['l1', 'l2'], side: 'PRO' },
		{ id: 'nL2', witnesses: ['l2', 'l3'], side: 'CON' } ]);
	assert.equal(a.frame, 'mixed');
	assert.deepEqual(a.dimensions, [['nL1', 'nL2'], ['nM1', 'nM2']]);
	assert.ok(/conflates 2 dimensions/.test(a.reason));
});

test('P2-GRAN-3 — arbitrate COHERENT: one connected grounded block → decide normally (no re-plan)', () => {
	const a = arbitrate([
		{ id: 'n1', witnesses: ['a', 'b'] },
		{ id: 'n2', witnesses: ['b', 'c'] },
		{ id: 'n3', witnesses: ['c', 'd'] } ]);
	assert.equal(a.frame, 'coherent');
	assert.deepEqual(a.dimensions, [['n1', 'n2', 'n3']]);
});

test('P2-GRAN-4 — arbitrate UNSTRUCTURED: all singletons (sparse co-citation) → escalate, never fabricate a split', () => {
	const a = arbitrate([
		{ id: 'n1', witnesses: ['a'] },
		{ id: 'n2', witnesses: ['b'] },
		{ id: 'n3', witnesses: ['c'] } ]);
	assert.equal(a.frame, 'unstructured');
	assert.deepEqual(a.dimensions, [], 'NEG: no grounded group is invented from disjoint witnesses');
	assert.ok(/escalate to Q2/.test(a.reason));
});

test('P2-GRAN-5 — bySide never links across sides even at witness overlap (a dimension can span sides; a stance-forced clustering must not)', () => {
	const items = [{ id: 'nP', witnesses: ['w1', 'w2'], side: 'PRO' }, { id: 'nC', witnesses: ['w1', 'w2'], side: 'CON' }];
	assert.deepEqual(clusterByGrounding(items).clusters, [['nC', 'nP']], 'default: same witnesses link regardless of side');
	assert.deepEqual(clusterByGrounding(items, { bySide: true }).clusters, [['nC'], ['nP']], 'bySide: never link across sides');
});

test('P2-GRAN-6 — minShared raises the co-citation bar (1 shared ≠ same dimension when we demand 2)', () => {
	const items = [{ id: 'n1', witnesses: ['a', 'b', 'c'] }, { id: 'n2', witnesses: ['c', 'd', 'e'] }];   // share only c
	assert.deepEqual(clusterByGrounding(items, { minShared: 1 }).clusters, [['n1', 'n2']]);
	assert.deepEqual(clusterByGrounding(items, { minShared: 2 }).clusters, [['n1'], ['n2']], 'demand 2 shared → distinct');
});

test('P2-GRAN-0 — determinism: clusters are sorted, re-run bit-identical', () => {
	const items = [{ id: 'z', witnesses: ['1'] }, { id: 'a', witnesses: ['1'] }, { id: 'm', witnesses: ['9'] }];
	const r1 = JSON.stringify(clusterByGrounding(items));
	const r2 = JSON.stringify(clusterByGrounding(items));
	assert.equal(r1, r2);
	assert.deepEqual(clusterByGrounding(items).clusters, [['a', 'z'], ['m']], 'ids sorted within and across clusters');
});
