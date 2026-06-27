'use strict';
/**
 * U4 — the abstraction-gate CURRENCY fix (2026-06-27). The utility gate must score MODEL CALLS, not raw
 * `applies` (Minton 1990, the utility problem): a fusion that removes only provider-LESS (free) casts drops
 * the applies count but saves NO model call → it must be REJECTED. The negative control is the whole point.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, interfaceRegression } = require('../../lib/authoring/abstraction.js');
console.log = console.info = console.warn = () => {};

const SEED = { lastRev: 0, nodes: [{ _id: 'D1', raw: 100 }, { _id: 'D2', raw: 200 }, { _id: 'D3', raw: 300 }], segments: [] };
const providers = { Comp: {
	normalize: ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', Normalize: true, normalized: s._.raw * 1.5 }),
	directAmplify: ( g, c, s, a, cb ) => { const n = s._.raw * 1.5; cb(null, { $_id: '_parent', DirectAmplify: true, normalized: n, amplified: n * 2 }); },
	amplify: ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', Amplify: true, amplified: s._.normalized * 2 }),
} };

// a chain whose 2nd+3rd steps are PROVIDER-LESS (pure applyMutations — free casts, no model call).
const Normalize = { _id: 'Normalize', _name: 'Normalize', require: ['raw'], provider: ['Comp::normalize'] };
const Tag1 = { _id: 'Tag1', _name: 'Tag1', require: ['normalized'], applyMutations: [{ $_id: '_parent', Tag1: true, t1: 1 }] };
const Tag2 = { _id: 'Tag2', _name: 'Tag2', require: ['t1'], applyMutations: [{ $_id: '_parent', Tag2: true, t2: 1 }] };
const chainTree = { childConcepts: { Normalize, Tag1, Tag2 } };

test('U4: fusing PROVIDER-LESS casts drops applies but saves 0 model calls → REJECTED (the currency fix)', async () => {
	// the abstraction fuses Tag1+Tag2 into one provider-less cast: fewer applies, SAME model calls.
	const abstractTree = { childConcepts: { Normalize,
		TagBoth: { _id: 'TagBoth', _name: 'TagBoth', require: ['normalized'], applyMutations: [{ $_id: '_parent', TagBoth: true, t1: 1, t2: 1 }] } } };
	const res = await evaluate({ seed: SEED, providers, chainTree, abstractTree, equivKeys: ['normalized', 't1', 't2'] });
	assert.equal(res.equivalent, true, 'same external facts');
	assert.ok(res.gain > 0, 'applies DID drop (the old gate would have admitted this)');
	assert.equal(res.costGain, 0, 'but ZERO model calls saved — both keep exactly one provider cast per node');
	assert.equal(res.admit, false, 'U4: rejected on the correct currency (a free-cast fusion is a no-op Minton tax)');
});

test('U4: fusing PROVIDER casts saves real model calls → ADMITTED (costGain > 0)', async () => {
	// Normalize+Amplify (both providers) fused into DirectAmplify (one provider) — a genuine model-call saving.
	const chain2 = { childConcepts: { Normalize, Amplify: { _id: 'Amplify', _name: 'Amplify', require: ['Normalize'], provider: ['Comp::amplify'] } } };
	const abstractTree = { childConcepts: { DirectAmplify: { _id: 'DirectAmplify', _name: 'DirectAmplify', require: ['raw'], provider: ['Comp::directAmplify'] } } };
	const res = await evaluate({ seed: SEED, providers, chainTree: chain2, abstractTree, equivKeys: ['normalized', 'amplified'] });
	assert.equal(res.equivalent, true);
	assert.equal(res.chainCost, 6, '2 provider casts × 3 nodes');
	assert.equal(res.abstractCost, 3, '1 provider cast × 3 nodes');
	assert.equal(res.costGain, 3, 'three model calls saved');
	assert.equal(res.admit, true);
});

test('interfaceRegression: a fusion within a tile does not widen the separator alphabet (interfaceOk)', async () => {
	const r = interfaceRegression(chainTree, { childConcepts: { Normalize,
		TagBoth: { _id: 'TagBoth', _name: 'TagBoth', require: ['normalized'], applyMutations: [{ $_id: '_parent', TagBoth: true, t1: 1, t2: 1 }] } } });
	assert.deepEqual(r.widened, [], 'no new separator key crosses a cut (E7 non-regression holds)');
});
