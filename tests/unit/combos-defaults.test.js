'use strict';
/**
 * Combos shared defaults (lib/combos/defaults.js) — the ONE place the §4 product posture is decided.
 * Pure config; no engine, no network. buildAsk is exercised only on the function/throw paths (the
 * {localModel} path would load the native node-llama-cpp dep — a GPU/integration concern).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveComboDefaults, buildAsk } = require('../../lib/combos/defaults.js');

test('resolveComboDefaults: the §4 posture ON by default (fail-closed, gate, memo, validate; grammar OFF)', () => {
	const d = resolveComboDefaults();
	assert.equal(d.failClosed, true);
	assert.equal(d.gate, 'gated');
	assert.equal(d.requireTyped, true);
	assert.equal(d.memo, true);
	assert.equal(d.validate, true);
	assert.equal(d.audit, true);
	assert.equal(d.logLevel, 'warn');
	assert.equal(d.grammar, false, 'constrained grammar is OFF by default (STAGE-1 finding)');
	assert.equal(d.ask, null, 'no default LLM backend (opt-in)');
	assert.equal(d.durable, null, 'durable is opt-in');
	assert.equal(d.learning, false, 'learning loop is opt-in');
});

test('resolveComboDefaults: host overrides are honored (each knob is real config)', () => {
	const d = resolveComboDefaults({ memo: false, grammar: true, gate: 'ungated', validate: false, logLevel: 'info', learning: true, durable: '/tmp/s.db' });
	assert.equal(d.memo, false);
	assert.equal(d.grammar, true);
	assert.equal(d.gate, 'ungated');
	assert.equal(d.validate, false);
	assert.equal(d.logLevel, 'info');
	assert.equal(d.learning, true);
	assert.equal(d.durable, '/tmp/s.db');
	// unspecified knobs keep their default
	assert.equal(d.failClosed, true);
});

test('buildAsk: a function backend is returned as-is', () => {
	const fn = async () => 'x';
	assert.equal(buildAsk({ ask: fn }), fn);
});

test('buildAsk: no backend throws (a combo needs a backend, opt-in)', () => {
	assert.throws(() => buildAsk({ ask: null }), /backend/);
	assert.throws(() => buildAsk({}), /backend/);
	assert.throws(() => buildAsk(), /backend/);
});
