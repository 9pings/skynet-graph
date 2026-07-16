'use strict';
/**
 * concept-net BRIDGE (study 2026-06-26): a population TRAINED in the differentiable mirror
 * (concept-net.js / equilibrium.js) is BAKED back into the REAL engine — each unit becomes an
 * engine concept whose provider does the hard gate × update, wired so stabilization cascades the
 * computation. This closes the mirror↔engine loop: train continuous/offline, serve discrete/hard
 * (the plasticity knob's frozen regime). First bridge is ACYCLIC (a chain/DAG) so the engine
 * cascades in topological order — no value-change re-derivation (#22) or re-cast loop (#15) yet.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { chainPopulation, bakePopulation } = require('../../experiments/probabilistic-concepts/concept-net.js');

console.log = console.info = console.warn = () => {};
function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function engineOut( conceptTree, x, outFact ) {
	const seed = { lastRev: 0, nodes: [{ _id: 'S', input: true, f0: x }], segments: [] };
	const g = new Graph(seed, { label: 'bridge', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: conceptTree });
	await nextStable(g);
	return g._objById['S']._etty._[outFact];
}

test('a FROZEN acyclic population reproduces its hard fixpoint in the REAL engine (baked)', async () => {
	const pop = chainPopulation(3);                                  // DAG: f0(input) → U1 → U2 → U3
	const X = [-0.5, 0.1, 0.7, 1.0];
	// pick a frozen weight set whose HARD map is NON-degenerate across inputs (so the test exercises
	// the gating arithmetic, not a collapsed all-zero map). Weights freeze after training (serve regime).
	let theta = null, spread = 0;
	for ( let s = 1; s <= 400 && spread < 0.05; s++ ) {
		const th = pop.randomParams(mb(s), 1.4);
		const m = X.map((x) => pop.settle(th, x, { hard: true }).z[pop.outC]);
		spread = Math.max(...m) - Math.min(...m);
		if ( spread >= 0.05 ) theta = th;
	}
	assert.ok(theta, 'found a non-degenerate frozen population');

	const { conceptTree, providers } = bakePopulation(pop, theta);
	Graph._providers = Object.assign({}, Graph._providers, providers);

	for ( const x of X ) {
		const mirror = pop.settle(theta, x, { hard: true }).z[pop.outC];
		const eng = await engineOut(conceptTree, x, 'f' + pop.out);
		assert.ok(Math.abs(eng - mirror) < 1e-9, `x=${x}: engine ${eng} vs mirror fixpoint ${mirror}`);
	}
});

test('the baked cascade terminates: every unit casts once and the output fact is present', async () => {
	const pop = chainPopulation(4);
	const theta = pop.randomParams(mb(8), 0.6);
	const { conceptTree, providers } = bakePopulation(pop, theta);
	Graph._providers = Object.assign({}, Graph._providers, providers);
	const seed = { lastRev: 0, nodes: [{ _id: 'S', input: true, f0: 0.4 }], segments: [] };
	const g = new Graph(seed, { label: 'bridge2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: conceptTree });
	await nextStable(g);
	const s = g._objById['S']._etty._;
	for ( let i = 1; i <= 4; i++ ) assert.equal(s['U' + i], true, `unit U${i} cast`);
	assert.equal(typeof s['f' + pop.out], 'number', 'the readout fact is produced');
});
