'use strict';
/**
 * concept-net evolve — the population FORM evolves by success (study 2026-06-26; the user's
 * "leur forme peut demander à évoluer" + favor-by-success). Grow the structure one unit at a time,
 * keeping a larger form only while the added unit earns its keep (a utility/MDL margin, the
 * continuous cousin of abstraction.js). Demonstrated on a WIDE population (a chain collapses under
 * [0,1]-squashing — finding #24 — so depth is not expressivity there; width is). CPU, ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { widePopulation, evolve } = require('../../experiments/probabilistic-concepts/concept-net.js');

function mb( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('evolve grows the FORM until it fits, then a utility gate stops it (favor-by-success)', () => {
	const D = 20, X = Array.from({ length: D }, (_, i) => -1 + 2 * i / (D - 1));
	const teacher = widePopulation(4);
	const T = X.map((x) => teacher.settle(teacher.randomParams(mb(904), 2.0), x).z[teacher.outC]);
	const r = evolve({ makePop: (K) => widePopulation(K), X, T, maxK: 8, margin: 1e-3, steps: 2000, lr: 0.04, initScale: 1.5, rngFor: (K) => mb(700 + K) });

	assert.ok(r.history[0].loss > 1e-2, `K=1 underfits the task (${r.history[0].loss.toExponential(1)})`);
	assert.ok(r.loss < 1e-3, `the evolved form fits the task (${r.loss.toExponential(1)})`);
	assert.ok(r.K > 1, 'the form grew (a unit that improved loss past the margin was kept)');
	assert.ok(r.K < 8, 'growth STOPPED before maxK — the utility gate rejected a unit that did not pay for itself');
});

test('evolve is parsimonious: an already-sufficient form does not grow', () => {
	// a trivial target a single unit fits → no growth justified
	const X = [-1, -0.4, 0.2, 0.8];
	const teacher = widePopulation(1);
	const T = X.map((x) => teacher.settle(teacher.randomParams(mb(3), 1.0), x).z[teacher.outC]);
	const r = evolve({ makePop: (K) => widePopulation(K), X, T, maxK: 5, margin: 1e-3, steps: 1500, lr: 0.05, rngFor: (K) => mb(40 + K) });
	assert.equal(r.K, 1, 'a sufficient single-unit form stays at K=1 (Occam)');
});
