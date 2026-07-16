'use strict';
/**
 * givens — the typed base-fact front-door (plugins/planner/lib/givens.js, tiered-plan gap i). Deterministic, no model.
 * Locks: numeric extraction surface (integers, $, decimals, thousand-commas, %), positional+lexical keys, reading
 * order, the fail-closed limitation (spelled-out numbers NOT extracted), the FinQA cell front-door (incl. the
 * accounting-negative), the prompt block, and seedOf. Negative controls: no-number text → [], junk cells skipped.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { numberGivens, cellGivens, givensBlock, seedOf, labelsOf } = require('../../plugins/planner/lib/givens.js');

test('numberGivens — integers with lexical slugs, in reading order', () => {
	const g = numberGivens('A rectangle is 6 wide and 4 tall.');
	assert.equal(g.length, 2);
	assert.equal(g[0].key, 'g1_wide');  assert.equal(g[0].value, 6);
	assert.equal(g[1].key, 'g2_tall');  assert.equal(g[1].value, 4);
	assert.match(g[0].snippet, /6 wide/);
});

test('numberGivens — $, decimals, thousand-commas, % are cleaned to bare numbers', () => {
	const g = numberGivens('She earns $12.50 per task, sold 1,200 units, at 90% capacity.');
	assert.deepEqual(g.map(( x ) => x.value ), [12.5, 1200, 90]);
	assert.ok(g.every(( x, i ) => x.key.startsWith('g' + (i + 1)) ), 'keys are positional');
});

test('numberGivens — stop-words are skipped for the slug; slug falls back to the word BEFORE', () => {
	const g = numberGivens('The bill was split by 5.');
	assert.equal(g.length, 1);
	assert.equal(g[0].value, 5);
	assert.notEqual(g[0].key, 'g1_the', 'stop-word never a slug');
});

test('numberGivens — NEG: digits-only by design (prose quantities = the decomposer restates them, rule 6)', () => {
	assert.deepEqual(numberGivens('three-quarters of the tank was full'), []);
	assert.deepEqual(numberGivens(''), []);
	assert.deepEqual(numberGivens(null), []);
});

test('cellGivens — numeric cells keyed by position + row label; accounting (1,234) is negative; junk skipped', () => {
	const table = [
		['item', '2007', '2008'],
		['revenue', '1,500', '2,000'],
		['net loss', '(300)', 'n/a'],
	];
	const g = cellGivens(table);
	assert.deepEqual(g.map(( x ) => [x.key, x.value] ), [
		['c1_1_revenue', 1500], ['c1_2_revenue', 2000], ['c2_1_net', -300],
	]);
	// the FinQA dup-in-parens surface: "-17.1 ( 17.1 )" / "$ -23158 ( 23158 )" / "10% ( 10 % )" keep the head value
	const fq = cellGivens([['', 'x'], ['retail', '-17.1 ( 17.1 )'], ['fx', '$ -23158 ( 23158 )'], ['rate', '10% ( 10 % )']]);
	assert.deepEqual(fq.map(( x ) => x.value ), [-17.1, -23158, 10]);
	assert.equal(g[0].snippet, 'revenue · 2007');
	assert.deepEqual(g[2].cell, { r: 2, c: 1 });
});

test('labelsOf — the cells rule: STRUCTURED provenance only (cell givens labelled, prose givens NEVER)', () => {
	const cells = cellGivens([['item', '2007'], ['revenue', '1,500']]);
	assert.deepEqual(labelsOf(cells), { c1_1_revenue: 'revenue · 2007' }, 'a cell given is labelled row · col');
	// NEG — prose givens are already restated self-contained by the decomposer (rule 7): labelling them is
	// pure prompt perturbation (measured net-negative) → labelsOf must NEVER label them.
	assert.deepEqual(labelsOf(numberGivens('6 wide and 4 tall')), {});
	assert.deepEqual(labelsOf(null), {});
	assert.deepEqual(labelsOf([]), {});
});

test('givensBlock + seedOf — the prompt block cites keys; the seed maps key→value; empty → empty', () => {
	const g = numberGivens('6 wide and 4 tall');
	const block = givensBlock(g);
	assert.match(block, /GIVENS/);
	assert.match(block, /g1_wide=6/);
	assert.match(block, /cite its key in "needs"/i);
	assert.deepEqual(seedOf(g), { g1_wide: 6, g2_tall: 4 });
	assert.equal(givensBlock([]), '');
	assert.deepEqual(seedOf(null), {});
});
