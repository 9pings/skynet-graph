'use strict';
/**
 * abstraction (the MDL/utility admission gate) — study 2026-06-26, promotes experiment F2.
 * An abstract method (a composed concept) is ADMITTED iff: it validates, it is fixpoint-
 * EQUIVALENT to the chain it replaces (same external facts), and it REDUCES total applies
 * (the utility/MDL gain > 0). Adding the macro *alongside* its constituents (no refactor)
 * is a net tax (Minton 1990) -> rejected. A non-equivalent macro -> rejected.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, makeAbstractionGate } = require('../../lib/authoring/abstraction.js');
console.log = console.info = console.warn = () => {};

const SEED = { lastRev: 0, nodes: [{ _id: 'D1', raw: 100 }, { _id: 'D2', raw: 200 }, { _id: 'D3', raw: 300 }], segments: [] };
const providers = {
	Comp: {
		normalize: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Normalize: true, normalized: s._.raw * 1.5 }),
		amplify: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Amplify: true, amplified: s._.normalized * 2 }),
		directAmplify: (g, c, s, a, cb) => { const n = s._.raw * 1.5; cb(null, { $_id: '_parent', DirectAmplify: true, normalized: n, amplified: n * 2 }); },
		directAmplify2: (g, c, s, a, cb) => cb(null, { $_id: '_parent', DirectAmplify2: true, amplified2: s._.raw * 1.5 * 2 }),
		directBad: (g, c, s, a, cb) => { const n = s._.raw * 1.5; cb(null, { $_id: '_parent', DirectBad: true, normalized: n, amplified: s._.raw * 2 }); },
	},
};
const A = { _id: 'Normalize', _name: 'Normalize', require: ['raw'], provider: ['Comp::normalize'] };
const B = { _id: 'Amplify', _name: 'Amplify', require: ['Normalize'], provider: ['Comp::amplify'] };
const chainTree = { childConcepts: { Normalize: A, Amplify: B } };

test('admits an abstract method that is equivalent AND reduces applies (refactor win)', async () => {
	const res = await evaluate({
		seed: SEED, providers, chainTree,
		abstractTree: { childConcepts: { DirectAmplify: { _id: 'DirectAmplify', _name: 'DirectAmplify', require: ['raw'], provider: ['Comp::directAmplify'] } } },
		equivKeys: ['normalized', 'amplified'],
	});
	assert.equal(res.valid, true);
	assert.equal(res.equivalent, true);
	assert.equal(res.chainApplies, 6);
	assert.equal(res.abstractApplies, 3);
	assert.equal(res.gain, 3);
	assert.equal(res.admit, true);
});

test('rejects keeping the macro alongside its constituents (the utility tax, Minton 1990)', async () => {
	const res = await evaluate({
		seed: SEED, providers, chainTree,
		abstractTree: { childConcepts: { Normalize: A, Amplify: B, DirectAmplify2: { _id: 'DirectAmplify2', _name: 'DirectAmplify2', require: ['raw'], provider: ['Comp::directAmplify2'] } } },
		equivKeys: ['amplified'],
	});
	assert.equal(res.abstractApplies, 9);
	assert.ok(res.gain < 0, 'keeping the macro is a net tax');
	assert.equal(res.admit, false);
});

test('makeAbstractionGate yields a CEGIS gate: admits the refactor M, rejects a non-equivalent M', async () => {
	const gate = makeAbstractionGate({ seed: SEED, providers, chainTree, equivKeys: ['normalized', 'amplified'] });
	const good = await gate(null, { op: 'add', schema: { _id: 'DirectAmplify', _name: 'DirectAmplify', require: ['raw'], provider: ['Comp::directAmplify'] } });
	assert.equal(good.admit, true);
	const bad = await gate(null, { op: 'add', schema: { _id: 'DirectBad', _name: 'DirectBad', require: ['raw'], provider: ['Comp::directBad'] } });
	assert.equal(bad.admit, false);
});

test('rejects a non-equivalent abstract method even if it is cheaper', async () => {
	const res = await evaluate({
		seed: SEED, providers, chainTree,
		abstractTree: { childConcepts: { DirectBad: { _id: 'DirectBad', _name: 'DirectBad', require: ['raw'], provider: ['Comp::directBad'] } } },
		equivKeys: ['amplified'],
	});
	assert.equal(res.equivalent, false);
	assert.equal(res.admit, false);
});
