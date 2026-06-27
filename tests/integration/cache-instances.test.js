'use strict';
/**
 * DERIVATION CACHE × METHOD/INSTANCE (2026-06-27) — the cache (`lib/providers/cache.js`) wraps the EXISTING
 * problem-paths providers (additive; the grammar is untouched) and several record-instances flow through the
 * same warm METHOD. The study's §5 payoff, MEASURED + guarded by a negative control: a 2nd identical instance
 * replays at ZERO model calls; a genuinely DIFFERENT instance correctly MISSES (the cache keys on the
 * canonical justification — no false replay).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { scenario } = require('../../examples/poc/cache-instances.js');

test('a warm method runs an identical instance for free, but a different instance still pays', async () => {
	const r = await scenario();

	// the cold instance pays the model; all three instances solve the same-shape problem (16 steps).
	assert.ok(r.cold > 0, 'the cold instance made real model calls');
	assert.equal(r.steps1.length, 16, 'instance 1 solved the 16-step problem');

	// THE PAYOFF: the 2nd identical instance replays entirely — zero model calls.
	assert.equal(r.warm, 0, 'the second identical instance made ZERO model calls (fully replayed from the warm method)');
	assert.deepEqual(r.steps2, r.steps1, 'and produced the identical plan');

	// NEGATIVE CONTROL: a genuinely different instance MISSES — the cache keys on the justification, it does
	// not blindly replay. (A non-overlapping range shares no sub-problem justifications.)
	assert.ok(r.diff > 0, 'a different instance still costs model calls — no false replay');
	assert.equal(r.diff, r.cold, 'the different instance costs the SAME as cold (no spurious hits)');

	// accounting: warm-instance hits are real, no bypasses (every cast was keyable).
	assert.ok(r.stats.hits > 0, 'the warm instance produced cache hits');
	assert.equal(r.stats.bypass, 0, 'every cast was keyable (no bypass in this deterministic method)');
});
