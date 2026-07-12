'use strict';
/**
 * leaf-io — the typed leaf I/O discipline (lib/authoring/leaf-io.js, tiered-plan gap ii). Deterministic, no model.
 * Locks: bare number/bool acceptance, the tolerated surface noise (var-name echo, shown-work "=", $, commas, one
 * trailing unit, punctuation), and the FAIL-CLOSED refusals (empty, prose, several distinct numbers, wrong kind) —
 * each refusal is the negative control of the matching acceptance.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLeafValue, LEAF_ANSWER_SYSTEM, LEAF_ANSWER_SYSTEM_ANY } = require('../../lib/authoring/leaf-io.js');

test('accepts bare typed values', () => {
	assert.deepEqual(parseLeafValue('24'), { ok: true, kind: 'number', value: 24 });
	assert.deepEqual(parseLeafValue(' -3.5 '), { ok: true, kind: 'number', value: -3.5 });
	assert.deepEqual(parseLeafValue('yes.'), { ok: true, kind: 'bool', value: 'yes' });
	assert.deepEqual(parseLeafValue('No'), { ok: true, kind: 'bool', value: 'no' });
});

test('tolerates the executor surface noise — echo, shown work, $, commas, unit, punctuation', () => {
	assert.equal(parseLeafValue('area=120').value, 120, 'var-name echo → RHS');
	assert.equal(parseLeafValue('6*4=24').value, 24, 'shown work → the declared result');
	assert.equal(parseLeafValue('result: 72').value, 72, 'label: → RHS');
	assert.equal(parseLeafValue('$10').value, 10);
	assert.equal(parseLeafValue('1,200').value, 1200);
	assert.equal(parseLeafValue('72 km/h').value, 72, 'one trailing unit word tolerated');
	assert.equal(parseLeafValue('"35"').value, 35);
});

test('FAIL-CLOSED — ambiguity/prose/empty are typed refusals, never guesses', () => {
	assert.equal(parseLeafValue('').ok, false);
	assert.equal(parseLeafValue('120 and 30').ok, false, 'two distinct numbers = ambiguous');
	assert.equal(parseLeafValue('The area is 24 square units of surface').ok, false, 'prose refused');
	assert.equal(parseLeafValue('I cannot determine this').ok, false, 'no value refused');
	assert.match(parseLeafValue('120 and 30').blame, /ambiguous/);
	assert.equal(parseLeafValue('2:30').ok, false, 'numeric label is not a var echo');
});

test('kind restriction — number-only rejects bool, bool-only rejects number', () => {
	assert.equal(parseLeafValue('yes', { kind: 'number' }).ok, false);
	assert.equal(parseLeafValue('24', { kind: 'bool' }).ok, false);
	assert.equal(parseLeafValue('24', { kind: 'number' }).value, 24);
});

test('LEAF_ANSWER_SYSTEM — the executor contract matches the parser (bare result, number or yes/no)', () => {
	assert.match(LEAF_ANSWER_SYSTEM, /ONLY the bare result/);
	assert.match(LEAF_ANSWER_SYSTEM, /yes\/no/);
});

test('kind text — a short bare string is accepted VERBATIM; label echo tolerated; prose/long refused', () => {
	assert.deepEqual(parseLeafValue('ESPN', { kind: 'text' }), { ok: true, kind: 'text', value: 'ESPN' });
	assert.equal(parseLeafValue('"Craig Zimmer"', { kind: 'text' }).value, 'Craig Zimmer');
	assert.equal(parseLeafValue('network: ESPN', { kind: 'text' }).value, 'ESPN', 'label echo → RHS');
	assert.equal(parseLeafValue('32, 44', { kind: 'text' }).value, '32, 44', 'a digit-bearing CELL text stays verbatim');
	assert.equal(parseLeafValue('Butler CC (KS)', { kind: 'text' }).value, 'Butler CC (KS)');
	assert.equal(parseLeafValue('', { kind: 'text' }).ok, false);
	assert.equal(parseLeafValue('The matching network in that row is ESPN as the host says', { kind: 'text' }).ok, false, 'prose refused');
	// régression A2 (mutilation) : une cellule texte À CHIFFRES reste VERBATIM sous kind text — jamais
	// dégradée en nombre (la préférence-nombre est le propre du kind any, pas de text).
	assert.equal(parseLeafValue('A 50729', { kind: 'text' }).value, 'A 50729');
	assert.equal(parseLeafValue('25mm', { kind: 'text' }).value, '25mm');
	assert.equal(parseLeafValue('Saturday, 17 February', { kind: 'text' }).value, 'Saturday, 17 February');
	assert.equal(parseLeafValue('Y2K remediation for all platforms', { kind: 'text' }).value, 'Y2K remediation for all platforms');
});

test('kind any — number preferred, then bool, then short text; the DEFAULT auto stays text-blind (compat)', () => {
	assert.deepEqual(parseLeafValue('24', { kind: 'any' }), { ok: true, kind: 'number', value: 24 });
	assert.equal(parseLeafValue('yes', { kind: 'any' }).kind, 'bool');
	assert.deepEqual(parseLeafValue('Craig Zimmer', { kind: 'any' }), { ok: true, kind: 'text', value: 'Craig Zimmer' });
	assert.equal(parseLeafValue('32, 44', { kind: 'any' }).kind, 'text', 'two numbers in a cell surface = TEXT under any, not ambiguity');
	assert.equal(parseLeafValue('72 km/h', { kind: 'any' }).value, 72, 'a clean number+unit stays a NUMBER under any');
	// NEG — fail-closed unchanged: the default (auto) still refuses text; any refuses refusal-prose and long prose.
	assert.equal(parseLeafValue('Craig Zimmer').ok, false, 'auto (default) refuses text — backward compat');
	assert.equal(parseLeafValue('I cannot determine this', { kind: 'any' }).ok, false, 'a refusal phrase NEVER becomes a pool value');
	assert.equal(parseLeafValue('The area is 24 square units of surface', { kind: 'any' }).ok, false, 'prose stays refused under any');
});

test('LEAF_ANSWER_SYSTEM_ANY — the any-kind executor contract exists and names the exact-text option', () => {
	assert.match(LEAF_ANSWER_SYSTEM_ANY, /ONLY the bare result/);
	assert.match(LEAF_ANSWER_SYSTEM_ANY, /exact text/i);
});
