'use strict';
/**
 * trace-miner (study 2026-06-26, pass 2): feed mineChains from a REAL onConceptApply
 * corpus, not synthetic records. recordsFromTrace normalizes the engine trace
 * ({conceptName, targetId, …}) into {concept, target}; traceMiner is a collector you plug
 * into cfg.onConceptApply, then .chains(tree) mines the accumulated firings.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { recordsFromTrace, traceMiner } = require('../../lib/authoring/learning/mine.js');
console.log = console.info = console.warn = () => {};

const Comp = {
	normalize: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Normalize: true, normalized: s._.raw * 1.5 }),
	amplify: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Amplify: true, amplified: s._.normalized * 2 }),
};
const chainTree = { childConcepts: {
	Normalize: { _id: 'Normalize', _name: 'Normalize', require: ['raw'], provider: ['Comp::normalize'] },
	Amplify: { _id: 'Amplify', _name: 'Amplify', require: ['Normalize'], provider: ['Comp::amplify'] },
} };
const SEED = { lastRev: 0, nodes: [{ _id: 'D1', raw: 100 }, { _id: 'D2', raw: 200 }, { _id: 'D3', raw: 300 }], segments: [] };

test('recordsFromTrace normalizes onConceptApply records', () => {
	const recs = recordsFromTrace([{ conceptName: 'A', targetId: 'x', kind: 'provider' }, { conceptName: 'B', targetId: 'y' }, { nope: 1 }]);
	assert.deepEqual(recs, [{ concept: 'A', target: 'x' }, { concept: 'B', target: 'y' }]);
});

test('traceMiner mines a producer->consumer chain from a live engine trace', async () => {
	Graph._providers = Object.assign({}, Graph._providers, { Comp });
	const miner = traceMiner();
	const g = new Graph(SEED, { label: 'tm', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error', onConceptApply: miner.onConceptApply }, { common: JSON.parse(JSON.stringify(chainTree)) });
	await nextStable(g);
	const chains = miner.chains(chainTree);
	assert.ok(chains.length >= 1);
	assert.deepEqual(chains[0], { from: 'Normalize', to: 'Amplify', via: 'Normalize', count: 3 });
});
