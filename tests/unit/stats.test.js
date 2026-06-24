'use strict';
/**
 * L1 hierarchical Beta-Binomial shrinkage (lib/providers/stats.js, experiment A). The
 * statistical claim (A3): shrinking a small-n leaf rate toward the parent prior cuts MSE;
 * the barrier claim (A2): consume the SNAPPED prior and gate on the snapped rank.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shrink, reliabilityBandOf, empiricalBayesKappa, createStats, shrinkageConceptTree } = require('../../lib/providers');

test('shrink pulls a small-n rate toward the prior; large n ≈ raw', () => {
	// bus: raw 0.375 over n=8, prior 0.625 (med band midpoint), kappa 8
	const r = shrink({ succ: 3, tot: 8, prior: 0.625, kappa: 8 });
	assert.ok(Math.abs(r.raw - 0.375) < 1e-12);
	assert.ok(r.theta > r.raw && r.theta < 0.625, 'shrunk between raw and prior');
	assert.ok(Math.abs(r.theta - (8 * 0.375 + 8 * 0.625) / 16) < 1e-12, 'θ̂=(n·x̄+κ·prior)/(n+κ)');
	// at large n the prior barely moves the estimate
	const big = shrink({ succ: 375, tot: 1000, prior: 0.95, kappa: 8 });
	assert.ok(Math.abs(big.theta - 0.375) < 0.01, 'large n -> θ̂ ≈ raw');
	// n=0 degrades to 0.5
	assert.equal(shrink({ succ: 0, tot: 0, prior: 0.9 }).raw, 0.5);
});

test('shrinkage reduces error at small n (deterministic bias-variance check)', () => {
	// truth 0.8; a small-n leaf observed a noisy-low 0.4; the prior (grand mean) is 0.8.
	const truth = 0.8, prior = 0.8;
	const raw = shrink({ succ: 2, tot: 5, prior, kappa: 8 }).raw;           // 0.4
	const theta = shrink({ succ: 2, tot: 5, prior, kappa: 8 }).theta;
	const errRaw = Math.abs(raw - truth), errShr = Math.abs(theta - truth);
	assert.ok(errShr < errRaw, 'shrinking the noisy small-n estimate toward a good prior is closer to truth');
});

test('empiricalBayesKappa: positive, larger when leaves barely differ beyond sampling noise', () => {
	// tightly-clustered rates (little signal) -> strong pooling (big κ)
	const tight = empiricalBayesKappa([0.79, 0.80, 0.81, 0.80], 5);
	// widely-spread rates (real signal) -> weak pooling (small κ)
	const spread = empiricalBayesKappa([0.2, 0.5, 0.8, 0.95], 5);
	assert.ok(tight > 0 && spread > 0);
	assert.ok(tight > spread, 'less between-leaf signal -> more shrinkage');
});

test('reliability bands: edges 0.5/0.75/0.9 with band midpoints (the snapped prior)', () => {
	assert.deepEqual([reliabilityBandOf(0.3).label, reliabilityBandOf(0.3).mid], ['low', 0.25]);
	assert.deepEqual([reliabilityBandOf(0.6).label, reliabilityBandOf(0.6).mid], ['med', 0.625]);
	assert.deepEqual([reliabilityBandOf(0.8).label, reliabilityBandOf(0.8).mid], ['high', 0.825]);
	assert.deepEqual([reliabilityBandOf(0.95).label, reliabilityBandOf(0.95).mid], ['certain', 0.95]);
	assert.equal(reliabilityBandOf(0.9).label, 'certain');   // 0.9 is no longer "high"
});

test('createStats exposes report/grandMean/shrink; shrinkageConceptTree gives both waves', () => {
	const frag = createStats();
	for (const fn of ['report', 'grandMean', 'shrink']) assert.equal(typeof frag.Stats[fn], 'function');
	const t = shrinkageConceptTree({ trustedRank: 2 });
	assert.ok(t.pool.childConcepts.PoolRoot && t.pool.childConcepts.Cat, 'wave 1 = pool + cat');
	assert.deepEqual(t.shrink.provider, ['Stats::shrink']);
	// the Trusted gate keys on the SNAPPED rank, not a raw float (barrier)
	assert.deepEqual(t.shrink.childConcepts.Trusted.ensure, ['$relRank>=2']);
});
