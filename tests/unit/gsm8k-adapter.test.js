/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * The GSM8K `sg forge` adapter — the math stock for the P5 pipeline (R3a). GSM8K's calculator
 * annotations (`<<48/2=24>>` … `#### 72`) make the gold extraction DETERMINISTIC: every annotation
 * is a BINARY op re-executed at load, the chain must land on the `####` answer, anything else is
 * skipped FAIL-CLOSED. The class = the op-sequence shape (the finqa/wikisql contract).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const adapter = require('../../examples/forge-adapters/gsm8k.js');

const ROWS = [
	{ question: 'Natalia sold clips to 48 friends, then half as many in May. Altogether?',
		answer: 'She sold 48/2 = <<48/2=24>>24 in May.\nAltogether 48+24 = <<48+24=72>>72.\n#### 72' },
	{ question: 'A second divide-then-add problem.',
		answer: 'First 10/2 = <<10/2=5>>5.\nThen 10+5 = <<10+5=15>>15.\n#### 15' },
	{ question: 'A third divide-then-add problem.',
		answer: 'First 8/4 = <<8/4=2>>2.\nThen 8+2 = <<8+2=10>>10.\n#### 10' },
	{ question: 'A lone multiply problem (class of one — dropped).',
		answer: 'It is 3*7 = <<3*7=21>>21.\n#### 21' },
	{ question: 'CORRUPTED annotation — must be skipped fail-closed.',
		answer: 'Wrong: 48/2 = <<48/2=25>>25.\nThen <<48+25=73>>73.\n#### 73' },
	{ question: 'NON-BINARY annotation — must be skipped fail-closed.',
		answer: 'Compound: <<3*5+2=17>>17.\n#### 17' },
	{ question: 'Chain does NOT land on the #### answer — must be skipped.',
		answer: 'Step <<6*2=12>>12.\n#### 99' },
];

test('gsm8k adapter — gold gate at load: binary annotations re-executed, chain must land on ####, class = the shape', () => {
	assert.deepEqual(adapter.stepEnum, ['add', 'subtract', 'multiply', 'divide']);
	const classes = adapter.loadClasses({ rows: ROWS });
	assert.deepEqual(Object.keys(classes), ['divide>add'], 'ONLY the ≥2-member class that survived the gate — corrupted, non-binary, dead-chain and singleton all out');
	assert.equal(classes['divide>add'].length, 3);
	const rec = classes['divide>add'][0];
	assert.deepEqual(rec.goldSteps, ['divide', 'add']);
	assert.equal(rec.value, 72, 'the pinned gold answer');
	assert.match(rec.problem, /Natalia/);
});

test('gsm8k adapter — per caps the class size; classes filter restricts', () => {
	const classes = adapter.loadClasses({ rows: ROWS, per: 2 });
	assert.equal(classes['divide>add'].length, 2);
	assert.deepEqual(adapter.loadClasses({ rows: ROWS, classes: ['no>such'] }), {}, 'an absent class filter yields nothing (never invented)');
});

test('gsm8k adapter — parseGold à nu: fail-closed on every malformed row', () => {
	assert.deepEqual(adapter.parseGold(ROWS[0].answer), { shape: ['divide', 'add'], value: 72 });
	assert.equal(adapter.parseGold(ROWS[4].answer), null, 'a wrong annotation result is a REJECT, not a tolerance');
	assert.equal(adapter.parseGold(ROWS[5].answer), null, 'a non-binary expression is a REJECT');
	assert.equal(adapter.parseGold(ROWS[6].answer), null, 'a chain that does not land on #### is a REJECT');
	assert.equal(adapter.parseGold('no annotations at all\n#### 5'), null);
});

test('gsm8k adapter — decompose: gold-mode (ask=null) returns the gold shape; corrupt truncates (the neg-control hook)', async () => {
	const rec = adapter.loadClasses({ rows: ROWS })['divide>add'][0];
	assert.deepEqual(await adapter.decompose(null, rec), ['divide', 'add']);
	assert.deepEqual(await adapter.decompose(null, rec, { corrupt: true }), ['divide'], 'the dossier neg-control relies on this');
});

test('gsm8k adapter — decompose: model mode parses the grammar-insured {"steps":[...]} and snaps to the enum', async () => {
	const rec = adapter.loadClasses({ rows: ROWS })['divide>add'][0];
	let seen = null;
	const ask = async ( q ) => { seen = q; return 'noise {"steps":["Divide","ADD"]} noise'; };
	assert.deepEqual(await adapter.decompose(ask, rec), ['divide', 'add'], 'case-insensitive snap onto the enum');
	assert.match(String(seen.system), /add, subtract, multiply, divide/, 'the enum is the declared vocabulary');
	assert.ok(seen.grammar && seen.grammar.jsonSchema, 'grammar-insured decoding (format insurance, the measured rule)');
});
