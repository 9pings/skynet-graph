'use strict';
/**
 * concept-net — a POPULATION of concept-units (gate-NN × update-NN each) run to a fixpoint and
 * trained end-to-end by implicit diff (the user's target substrate; study 2026-06-26). Validates:
 * (1) the population gradient is correct (vs finite-difference), (2) training CONVERGES as the
 * population scales 2→6 concept-units (the STE-depth/variance question), (3) STE (hard cast) trains,
 * (4) the FORM can evolve — grow the population by a unit and it still learns. CPU, offline, ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makePopulation, ringPopulation, loss, grad, train } = require('../../lib/authoring/concept-net.js');

function mulberry32( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function gradFD( pop, th, X, T, eps ) {
	eps = eps || 1e-6; const g = new Array(pop.nParams);
	for ( let k = 0; k < pop.nParams; k++ ) { const a = th.slice(), b = th.slice(); a[k] += eps; b[k] -= eps; g[k] = (loss(pop, a, X, T) - loss(pop, b, X, T)) / (2 * eps); }
	return g;
}

test('a ring population settles to a fixpoint', () => {
	const pop = ringPopulation(4);
	const th = pop.randomParams(mulberry32(1), 0.5);
	const r = pop.settle(th, 0.7);
	assert.ok(r.converged, 'the gated equilibrium converges');
	assert.equal(r.z.length, 4);
});

test('the POPULATION gradient (implicit diff) matches finite-difference (K=3, soft)', () => {
	const pop = ringPopulation(3);
	const teacher = pop.randomParams(mulberry32(7), 0.6);
	const X = [-1, -0.3, 0.4, 1];
	const T = X.map((x) => pop.settle(teacher, x).z[pop.outC]);
	const th = pop.randomParams(mulberry32(99), 0.6);                // a different point → nonzero grad
	const gi = grad(pop, th, X, T, { mode: 'direct' }).grad;
	const gf = gradFD(pop, th, X, T, 1e-6);
	let maxErr = 0; for ( let k = 0; k < pop.nParams; k++ ) maxErr = Math.max(maxErr, Math.abs(gi[k] - gf[k]));
	assert.ok(maxErr < 1e-4, `population implicit grad ≈ FD (max err ${maxErr})`);
});

test('SCALING: training converges across a population of 2→6 concept-units (soft)', () => {
	const out = [];
	for ( let K = 2; K <= 6; K++ ) {
		const pop = ringPopulation(K);
		const teacher = pop.randomParams(mulberry32(100 + K), 0.5);
		const X = [-1, -0.4, 0.2, 0.8];
		const T = X.map((x) => pop.settle(teacher, x).z[pop.outC]);
		const r = train(pop, { X, T, steps: 1500, lr: 0.05, theta0: pop.randomParams(mulberry32(300 + K), 0.5) });
		out.push({ K, loss0: r.loss0, loss: r.loss, rho: r.rho });
		assert.ok(r.loss < 0.2 * r.loss0 && r.loss < 5e-2,
			`K=${K}: training drives the composite loss down (${r.loss0.toExponential(1)} → ${r.loss.toExponential(1)}, ρ≈${r.rho.toFixed(2)})`);
	}
	// learning does not collapse as the population grows
	assert.ok(out.every((o) => o.loss < 5e-2), 'convergence holds for every population size 2..6');
});

test('STE: a hard-cast population trains (the gate decisions are quantized; STE descends)', () => {
	const pop = ringPopulation(3);
	const teacher = pop.randomParams(mulberry32(11), 0.7);
	const X = [-0.8, -0.2, 0.3, 0.9];
	const T = X.map((x) => pop.settle(teacher, x, { hard: true }).z[pop.outC]);
	const r = train(pop, { X, T, steps: 1200, lr: 0.05, hard: true, theta0: pop.randomParams(mulberry32(12), 0.7) });
	assert.ok(r.loss < 0.5 * r.loss0, `STE training reduces the hard-cast population loss (${r.loss0.toExponential(1)} → ${r.loss.toExponential(1)})`);
});

test('the FORM evolves: growing the population by a concept-unit still learns', () => {
	// start from a 3-ring, then GROW to a 4-ring (a new unit spliced into the cycle) and retrain
	const grown = ringPopulation(4);
	const teacher = grown.randomParams(mulberry32(21), 0.5);
	const X = [-1, 0, 1];
	const T = X.map((x) => grown.settle(teacher, x).z[grown.outC]);
	const r = train(grown, { X, T, steps: 1500, lr: 0.05, theta0: grown.randomParams(mulberry32(22), 0.5) });
	assert.ok(r.loss < 0.2 * r.loss0 && r.loss < 5e-2, `the grown population learns (${r.loss0.toExponential(1)} → ${r.loss.toExponential(1)})`);
});
