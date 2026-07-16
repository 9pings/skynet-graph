'use strict';
/**
 * provider-plasticity (study 2026-06-26, pass 4 → NEXT#1): the unified knob p∈[0,1] from the
 * lifecycle ledger MODULATES a real provider. The SAME plasticity drives an LLM concept's
 * temperature and an STE mini-NN concept's exploration noise:
 *   p = 1 (plastic)  → high temperature / large noise (explore, learn, be creative)
 *   p = 0 (frozen)   → temperature 0 / no noise (deterministic, memo-perfect spine)
 * Discipline (K1): plasticity modulates the provider; it never gates applicability.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLLMProvider } = require('../../lib/providers/llm.js');
const { trainNet, predictHard, predictNoisy, createNet } = require('../../experiments/probabilistic-concepts/ste.js');
const { createLifecycle } = require('../../lib/authoring/lifecycle.js');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// run the (async, cb-style) LLM provider as a promise
function runComplete(complete, concept) {
	const graph = { getRef: () => undefined, traceProvider: () => {} };
	const scope = { _: {} };
	return new Promise((res) => complete(graph, concept, scope, null, (e, facts) => res(facts)));
}

test('LLM::complete temperature is driven by the concept plasticity (born plastic → temp 1)', async () => {
	let lastTemp;
	const ask = async ({ temperature }) => { lastTemp = temperature; return 'ok'; };
	const lc = createLifecycle();
	lc.register('Classify');                                  // p = 1
	const prov = createLLMProvider({ ask, plasticity: (n) => lc.plasticity(n) });
	const concept = { _name: 'Classify', _schema: { prompt: { system: 's', user: 'u', maxTokens: 10 } } };

	await runComplete(prov.LLM.complete, concept);
	assert.equal(lastTemp, 1, 'a plastic concept calls the model at full temperature');
});

test('LLM::complete temperature anneals to 0 as the concept freezes', async () => {
	let lastTemp;
	const ask = async ({ temperature }) => { lastTemp = temperature; return 'ok'; };
	const lc = createLifecycle();
	lc.register('Classify');
	lc.record('Classify', true); lc.record('Classify', true); lc.record('Classify', true); // 3/3 → frozen
	const prov = createLLMProvider({ ask, plasticity: (n) => lc.plasticity(n) });
	const concept = { _name: 'Classify', _schema: { prompt: { system: 's', user: 'u', maxTokens: 10 } } };

	await runComplete(prov.LLM.complete, concept);
	assert.equal(lastTemp, 0, 'a frozen concept is deterministic (temperature 0)');
});

test('LLM::complete with no plasticity accessor leaves temperature unset (behaviour unchanged)', async () => {
	let seen = 'sentinel';
	const ask = async (a) => { seen = ('temperature' in a) ? a.temperature : 'absent'; return 'ok'; };
	const prov = createLLMProvider({ ask });                 // no plasticity wired
	const concept = { _name: 'Classify', _schema: { prompt: { system: 's', user: 'u' } } };
	await runComplete(prov.LLM.complete, concept);
	assert.equal(seen, 'absent', 'temperature is omitted when not driven (no API change for existing hosts)');
});

test('predictNoisy with noise 0 equals predictHard (the frozen path is exact)', () => {
	const X = [[0, 0], [0, 1], [1, 0], [1, 1]], AND = [[0], [0], [0], [1]];
	const { net } = trainNet(X, AND, { layers: [2, 1], restarts: 8, epochs: 2000, lr: 0.5, rng: mulberry32(1) });
	for (const x of X)
		assert.deepEqual(predictNoisy(net, x, { noise: 0 }), predictHard(net, x), 'noise 0 ⇒ deterministic');
});

test('predictNoisy with large noise explores (a well-separated unit can flip)', () => {
	const X = [[0, 0], [0, 1], [1, 0], [1, 1]], AND = [[0], [0], [0], [1]];
	const { net } = trainNet(X, AND, { layers: [2, 1], restarts: 8, epochs: 2000, lr: 0.5, rng: mulberry32(1) });
	assert.deepEqual(predictHard(net, [1, 1]), [1], 'frozen: AND(1,1)=1');
	let flips = 0;
	for (let s = 0; s < 200; s++) if (predictNoisy(net, [1, 1], { noise: 12, rng: mulberry32(s) })[0] === 0) flips++;
	assert.ok(flips > 0, 'plastic exploration occasionally flips the cast');
});

test('createNet routes through plasticity: frozen ⇒ predictHard, plastic ⇒ noisy', () => {
	const X = [[0, 0], [0, 1], [1, 0], [1, 1]], AND = [[0], [0], [0], [1]];
	const { net } = trainNet(X, AND, { layers: [2, 1], restarts: 8, epochs: 2000, lr: 0.5, rng: mulberry32(1) });

	// find a seed whose first noisy draw flips AND(1,1) 1→0
	let flipSeed = null;
	for (let s = 0; s < 1000 && flipSeed === null; s++)
		if (predictNoisy(net, [1, 1], { noise: 12, rng: mulberry32(s) })[0] === 0) flipSeed = s;
	assert.ok(flipSeed !== null, 'a flipping seed exists');

	const concept = { _name: 'Net', _schema: { net: { inputKeys: ['x0', 'x1'], as: '' } } };
	const scope = { _: { x0: 1, x1: 1 } };
	const call = (prov) => new Promise((res) => prov.Net.infer({}, concept, scope, null, (e, f) => res(f.pred)));

	const lcF = createLifecycle(); lcF.register('Net');
	lcF.record('Net', true); lcF.record('Net', true); lcF.record('Net', true);       // frozen p=0
	const provF = createNet(net, { inputKeys: ['x0', 'x1'], plasticity: (n) => lcF.plasticity(n), noiseScale: 12, rng: mulberry32(flipSeed) });

	const lcP = createLifecycle(); lcP.register('Net');                               // plastic p=1
	const provP = createNet(net, { inputKeys: ['x0', 'x1'], plasticity: (n) => lcP.plasticity(n), noiseScale: 12, rng: mulberry32(flipSeed) });

	return Promise.all([call(provF), call(provP)]).then(([frozen, plastic]) => {
		assert.equal(frozen, 1, 'frozen concept casts the deterministic AND(1,1)=1');
		assert.equal(plastic, 0, 'plastic concept explores (the flipping seed) — same p, opposite regime');
	});
});
