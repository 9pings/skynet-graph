'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shapeOf, consistencyVote, goldGate, packStock } = require('../../lib/authoring/forge/stock');
const { unpackMethods } = require('../../lib/authoring/learning/method-pack');

test('shapeOf — the ordered step kinds joined (the class-method identity)', () => {
	assert.equal(shapeOf(['filter', 'aggregate', 'select']), 'filter>aggregate>select');
	assert.equal(shapeOf([]), '');
});

test('consistencyVote — majority shape + agreement fraction', () => {
	const v = consistencyVote([
		['filter', 'aggregate', 'select'],
		['filter', 'select'],
		['filter', 'aggregate', 'select'],
	]);
	assert.equal(v.shape, 'filter>aggregate>select');
	assert.deepEqual(v.steps, ['filter', 'aggregate', 'select']);
	assert.equal(v.agreement, 2 / 3);
	assert.equal(v.n, 3);
});

test('consistencyVote — ties break to the FIRST-seen shape (deterministic)', () => {
	const v = consistencyVote([['a', 'b'], ['c']]);   // 1 vs 1 → first-seen wins
	assert.equal(v.shape, 'a>b');
	assert.equal(v.agreement, 0.5);
});

test('consistencyVote — empty decompositions are not votes; all-empty → empty shape, agreement 0', () => {
	const v = consistencyVote([[], ['x'], []]);
	assert.equal(v.shape, 'x');
	assert.equal(v.agreement, 1 / 3, 'agreement is over the sample count, empties included in the denominator');
	assert.equal(consistencyVote([[], []]).shape, '');
	assert.equal(consistencyVote([]).agreement, 0);
});

test('goldGate — ADMIT iff consistent ∧ shape==gold ∧ crystallized', () => {
	const g = goldGate({ modelShapes: [['filter', 'select'], ['filter', 'select']], goldSteps: ['filter', 'select'], crystallized: true });
	assert.equal(g.admitted, true);
	assert.equal(g.consistent, true);
	assert.equal(g.goldMatch, true);
	assert.equal(g.reason, 'admit');
});

test('goldGate — REJECT on model inconsistency (the pilot yield bound), with a discriminating reason', () => {
	const g = goldGate({ modelShapes: [['filter', 'aggregate', 'select'], ['filter', 'select']], goldSteps: ['filter', 'aggregate', 'select'], crystallized: true });
	assert.equal(g.admitted, false);
	assert.equal(g.consistent, false);
	assert.equal(g.reason, 'model-inconsistent');
});

test('goldGate — REJECT a consistent-but-WRONG shape (soundness: never admits shape≠gold)', () => {
	const g = goldGate({ modelShapes: [['filter', 'select'], ['filter', 'select']], goldSteps: ['filter', 'aggregate', 'select'], crystallized: true });
	assert.equal(g.admitted, false);
	assert.equal(g.goldMatch, false);
	assert.equal(g.reason, 'shape-mismatches-gold');
});

test('goldGate — REJECT when crystallize refused (K1 unsound trace) even if the shape matches', () => {
	const g = goldGate({ modelShapes: [['filter', 'select']], goldSteps: ['filter', 'select'], crystallized: false });
	assert.equal(g.admitted, false);
	assert.equal(g.reason, 'crystallize-refused');
});

test('goldGate — accepts pre-joined shape strings + a goldShape string', () => {
	const g = goldGate({ modelShapes: ['filter>select', 'filter>select'], goldShape: 'filter>select', crystallized: true });
	assert.equal(g.admitted, true);
});

test('goldGate — empty modelShapes is not vacuously admitted', () => {
	assert.equal(goldGate({ modelShapes: [], goldSteps: ['filter'], crystallized: true }).admitted, false);
});

test('packStock — admitted class methods → a .sgc methods bundle keyed on the class signature', () => {
	const bundle = packStock([{ sig: 'count|1', candidate: { schema: {}, templatesBySig: {} } }, { sig: 'none|2', candidate: { schema: {} } }], { name: 'wikisql', version: 'v1' });
	assert.equal(bundle.kind, 'methods');
	const ms = unpackMethods(bundle).methods;
	assert.equal(ms.length, 2);
	assert.deepEqual(ms[0].structure, { taskKind: 'count|1' });
	assert.equal(bundle.manifest.name, 'wikisql');
});

test('packStock — drops entries with no candidate; custom structureKey', () => {
	const bundle = packStock([{ sig: 'a', candidate: null }, { sig: 'b', candidate: { schema: {} } }], { structureKey: 'class' });
	const ms = unpackMethods(bundle).methods;
	assert.equal(ms.length, 1);
	assert.deepEqual(ms[0].structure, { class: 'b' });
});
