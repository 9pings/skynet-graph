'use strict';
/**
 * graph-net — a SHARED-WEIGHT GNN population over a graph, trained by DEQ (study 2026-06-26; the
 * rung after concept-net, toward real graph problems + the self-training loop). Validates: (1) the
 * shared-weight DEQ gradient is correct (vs finite-difference), (2) the SAME rule applied at every
 * node trains to recover a teacher rule's fixpoint AND (3) generalises to a graph it never saw.
 * CPU, offline, ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { graphPopulation, graphLoss, graphGrad, trainGraph } = require('../../experiments/probabilistic-concepts/graph-net.js');

function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// a few small graphs
const ringEdges = (n) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
const z0For = (n, rng) => Array.from({ length: n }, () => rng());

function gradFD( gp, th, eps, episodes ) {
	eps = eps || 1e-6; const g = new Array(gp.nParams);
	for ( let k = 0; k < gp.nParams; k++ ) { const a = th.slice(), b = th.slice(); a[k] += eps; b[k] -= eps; g[k] = (graphLoss(gp, a, episodes) - graphLoss(gp, b, episodes)) / (2 * eps); }
	return g;
}

test('a shared-weight GNN settles to a fixpoint over a graph', () => {
	const gp = graphPopulation(5, ringEdges(5));
	const r = gp.settle(gp.randomParams(mb(1), 0.6), z0For(5, mb(2)));
	assert.ok(r.converged, 'the equilibrium GNN converges');
	assert.equal(r.z.length, 5);
});

test('the shared-weight DEQ gradient matches finite-difference', () => {
	const gp = graphPopulation(5, ringEdges(5));
	const rng = mb(3);
	const episodes = [0, 1, 2].map(() => { const z0 = z0For(5, rng); return { z0, target: z0.map((v) => 0.5 * v + 0.1) }; });
	const th = gp.randomParams(mb(4), 0.6);
	const gi = graphGrad(gp, th, episodes), gf = gradFD(gp, th, 1e-6, episodes);
	let maxErr = 0; for ( let k = 0; k < gp.nParams; k++ ) maxErr = Math.max(maxErr, Math.abs(gi[k] - gf[k]));
	assert.ok(maxErr < 1e-4, `shared-weight implicit grad ≈ FD (max err ${maxErr})`);
});

test('SEED-ANCHORED propagation trains: a clamped source breaks the oversmoothing symmetry', () => {
	// node 0 is CLAMPED (the grounded anchor); the rule must propagate its value to the free nodes.
	// (An unclamped equilibrium GNN oversmooths to consensus and cannot learn this — finding #26.)
	const N = 6, gp = graphPopulation(N, ringEdges(N), { clamp: [0] });
	const rng = mb(30);
	const episodes = Array.from({ length: 10 }, () => {
		const v = rng() < 0.5 ? 0.05 : 0.95;                      // the grounded source value
		const z0 = [v].concat(Array.from({ length: N - 1 }, () => 0.5));
		const target = new Array(N).fill(v);                      // oracle: propagate the source everywhere
		return { z0, target };
	});
	const r = trainGraph(gp, episodes, { steps: 2500, lr: 0.05, theta0: gp.randomParams(mb(31), 0.8) });
	assert.ok(r.loss < 0.05 * r.loss0 && r.loss < 1e-3, `anchored propagation trains (${r.loss0.toExponential(1)} → ${r.loss.toExponential(1)})`);
});

test('the shared rule trains to recover a teacher rule, and GENERALISES to an unseen graph', () => {
	const gpTrain = graphPopulation(6, ringEdges(6));
	const teacher = gpTrain.randomParams(mb(10), 0.7);
	const rng = mb(11);
	const episodes = Array.from({ length: 6 }, () => { const z0 = z0For(6, rng); return { z0, target: gpTrain.settle(teacher, z0).z }; });
	const r = trainGraph(gpTrain, episodes, { steps: 1500, lr: 0.05, theta0: gpTrain.randomParams(mb(12), 0.7) });
	assert.ok(r.loss < 0.1 * r.loss0 && r.loss < 1e-3, `the shared rule recovers the teacher (${r.loss0.toExponential(1)} → ${r.loss.toExponential(1)})`);

	// generalisation: apply the LEARNED rule to a DIFFERENT graph (8-node ring) — match the teacher there too
	const gpNew = graphPopulation(8, ringEdges(8)), z0 = z0For(8, mb(13));
	const learned = gpNew.settle(r.theta, z0).z, truth = gpNew.settle(teacher, z0).z;
	let gErr = 0; for ( let i = 0; i < 8; i++ ) gErr = Math.max(gErr, Math.abs(learned[i] - truth[i]));
	assert.ok(gErr < 1e-2, `the shared rule transfers to an unseen graph (max node err ${gErr})`);
});
