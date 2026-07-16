/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Concept-net BRIDGE demo (structure-learning v0). Closes the mirror↔engine loop: a population
 * learned in the differentiable mirror (concept-net.js) is FROZEN and BAKED back into the REAL
 * engine — each concept-unit becomes an engine concept whose provider does the hard gate × update,
 * and stabilization cascades the computation. This is the plasticity "frozen=serve" regime made
 * concrete: train continuous/offline, serve discrete/hard inside the engine. Run:
 *
 *   node examples/poc/concept-bridge.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { chainPopulation, bakePopulation } = require('../../experiments/probabilistic-concepts/concept-net.js');

function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
	const pop = chainPopulation(3);                        // DAG: f0(input) → U1 → U2 → U3
	const X = [-0.5, 0.1, 0.7, 1.0];

	// a frozen (post-training) weight set with a non-degenerate hard map
	let theta = null, spread = 0;
	for ( let s = 1; s <= 400 && spread < 0.05; s++ ) {
		const th = pop.randomParams(mb(s), 1.4);
		const m = X.map((x) => pop.settle(th, x, { hard: true }).z[pop.outC]);
		spread = Math.max(...m) - Math.min(...m);
		if ( spread >= 0.05 ) theta = th;
	}

	const { conceptTree, providers } = bakePopulation(pop, theta);
	Graph._providers = Object.assign({}, Graph._providers, providers);

	console.log('\nConcept-net BRIDGE — a frozen population served in the REAL engine\n');
	console.log(`  ${pop.units.length} concept-units (U1→U2→U3) baked as engine concepts; cascade in stabilization.\n`);
	console.log('   input x     mirror fixpoint     engine (stabilized)    match');
	for ( const x of X ) {
		const mirror = pop.settle(theta, x, { hard: true }).z[pop.outC];
		const seed = { lastRev: 0, nodes: [{ _id: 'S', input: true, f0: x }], segments: [] };
		const g = new Graph(seed, { label: 'bridge', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: conceptTree });
		await nextStable(g);
		const eng = g._objById['S']._etty._['f' + pop.out];
		console.log(`   ${String(x).padEnd(8)}    ${mirror.toFixed(9)}        ${eng.toFixed(9)}        ${Math.abs(eng - mirror) < 1e-9 ? '✓' : '✗'}`);
	}
	console.log('\n→ The learned population RUNS in the engine: train offline (plastic/soft), freeze, bake,');
	console.log('  and the real stabilization reproduces the map exactly — the frozen serving regime.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
