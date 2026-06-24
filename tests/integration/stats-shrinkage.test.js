'use strict';
/**
 * Hierarchical Beta-Binomial shrinkage on the real engine (experiment A1). Wave 1 pools the
 * children's grand mean (race-free {__push} + cardinality gate) and SNAPS it; wave 2 (a host
 * addConcept, "offline between revisions") shrinks each leaf toward the snapped prior and gates
 * Trusted on the snapped reliability rank. Reproduces A1's numbers and convergence (0 divergent).
 *
 * Bonus: wave 2 adds a PROVIDER-FUL concept onto a quiescent graph — the path the P2 fix
 * unblocked — and it settles cleanly.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createStats, shrinkageConceptTree } = require('../../lib/providers');

console.log = console.info = console.warn = () => {};

Graph._providers = Object.assign({}, Graph._providers, createStats());

const cfg = { label: 'shrinkage', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

// metro reliable (small n), flight mid, bus poor — small n so shrinkage matters.
const cats = [
	{ id: 'cat_metro', succ: 19, tot: 20 },   // raw 0.95
	{ id: 'cat_flight', succ: 12, tot: 16 },   // raw 0.75
	{ id: 'cat_bus', succ: 3, tot: 8 }         // raw 0.375
];

test('pools the snapped grand mean, then shrinks leaves toward it and gates Trusted (A1)', async () => {
	const frag = shrinkageConceptTree({ kappa: 8, trustedRank: 2 });
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'pool', PoolRoot: true, expected: cats.length, obs: [] }].concat(
			cats.map((c) => ({ _id: c.id, Cat: true, succ: c.succ, tot: c.tot }))
		),
		segments: []
	};

	// wave 1: pool the grand mean
	const g = new Graph(seed, cfg, { common: frag.pool });
	await nextStable(g);
	const pool = g._objById['pool']._etty._;
	assert.equal(pool.Pool, true, 'Pool cast (cardinality gate satisfied)');
	assert.ok(Math.abs(pool.pHat0 - 34 / 44) < 1e-9, 'grand mean = 34/44');
	assert.equal(pool.pHat0Bucket, 'high', 'snapped to the high band');
	assert.equal(pool.pHat0Mid, 0.825, 'snapped prior midpoint');

	// wave 2: enable leaf shrinkage now that the prior exists (provider-ful addConcept on a
	// quiescent graph — exercises the post-P2-fix path)
	g.addConcept('Cat', frag.shrink);
	await nextStable(g);

	const read = (id) => g._objById[id]._etty._;
	const metro = read('cat_metro'), flight = read('cat_flight'), bus = read('cat_bus');

	// θ̂ matches A1 (prior 0.825, κ=8)
	assert.ok(Math.abs(metro.thetaHat - 0.914) < 0.01, 'metro shrunk ≈ 0.914');
	assert.ok(Math.abs(flight.thetaHat - 0.775) < 0.01, 'flight shrunk ≈ 0.775');
	assert.ok(Math.abs(bus.thetaHat - 0.6) < 0.01, 'bus shrunk ≈ 0.60');

	// the gate keys on the snapped rank: metro+flight Trusted (rank>=2), bus not (rank 1)
	assert.equal(metro.Trusted, true, 'metro Trusted');
	assert.equal(flight.Trusted, true, 'flight Trusted');
	assert.ok(!bus.Trusted, 'bus NOT Trusted (med band)');

	// convergence: every leaf shrank, none went divergent
	for (const c of cats) {
		assert.equal(read(c.id).Reliability, true, 'Reliability cast on ' + c.id);
		assert.ok(!(read(c.id).divergent && read(c.id).divergent.length), 'no divergent on ' + c.id);
	}
});
