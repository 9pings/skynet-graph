'use strict';
/**
 * lifecycle (study 2026-06-26, pass 4): plasticity as a UNIFIED continuous knob p∈[0,1] per
 * concept — 1 = fully plastic (learning / high creativity), 0 = frozen (deterministic,
 * consolidated spine). The SAME value modulates a mini-NN concept (noise/lr) or an LLM
 * concept (temperature). The discrete regimes {plastic, probationary, frozen} are just the
 * rounding/banding of p. Consolidation (CLS): p anneals toward 0 as reliability is proven.
 * Plasticity lives in the host-side ledger — it modulates the provider, it never gates
 * applicability (K1 membrane).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle } = require('../../lib/authoring/core/lifecycle.js');

test('a concept is born fully plastic (p=1)', () => {
	const lc = createLifecycle();
	lc.register('M');
	assert.equal(lc.plasticity('M'), 1);
	assert.equal(lc.regime('M'), 'plastic');
});

test('plasticity anneals to 0 (frozen) as reliability is proven', () => {
	const lc = createLifecycle();
	lc.register('M');
	lc.record('M', true); lc.record('M', true); lc.record('M', true); // 3/3 -> certain (rank 3)
	assert.equal(lc.plasticity('M'), 0);
	assert.equal(lc.regime('M'), 'frozen');
});

test('a concept that does not prove out stays plastic (never consolidates)', () => {
	const lc = createLifecycle();
	lc.register('M');
	lc.record('M', false); lc.record('M', false); lc.record('M', true); // 1/3 ~ low (rank 0)
	assert.equal(lc.plasticity('M'), 1);
	assert.equal(lc.regime('M'), 'plastic');
});

test('partial reliability gives intermediate plasticity (probationary)', () => {
	const lc = createLifecycle();
	lc.register('M');
	lc.record('M', true); lc.record('M', true); lc.record('M', true); lc.record('M', false); // 3/4=0.75 -> high (rank 2)
	assert.equal(lc.regime('M'), 'probationary');
	const p = lc.plasticity('M');
	assert.ok(p > 0 && p < 1, 'intermediate plasticity');
});

test('reputation is exposed (the host threads plasticity into NN noise / LLM temperature)', () => {
	const lc = createLifecycle();
	lc.register('M'); lc.record('M', true); lc.record('M', true);
	const r = lc.reputation('M');
	assert.equal(r.trials, 2);
	assert.equal(r.successes, 2);
	assert.ok('rank' in r && 'theta' in r);
});
