'use strict';
/**
 * FinQA forge-adapter — the 2nd-domain vehicle (pilot 2026-07-10: 99.3% no-LLM extraction, 114 shapes,
 * top-20 = 94.7%). Inline fixture (no /mnt/d dependency): the GOLD GATE at load (execute + match exe_ans),
 * the pinned scale (the multi-scale mask fix), fail-closed rejections, and the decompose stub path.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../examples/forge-adapters/finqa.js');

const item = ( question, program, exe_ans, table ) => ({ qa: { question, program, exe_ans }, table: table || [] });
const FIX = [
	item('what was the change rate?', 'subtract(120, 100), divide(#0, 100)', 0.2),
	item('what was the change rate for B?', 'subtract(9, 6), divide(#0, 6)', 0.5),
	item('what is the percent change?', 'subtract(11, 10), divide(#0, 10)', 10.0),          // exe_ans à l'échelle % → scale 100
	item('average of the row?', 'table_average(net revenue)', 15, [ [ 'net revenue', '10', '20' ] ]),
	item('avg of other row?', 'table_average(net revenue)', 25, [ [ 'net revenue', '20', '30' ] ]),
	item('broken program', 'frobnicate(1, 2)', 3),                                          // op hors-DSL → rejet
	item('does not match', 'add(1, 2)', 99),                                                // exec ≠ exe_ans → rejet
];

test('loadClasses — the gold gate admits ONLY executing+matching items, grouped by op-shape', () => {
	const by = A.loadClasses({ rows: FIX, per: 5 });
	assert.deepEqual(Object.keys(by).sort(), ['subtract>divide', 'table_average'], 'broken + mismatching are rejected fail-closed');
	assert.equal(by['subtract>divide'].length, 3);
	assert.deepEqual(by['subtract>divide'][0].goldSteps, ['subtract', 'divide']);
});

test('pinned scale — the %-convention item carries scale=100; the plain one scale=1 (no multi-scale mask at runtime)', () => {
	const by = A.loadClasses({ rows: FIX, per: 5 });
	const chg = by['subtract>divide'];
	assert.equal(chg[0].scale, 1, '0.2 == 0.2 at scale 1');
	assert.equal(chg[2].scale, 100, '0.1 matches 10.0 ONLY at ×100 — pinned so the verifier uses that one scale');
	assert.equal(A.matchesAt(0.1, 10.0, 100), true);
	assert.equal(A.matchesAt(0.1, 10.0, 1), false, 'the same value at scale 1 must NOT match (the mask is gone)');
});

test('execProgram — refs (#k), table ops by row label, fail-closed on unknown label/op/arity', () => {
	const r = A.execProgram('table_sum(net revenue), divide(#0, 2)', [ [ 'net revenue', '10', '20' ] ]);
	assert.equal(r.value, 15);
	assert.deepEqual(r.shape, ['table_sum', 'divide']);
	assert.equal(A.execProgram('table_sum(missing row)', [ [ 'net revenue', '10' ] ]), null);
	assert.equal(A.execProgram('add(1)', []), null, 'arity 1 on a binary op is rejected');
});

test('decompose — no ask → gold echo (harness mode); corrupt → truncated (the forge NEG control path)', async () => {
	const rec = { problem: 'x', goldSteps: ['subtract', 'divide'] };
	assert.deepEqual(await A.decompose(null, rec), ['subtract', 'divide']);
	assert.deepEqual(await A.decompose(null, rec, { corrupt: true }), ['subtract']);
});
