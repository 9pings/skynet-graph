'use strict';
/**
 * STE training (experiments/probabilistic-concepts/ste.js, experiment E5). Train SOFT offline (sigmoid SGD), infer
 * HARD (step). The thesis: the TOPOLOGY gates learnability — a hidden layer turns XOR (impossible
 * for one log-linear unit) into the learnable. Deterministic via a seeded RNG.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trainNet, predictHard } = require('../../experiments/probabilistic-concepts/ste');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const X = [[0, 0], [0, 1], [1, 0], [1, 1]];
const XOR = [[0], [1], [1], [0]];
const AND = [[0], [0], [0], [1]];
const hardAcc = (net, Y) => X.reduce((c, x, i) => c + (predictHard(net, x)[0] === Y[i][0] ? 1 : 0), 0);
const fit = (Y, layers) => trainNet(X, Y, { layers, restarts: 8, epochs: 3000, lr: 0.5, rng: mulberry32(42) });

test('a 2-layer concept-net learns XOR soft, and HARD inference is 4/4 (STE works)', () => {
	const r = fit(XOR, [2, 3, 1]);
	assert.ok(r.loss < 0.01, `soft loss low (${r.loss.toFixed(4)})`);
	assert.equal(hardAcc(r.net, XOR), 4, 'straight-through hard inference classifies all 4');
});

test('a single log-linear unit CANNOT learn XOR — topology gates learnability', () => {
	const r = fit(XOR, [2, 1]);
	assert.ok(r.loss > 0.2, `1-unit XOR loss stuck at the linear-separator limit (${r.loss.toFixed(4)})`);
	assert.ok(hardAcc(r.net, XOR) < 4, 'cannot classify all 4 (XOR is not linearly separable)');
});

test('the SAME single unit DOES learn AND (linearly separable) — 4/4', () => {
	const r = fit(AND, [2, 1]);
	assert.ok(r.loss < 0.01, `1-unit AND learns (${r.loss.toFixed(4)})`);
	assert.equal(hardAcc(r.net, AND), 4);
});

test('predictHard snaps each layer (round of the soft prediction on a separated net)', () => {
	const r = fit(XOR, [2, 3, 1]);
	for (const x of X) {
		const soft = require('../../experiments/probabilistic-concepts/ste').forward(r.net, x).pop()[0];
		assert.equal(predictHard(r.net, x)[0], soft >= 0.5 ? 1 : 0, 'hard == round(soft)');
	}
});
