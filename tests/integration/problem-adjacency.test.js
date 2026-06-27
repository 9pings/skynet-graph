'use strict';
/**
 * FLAGSHIP bounded ADJACENCY WINDOW (2026-06-27): the `reached` spine is extended with a capped `trail` —
 * the last WINDOW resolved steps — so a step can be resolved against a bounded HORIZON of recent steps, not
 * just the immediate predecessor, WITHOUT growing per-call context. Demonstrated on a "no-repeat within K
 * steps" constraint: an immediate-only window (1) violates it; a K-window satisfies it; the handed trail
 * stays bounded by the window (constant context, independent of plan length).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { runWithWindow, K, N } = require('../../examples/poc/problem-adjacency.js');

test('a K-window satisfies a within-K constraint that immediate-only adjacency cannot', async () => {
	const w1 = await runWithWindow(1);
	const wK = await runWithWindow(K);

	// NEGATIVE CONTROL: immediate-only adjacency GENUINELY violates the constraint (the test is not vacuous —
	// the window actually matters). It ping-pongs and repeats within the K-horizon.
	assert.ok(w1.violations > 0, `immediate-only (window=1) violates the within-${K} constraint (${w1.violations} repeats)`);

	// the bounded K-window sees the whole horizon and satisfies the constraint.
	assert.equal(wK.violations, 0, `the K-window eliminates all within-${K} repeats`);
	assert.ok(wK.violations < w1.violations, 'the window strictly reduces violations');

	// CONTEXT BOUND: the handed trail never exceeds the window — constant context, independent of plan length.
	assert.ok(w1.maxTrail <= 1, 'window=1 hands at most 1 prior step');
	assert.ok(wK.maxTrail <= K, `window=${K} hands at most ${K} prior steps (bounded)`);
	assert.ok(wK.maxTrail < N, 'the horizon is bounded well below the full plan length (no unbounded history)');

	// the K-window plan actually used the whole pool in rotation (it read the horizon, not just `prev`).
	assert.ok(new Set(wK.seq).size >= K + 1, 'the K-window rotated through more than K distinct resources');
});
