'use strict';
/**
 * provider-plasticity on the engine (study 2026-06-26, pass 4 → NEXT#1). One lifecycle ledger
 * drives a baked STE concept's behaviour through the REAL stabilization loop:
 *   frozen (p=0)  → deterministic predictHard — the memo-perfect, auditable spine
 *   plastic (p=1) → predictNoisy — the concept explores a different cast (same p that would set
 *                   an LLM concept's temperature). Plasticity modulates the cast, never the gate.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { trainNet, createNet, netConceptTree } = require('../../experiments/probabilistic-concepts/ste');
const { createLifecycle } = require('../../lib/authoring/core/lifecycle.js');

console.log = console.info = console.warn = () => {};

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const X = [[0, 0], [0, 1], [1, 0], [1, 1]], AND = [[0], [0], [0], [1]];
const { net } = trainNet(X, AND, { layers: [2, 1], restarts: 8, epochs: 2000, lr: 0.5, rng: mulberry32(1) });

async function runEngine( lc, rng ) {
	Graph._providers = Object.assign({}, Graph._providers,
		createNet(net, { inputKeys: ['x0', 'x1'], plasticity: (n) => lc.plasticity(n), noiseScale: 12, rng: rng }));
	const tree = { common: netConceptTree({ require: 'input', inputKeys: ['x0', 'x1'] }) };
	const seed = { lastRev: 0, nodes: X.map((x, i) => ({ _id: 'i' + i, input: true, x0: x[0], x1: x[1] })), segments: [] };
	const g = new Graph(seed, { label: 'plastic', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
	await nextStable(g);
	return X.map((x, i) => g._objById['i' + i]._etty._.pred);
}

test('a FROZEN concept casts the deterministic AND through stabilization', async () => {
	const lc = createLifecycle();
	lc.register('Net');
	lc.record('Net', true); lc.record('Net', true); lc.record('Net', true);   // p → 0 (frozen)
	assert.equal(lc.plasticity('Net'), 0);
	const preds = await runEngine(lc, mulberry32(1));
	assert.deepEqual(preds, [0, 0, 0, 1], 'frozen = memo-perfect AND, regardless of the rng');
});

test('the SAME ledger, born PLASTIC, explores a different cast on the engine', async () => {
	const baseline = JSON.stringify([0, 0, 0, 1]);
	let explored = null;
	for (let s = 0; s < 50 && explored === null; s++) {
		const lc = createLifecycle();
		lc.register('Net');                                                   // p = 1 (plastic)
		assert.equal(lc.plasticity('Net'), 1);
		const preds = await runEngine(lc, mulberry32(s));
		if (JSON.stringify(preds) !== baseline) explored = preds;
	}
	assert.ok(explored, 'a plastic concept explores a cast different from the frozen AND (same p that drives LLM temperature)');
});
