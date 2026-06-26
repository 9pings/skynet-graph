'use strict';
/**
 * concept-net unroll — serve a CYCLIC population on the engine by unrolling its fixpoint to depth N
 * (Picard), turning the recurrence into an acyclic DAG (study 2026-06-26; the cyclic-on-engine rung).
 * The engine cannot natively iterate a value-feedback loop (#22/#15) and a directly-baked cycle
 * deadlocks (producer-cycle require graph), so unroll then bake. The depth-N readout → the true
 * fixpoint as N grows (~ρ^N). Weights are TIED across stages. CPU, ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ringPopulation, unrollPopulation } = require('../../lib/authoring/concept-net.js');

function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('unrolling a cyclic population approaches its fixpoint as depth N grows (Picard, ~ρ^N)', () => {
	const ring = ringPopulation(3);
	const theta = ring.randomParams(mb(1), 0.6);
	const x = 0.5;
	const fp = ring.settle(theta, x).z[ring.outC];                 // the true cyclic fixpoint (soft)
	const err = (N) => { const u = unrollPopulation(ring, N); return Math.abs(u.pop.settle(u.tieTheta(theta), x).z[u.pop.outC] - fp); };
	assert.ok(err(1) > 1e-3, 'a shallow unroll (N=1) misses the fixpoint');
	assert.ok(err(8) < 1e-5, 'a deep unroll (N=8) reaches it');
	assert.ok(err(8) < err(2), 'the unroll error shrinks geometrically with depth');
});

test('the unrolled population ties weights across the N stages (one recurrence, reused)', () => {
	const ring = ringPopulation(3);
	const theta = ring.randomParams(mb(2), 0.5);
	const u = unrollPopulation(ring, 5);
	assert.equal(u.pop.nParams, 5 * ring.nParams, 'N stages of the same units');
	assert.equal(u.tieTheta(theta).length, 5 * ring.nParams, 'tieTheta repeats the frozen weights per stage');
});
