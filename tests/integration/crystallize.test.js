'use strict';
/**
 * crystallize (study 2026-06-26, pass 3): the live crystallization loop end-to-end —
 * run an episode with a trace miner, mine the dominant producer->consumer chain, compose
 * the constituents' providers into one, gate the candidate by MDL/utility (equivalent +
 * cheaper), and (adopt) install it on a target graph under a memo-stability guard.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { crystallize, adopt, consolidate } = require('../../plugins/learning/lib/crystallize.js');
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
const fact = (g, id, k) => { const o = g._objById[id]; return o && o._etty ? o._etty._[k] : undefined; };

test('crystallize mines, composes, gates and admits the abstraction from a live episode', async () => {
	const res = await crystallize({ episodeTree: chainTree, seed: SEED, providers: { Comp }, equivKeys: ['normalized', 'amplified'] });
	assert.equal(res.admitted, true);
	assert.deepEqual(res.chain, { from: 'Normalize', to: 'Amplify', via: 'Normalize', count: 3 });
	assert.deepEqual(res.candidate.schema.require, ['raw']);   // the FROM concept's preconditions
	assert.equal(res.verdict.gain, 3);                          // 6 -> 3 applies
	assert.equal(res.verdict.equivalent, true);
});

test('adopt installs the crystallized concept on a fresh graph under a memo-stability guard', async () => {
	const res = await crystallize({ episodeTree: chainTree, seed: SEED, providers: { Comp }, equivKeys: ['normalized', 'amplified'] });
	Graph._providers = {};
	const g = new Graph(JSON.parse(JSON.stringify(SEED)), { label: 'adopt', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: { childConcepts: {} } });
	await nextStable(g);
	const diff = await adopt(g, res.candidate);
	assert.equal(diff.stable, true);                            // empty graph -> nothing to perturb
	assert.ok(g.getConceptByName(res.candidate.schema._id), 'the crystallized concept is installed');
	assert.equal(fact(g, 'D1', 'amplified'), 300);             // it reproduces the chain output in one cast
});

test('consolidate adopts the crystal (offline refactor) and freezes it as reliability proves out', async () => {
	const res = await consolidate({ episodeTree: chainTree, seed: SEED, providers: { Comp }, equivKeys: ['normalized', 'amplified'], rounds: 3 });
	assert.equal(res.applies.chain, 6);
	assert.equal(res.applies.adopted, 3);          // the refactor win materialized (chain removed, crystal in)
	assert.equal(res.regime, 'frozen');            // proven over the rounds -> consolidated
	assert.equal(res.plasticity, 0);
	assert.equal(res.consolidated, true);
});

test('crystallize returns no candidate when no frequent chain is observed', async () => {
	const Lonely = { lone: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Lone: true, normalized: s._.raw * 1.5 }) };
	const single = { childConcepts: { Lone: { _id: 'Lone', _name: 'Lone', require: ['raw'], provider: ['Lonely::lone'] } } };
	const res = await crystallize({ episodeTree: single, seed: SEED, providers: { Lonely }, equivKeys: ['normalized'] });
	assert.equal(res.admitted, false);
	assert.equal(res.candidate, null);
});
