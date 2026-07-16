'use strict';
/**
 * cyclic-on-engine (study 2026-06-26): a CYCLIC learned population served on the REAL engine by
 * UNROLLING it to depth N (an acyclic DAG) and baking that. Verify-before-build finding: a directly
 * baked cycle DEADLOCKS — the `require` graph is a producer cycle with no entry point — which is WHY
 * we unroll (the engine also won't natively iterate a value-feedback loop, #22/#15). The unrolled
 * cascade reaches a terminal state and reproduces the depth-N fixpoint approximation exactly.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { ringPopulation, unrollPopulation, bakePopulation } = require('../../experiments/probabilistic-concepts/concept-net.js');

console.log = console.info = console.warn = () => {};
function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function engineReadout( conceptTree, seedFacts, outFact ) {
	const seed = { lastRev: 0, nodes: [Object.assign({ _id: 'S', input: true }, seedFacts)], segments: [] };
	const g = new Graph(seed, { label: 'cyc', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: conceptTree });
	await nextStable(g);
	return g._objById['S']._etty._[outFact];
}

test('a CYCLIC population is served on the REAL engine via depth-N unrolling (acyclic, hard)', async () => {
	const ring = ringPopulation(3), N = 6, X = [-0.5, 0.2, 0.8];
	// a frozen weight set whose hard unrolled readout is non-degenerate across inputs
	let theta = null, spread = 0;
	for ( let s = 1; s <= 600 && spread < 0.05; s++ ) {
		const th = ring.randomParams(mb(s), 1.5), u = unrollPopulation(ring, N);
		const m = X.map((x) => u.pop.settle(u.tieTheta(th), x, { hard: true }).z[u.pop.outC]);
		spread = Math.max(...m) - Math.min(...m);
		if ( spread >= 0.05 ) theta = th;
	}
	assert.ok(theta, 'found a non-degenerate frozen population');

	const u = unrollPopulation(ring, N);
	const { conceptTree, providers } = bakePopulation(u.pop, u.tieTheta(theta));
	Graph._providers = Object.assign({}, Graph._providers, providers);

	for ( const x of X ) {
		const mirror = u.pop.settle(u.tieTheta(theta), x, { hard: true }).z[u.pop.outC];
		const eng = await engineReadout(conceptTree, { f0: x, f1: 0 }, 'f' + u.readout);
		assert.ok(Math.abs(eng - mirror) < 1e-9, `x=${x}: engine ${eng} vs unrolled mirror ${mirror}`);
	}
});

test('a DIRECT cyclic bake DEADLOCKS (producer-cycle require graph) — the reason we unroll', async () => {
	const ring = ringPopulation(3);
	const { conceptTree, providers } = bakePopulation(ring, ring.randomParams(mb(7), 1.0));  // bake the CYCLE itself
	Graph._providers = Object.assign({}, Graph._providers, providers);
	const out = await engineReadout(conceptTree, { f0: 0.5 }, 'f' + ring.out);
	assert.equal(out, undefined, 'no unit casts: U1←U3←U2←U1 is a require cycle with no entry point');
});
