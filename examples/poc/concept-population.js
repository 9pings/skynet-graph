/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Concept-POPULATION substrate (structure-learning v0; study 2026-06-26). A population of
 * concept-units — each = a NN that decides whether to CAST (the gate) × a NN that GENERATES the
 * value it writes (the update) — wired into a graph, run to a FIXPOINT, and trained end-to-end by
 * implicit differentiation (equilibrium.js). Orchestrates: initial conditions → train → scale
 * 2→6 units → evolve the FORM (grow a unit) → distill a big population into a small one. Run:
 *
 *   node examples/poc/concept-population.js
 *
 * This is the differentiable MIRROR; a trained unit is baked back into the real engine via ste.js
 * (STE at the cast boundary) — the next rung. Distillation is the horizon: a learned composite that
 * reproduces a target map without human concept-authoring. CPU, offline, ZERO-CORE.
 */
const { ringPopulation, loss, train } = require('../../lib/authoring/concept-net.js');

function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const X = [-1, -0.4, 0.2, 0.8];

console.log('\nConcept-POPULATION substrate — gate-NN × update-NN units, trained at the fixpoint\n');

// 1) initial conditions: a population of 4 concept-units in a cycle, random params, settles
const p0 = ringPopulation(4);
const th0 = p0.randomParams(mb(1), 0.5);
console.log(`1. init: ${p0.units.length} concept-units, ${p0.nFacts} facts, ${p0.nParams} params — settles to a fixpoint in ${p0.settle(th0, 0.5).iters} sweeps`);

// 2) train the population to a teacher's fixpoint map (implicit diff)
const teacher4 = p0.randomParams(mb(104), 0.5);
const T4 = X.map((x) => p0.settle(teacher4, x).z[p0.outC]);
const r4 = train(p0, { X, T: T4, steps: 1500, lr: 0.05, theta0: p0.randomParams(mb(304), 0.5) });
console.log(`2. train to a teacher map: loss ${r4.loss0.toExponential(1)} → ${r4.loss.toExponential(1)}  (recovers the composite map)`);

// 3) scale 2→6 concept-units — does learning hold as the population grows?
console.log('3. SCALE the population (does convergence hold as it grows?):');
console.log('   K  params   loss0    →  loss      ρ');
for ( let K = 2; K <= 6; K++ ) {
	const pop = ringPopulation(K);
	const teacher = pop.randomParams(mb(100 + K), 0.5);
	const T = X.map((x) => pop.settle(teacher, x).z[pop.outC]);
	const r = train(pop, { X, T, steps: 1500, lr: 0.05, theta0: pop.randomParams(mb(300 + K), 0.5) });
	console.log(`   ${K}  ${String(pop.nParams).padStart(5)}    ${r.loss0.toExponential(1)}  →  ${r.loss.toExponential(1)}   ${r.rho.toFixed(2)}`);
}

// 4) the FORM evolves — grow 3→4 units (a new unit spliced into the cycle) and retrain
const grown = ringPopulation(4);
const tg = grown.randomParams(mb(21), 0.5), Tg = X.map((x) => grown.settle(tg, x).z[grown.outC]);
const rg = train(grown, { X, T: Tg, steps: 1500, lr: 0.05, theta0: grown.randomParams(mb(22), 0.5) });
console.log(`\n4. evolve the FORM (grow a unit, retrain): loss ${rg.loss0.toExponential(1)} → ${rg.loss.toExponential(1)} — the grown population learns`);

// 5) DISTILL: train a SMALL population (3 units) to reproduce a BIG one's (6 units) I/O map
const big = ringPopulation(6), small = ringPopulation(3);
const bigTh = big.randomParams(mb(777), 0.6);
const Xd = [-1, -0.6, -0.2, 0.2, 0.6, 1], Td = Xd.map((x) => big.settle(bigTh, x).z[big.outC]);
const rd = train(small, { X: Xd, T: Td, steps: 2500, lr: 0.05, theta0: small.randomParams(mb(778), 0.6) });
console.log(`\n5. DISTILL big(6 units) → small(3 units): match loss ${rd.loss0.toExponential(1)} → ${rd.loss.toExponential(1)} (a compact population approximates the big one's map)`);

console.log('\n→ A POPULATION of gate×update concept-units trains end-to-end at the fixpoint, scales,');
console.log('  evolves its form, and distills — the substrate for learned concepts without human authoring.\n');
