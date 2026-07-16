/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Provider-plasticity demo (structure-learning v0, NEXT#1). The unified plasticity knob
 * p∈[0,1] from ONE lifecycle ledger modulates two very different providers with the SAME value:
 *   - an LLM::complete concept    → call temperature
 *   - a baked STE mini-NN concept → exploration noise
 * Consolidation (CLS) anneals p: a concept born plastic (creative/learning) freezes toward 0
 * (deterministic, memo-perfect spine) as its reliability proves out. Run:
 *
 *   node examples/poc/plasticity.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createLLMProvider } = require('../../lib/providers/llm.js');
const { trainNet, createNet, netConceptTree } = require('../../experiments/probabilistic-concepts/ste.js');
const { createLifecycle } = require('../../lib/authoring/core/lifecycle.js');

function mulberry32( a ) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
	// ── one ledger, two concepts ────────────────────────────────────────────────
	const lc = createLifecycle();
	lc.register('Classify');   // an LLM-calling concept
	lc.register('AndNet');     // a baked STE mini-NN concept

	// LLM provider: a stub `ask` that just reports the temperature it was called with.
	let lastTemp;
	const llm = createLLMProvider({ ask: async ({ temperature }) => { lastTemp = temperature; return 'ok'; }, plasticity: (n) => lc.plasticity(n) });
	const askClassify = () => new Promise((res) => llm.LLM.complete(
		{ getRef: () => undefined, traceProvider: () => {} },
		{ _name: 'Classify', _schema: { prompt: { system: 's', user: 'u' } } }, { _: {} }, null, () => res(lastTemp)));

	// STE net provider: an AND net, wired to the same ledger (noise = noiseScale·p).
	const X = [[0, 0], [0, 1], [1, 0], [1, 1]], AND = [[0], [0], [0], [1]];
	const { net } = trainNet(X, AND, { layers: [2, 1], restarts: 8, epochs: 2000, lr: 0.5, rng: mulberry32(1) });
	async function runNet( rng ) {
		Graph._providers = Object.assign({}, Graph._providers,
			createNet(net, { inputKeys: ['x0', 'x1'], plasticity: (n) => lc.plasticity('AndNet'), noiseScale: 12, rng }));
		const tree = { common: netConceptTree({ require: 'input', inputKeys: ['x0', 'x1'] }) };
		const seed = { lastRev: 0, nodes: X.map((x, i) => ({ _id: 'i' + i, input: true, x0: x[0], x1: x[1] })), segments: [] };
		const g = new Graph(seed, { label: 'plastic', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
		await nextStable(g);
		return X.map((x, i) => g._objById['i' + i]._etty._.pred);
	}

	const show = async ( phase ) => {
		const temp = await askClassify();
		const preds = await runNet(mulberry32(7));
		const exact = JSON.stringify(preds) === JSON.stringify([0, 0, 0, 1]);
		console.log(
			`  ${phase.padEnd(22)}  p=${lc.plasticity('Classify').toFixed(2)}/${lc.plasticity('AndNet').toFixed(2)}` +
			`  regime=${lc.regime('AndNet').padEnd(13)}` +
			`  LLM.temp=${temp}  AND→[${preds.join(',')}] ${exact ? '(deterministic)' : '(explored!)'}`);
	};

	console.log('\nProvider-plasticity — one knob p∈[0,1], two providers (LLM temperature + NN noise)\n');
	console.log('  phase                   p(Classify/AndNet)  regime         provider modulation');
	await show('born plastic');
	lc.record('Classify', true); lc.record('AndNet', true);
	await show('1 success');
	lc.record('Classify', true); lc.record('AndNet', true);
	await show('2 successes');
	lc.record('Classify', true); lc.record('AndNet', true);
	await show('3 successes → frozen');

	console.log('\n  → as reliability proves out, the SAME p anneals to 0: the LLM call goes to temperature 0');
	console.log('    and the NN stops exploring — the concept joins the deterministic, memo-perfect spine.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
