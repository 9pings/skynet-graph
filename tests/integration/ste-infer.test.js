'use strict';
/**
 * STE on the engine (experiment E5): weights learned SOFT offline are baked into a concept that
 * does HARD forward inference inside stabilization. The engine classifies all four XOR inputs —
 * the straight-through estimator end to end (train continuous, cast discrete).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { trainNet, createNet, netConceptTree } = require('../../lib/authoring/ste');

console.log = console.info = console.warn = () => {};

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('a soft-trained XOR net, baked into a concept, classifies all 4 inputs HARD in the engine', async () => {
	const X = [[0, 0], [0, 1], [1, 0], [1, 1]], XOR = [[0], [1], [1], [0]];
	const fit = trainNet(X, XOR, { layers: [2, 3, 1], restarts: 8, epochs: 3000, lr: 0.5, rng: mulberry32(42) });

	// bake the learned weights into the Net::infer provider (hard inference)
	Graph._providers = Object.assign({}, Graph._providers, createNet(fit.net, { inputKeys: ['x0', 'x1'] }));
	const tree = { common: netConceptTree({ require: 'input', inputKeys: ['x0', 'x1'] }) };

	const seed = { lastRev: 0, nodes: X.map((x, i) => ({ _id: 'i' + i, input: true, x0: x[0], x1: x[1] })), segments: [] };
	const g = new Graph(seed, { label: 'ste', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
	await nextStable(g);

	const preds = X.map((x, i) => g._objById['i' + i]._etty._.pred);
	assert.deepEqual(preds, [0, 1, 1, 0], 'the engine HARD-classifies XOR 4/4 from soft-trained weights');
});
