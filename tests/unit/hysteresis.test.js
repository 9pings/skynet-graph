'use strict';
/**
 * Hysteresis dead-band (lib/authoring/core/hysteresis.js, experiment C / P3). A single fixed margin
 * oscillates when the re-eval variance exceeds it; a ≥3σ dead-band converges (0 steady-state flips).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeHysteresis, bandFromSigma } = require('../../lib/authoring/core/hysteresis');

test('decision logic: adopt on clear improvement, revert on clear regression, else hold', () => {
	const h = makeHysteresis({ keepThreshold: 5, mergeThreshold: 5, betterIsLower: true });
	// lower-is-better: gain = baseline − candidate
	assert.equal(h.decide(90, 100, 'coarse'), 'adopt', 'gain 10 ≥ 5 -> adopt the finer grain');
	assert.equal(h.decide(98, 100, 'coarse'), 'hold', 'gain 2 < 5 -> hold (do not adopt noise)');
	assert.equal(h.decide(110, 100, 'fine'), 'revert', 'regression 10 ≥ 5 -> revert');
	assert.equal(h.decide(102, 100, 'fine'), 'hold', 'small fluctuation -> hold (no oscillation)');
});

test('higher-is-better polarity flips the gain sign', () => {
	const h = makeHysteresis({ keepThreshold: 5, betterIsLower: false });
	assert.equal(h.decide(110, 100, 'coarse'), 'adopt', 'accuracy up 10 -> adopt');
	assert.equal(h.decide(90, 100, 'fine'), 'revert', 'accuracy down 10 -> revert');
});

test('bandFromSigma sizes the dead-band to ~k·σ (default 3)', () => {
	assert.equal(bandFromSigma(4), 12);
	assert.equal(bandFromSigma(4, 2), 8);
});

// deterministic Monte-Carlo: a near-zero true benefit under high re-eval variance.
function prng(seed) {
	return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gauss(rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function countFlips(h, episodes, trueGain, sigma, seed) {
	const rng = prng(seed);
	let regime = 'coarse', flips = 0;
	for (let i = 0; i < episodes; i++) {
		const gain = trueGain + sigma * gauss(rng);     // re-eval noise on the measured gain
		const candidate = 100 - gain, baseline = 100;   // lower-is-better encoding
		const action = h.decide(candidate, baseline, regime);
		if (action === 'adopt' && regime === 'coarse') { regime = 'fine'; flips++; }
		else if (action === 'revert' && regime === 'fine') { regime = 'coarse'; flips++; }
	}
	return flips;
}

test('a fixed margin oscillates under re-eval variance; a ≥3σ dead-band converges (C probe)', () => {
	const sigma = 14.7, trueGain = 1.0, EP = 300, SEED = 12345;
	// fixed margin smaller than the noise: flips often
	const fixed = makeHysteresis({ keepThreshold: 1, mergeThreshold: 1, betterIsLower: true });
	// hysteresis dead-band sized to 3σ: rarely leaves a regime once settled
	const hyst = makeHysteresis({ keepThreshold: bandFromSigma(sigma), mergeThreshold: bandFromSigma(sigma), betterIsLower: true });

	const fixedFlips = countFlips(fixed, EP, trueGain, sigma, SEED);
	const hystFlips = countFlips(hyst, EP, trueGain, sigma, SEED);

	assert.ok(fixedFlips > 30, `fixed margin oscillates (got ${fixedFlips} flips over ${EP})`);
	assert.ok(hystFlips <= 3, `3σ dead-band converges (got ${hystFlips} flips)`);
	assert.ok(hystFlips * 8 < fixedFlips, 'the dead-band reduces flips by ≫ an order of magnitude');
});
