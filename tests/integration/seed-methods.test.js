'use strict';
// Seeding base concept-methods from a dictionary of abstractions (CD primitive ACTs) + judging the seed
// population with method-explorer. Deterministic, 0 model calls — the trackable payoff of the abstractions
// study. Exercises stock.js#goldGate/packStock + method-explorer + library dispatch (existing bricks only).
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const { runSeedMethods } = require('../../examples/poc/seed-methods.js');

test('seed base concept-methods → gold-gate → .sgc → judge population (coverage + openness)', () => {
	const r = runSeedMethods();

	// G1 SOUNDNESS — the 5 correctly-authored ACT schemas are admitted by the gold-gate.
	assert.equal(r.admitted.length, 5);
	assert.deepEqual(r.admitted.map(( a ) => a.act ).sort(), ['ATRANS', 'GRASP', 'INGEST', 'MTRANS', 'PTRANS']);

	// G2 NEG-CONTROL — a corrupted PTRANS (wrong role sequence) is REJECTED (the gate is not vacuous).
	assert.equal(r.rejected.length, 1);
	assert.equal(r.rejected[0].corrupt, true);
	assert.equal(r.rejected[0].reason, 'shape-mismatches-gold');

	// G3 PORTABILITY — the seed packs to .sgc and reloads whole.
	assert.equal(r.reloaded, 5);

	// G4 DISPATCH — the O(1) bucket lookup returns the seeded methods (scanned homogeneous seed = one bucket;
	// the scanned<<total win manifests for structurally-DISTINCT methods — honest, not overclaimed here).
	assert.ok(r.dispatch.candidates.length >= 1, 'dispatch finds seeded candidates');
	assert.equal(r.dispatch.total, 5);

	// G5 COVERAGE — the explorer reports which ACTs of the declared 11-set have a method, and the GAPS.
	const cov = r.report.population.coverage.find(( c ) => c.key === 'act' );
	assert.equal(cov.covered, 5);
	assert.equal(cov.expected, 11);
	assert.deepEqual(cov.missing, ['ATTEND', 'EXPEL', 'MOVE', 'PROPEL', 'PTRANS_SELF', 'SPEAK'], 'the population gaps are named');
	assert.equal(cov.fraction, 5 / 11);

	// G6 OPENNESS — 5 distinct classes, all singletons, even distribution (entropy = max).
	const o = r.report.population.openness;
	assert.equal(o.distinctClasses, 5);
	assert.equal(o.singletonFraction, 1);
	assert.equal(Math.round(o.entropyBits * 100), Math.round(o.maxEntropyBits * 100), 'a uniform seed maxes the class entropy');
});
