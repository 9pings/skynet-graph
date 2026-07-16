'use strict';
/**
 * mine — sub-forest mining for crystallization (study 2026-06-26, the #13 loop core).
 * From a corpus of apply-records (the engine trace), detect a frequent producer->consumer
 * concept chain A->B; composeProviders chains their providers into one; the candidate
 * abstract method then goes through the MDL/utility gate (abstraction.evaluate).
 * End-to-end: mine -> propose -> compose -> gate(admit), reproducing F2 on the real engine.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mineChains, composeProviders } = require('../../lib/authoring/learning/mine.js');
const { evaluate } = require('../../lib/authoring/core/abstraction.js');
console.log = console.info = console.warn = () => {};

const Comp = {
	normalize: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Normalize: true, normalized: s._.raw * 1.5 }),
	amplify: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Amplify: true, amplified: s._.normalized * 2 }),
};
const A = { _id: 'Normalize', _name: 'Normalize', require: ['raw'], provider: ['Comp::normalize'] };
const B = { _id: 'Amplify', _name: 'Amplify', require: ['Normalize'], provider: ['Comp::amplify'] };
const chainTree = { childConcepts: { Normalize: A, Amplify: B } };
const SEED = { lastRev: 0, nodes: [{ _id: 'D1', raw: 100 }, { _id: 'D2', raw: 200 }, { _id: 'D3', raw: 300 }], segments: [] };

test('mineChains finds the frequent producer->consumer pair', () => {
	const records = [];
	for (const id of ['D1', 'D2', 'D3']) { records.push({ concept: 'Normalize', target: id }); records.push({ concept: 'Amplify', target: id }); }
	const chains = mineChains(records, chainTree);
	assert.ok(chains.length >= 1);
	assert.deepEqual(chains[0], { from: 'Normalize', to: 'Amplify', via: 'Normalize', count: 3 });
});

test('composeProviders threads one provider output into the next', async () => {
	const composed = composeProviders(Comp.normalize, Comp.amplify);
	const tpl = await new Promise((res) => composed(null, null, { _: { raw: 100 } }, null, (e, t) => res(t)));
	assert.equal(tpl.normalized, 150);
	assert.equal(tpl.amplified, 300);
	assert.equal(tpl.Normalize, true);
	assert.equal(tpl.Amplify, true);
});

test('end-to-end: mine -> propose -> compose -> gate admits the abstraction', async () => {
	const records = [];
	for (const id of ['D1', 'D2', 'D3']) { records.push({ concept: 'Normalize', target: id }); records.push({ concept: 'Amplify', target: id }); }
	const top = mineChains(records, chainTree)[0];
	assert.equal(top.from, 'Normalize');

	const composed = composeProviders(Comp.normalize, Comp.amplify);
	const providers = { Comp, Mined: { directAmplify: composed } };
	const M = { _id: 'MinedM', _name: 'MinedM', require: ['raw'], provider: ['Mined::directAmplify'] };

	const res = await evaluate({
		seed: SEED, providers, chainTree,
		abstractTree: { childConcepts: { MinedM: M } },
		equivKeys: ['normalized', 'amplified'],
	});
	assert.equal(res.equivalent, true);
	assert.equal(res.gain, 3);
	assert.equal(res.admit, true);
});
