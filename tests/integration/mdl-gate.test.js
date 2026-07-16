'use strict';
/**
 * #12 — the MDL pre-filter composed with the empirical authority (`abstraction.evaluate`),
 * on the real engine.
 *   1. composeGates SHORT-CIRCUITS on an MDL reject — the expensive authority never boots.
 *   2. composeGates DEFERS to the authority when MDL admits (the authority's verdict rides through).
 *   3. The documented DIVERGENCE: at tiny N the empirical gate admits (real model-calls saved)
 *      while static MDL is conservative (the +1-symbol tax dominates). This is exactly why MDL
 *      is a RANK-ONLY pre-filter by default and the boot-skipping prefilter is OPT-IN — at tiny
 *      scale it would wrongly prune a real win; at library scale it saves many useless boots.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};
const { makeMdlGate, composeGates } = require('../../lib/authoring/core/mdl.js');
const { crystallize } = require('../../lib/authoring/learning/crystallize.js');

// the N=16 / R=30 corpus (count=8 admits, count=1 rejects — as in the unit test).
function corpus( N, R ) {
	const child = {};
	for ( let i = 0; i < N; i++ ) child['C' + i] = { _id: 'C' + i, _name: 'C' + i, require: ['f' + i], provider: ['P::p' + i] };
	return {
		tree: { childConcepts: child },
		alphabet: { knownFacts: Array.from({ length: N + 8 }, (_, i) => 'f' + i), palette: ['P::p'] },
		records: Array.from({ length: R }, (_, i) => ({ concept: 'C' + (i % N), target: 't' + i })),
	};
}
const SMALL = { _id: 'M', _name: 'M', require: ['f0'], provider: ['P::m'] };

test('#12 composeGates short-circuits on an MDL reject — the authority never boots', async () => {
	const ctx = corpus(16, 30);
	const mdlGate = makeMdlGate(ctx);
	let authorityCalls = 0;
	const authority = async () => { authorityCalls++; return { admit: true, eval: { booted: true } }; };

	const r = await composeGates(mdlGate, authority)(null, { op: 'add', schema: SMALL, chain: { from: 'C0', to: 'C1', via: 'f1', count: 1 } });
	assert.equal(r.admit, false, 'MDL rejects a count=1 chain');
	assert.match(r.reason, /mdl-reject/);
	assert.equal(authorityCalls, 0, 'the expensive authority was short-circuited (never booted)');
});

test('#12 composeGates defers to the authority when MDL admits', async () => {
	const ctx = corpus(16, 30);
	const mdlGate = makeMdlGate(ctx);
	let authorityCalls = 0;
	const authority = async () => { authorityCalls++; return { admit: true, eval: { booted: true } }; };

	const r = await composeGates(mdlGate, authority)(null, { op: 'add', schema: SMALL, chain: { from: 'C0', to: 'C1', via: 'f1', count: 8 } });
	assert.equal(authorityCalls, 1, 'MDL admitted → the authority ran');
	assert.equal(r.admit, true, 'final verdict = the authority');
	assert.ok(r.eval && r.eval.booted, 'the authority verdict rides through');
});

test('#12 abstain: a proposal with no mined chain passes MDL through to the authority', async () => {
	const ctx = corpus(16, 30);
	let authorityCalls = 0;
	const authority = async () => { authorityCalls++; return { admit: false, eval: { booted: true } }; };
	const r = await composeGates(makeMdlGate(ctx), authority)(null, { op: 'add', schema: SMALL });   // no `chain`
	assert.equal(authorityCalls, 1, 'MDL abstains without corpus stats → defers');
	assert.equal(r.admit, false, 'the authority decides');
});

test('#12 documented divergence: at tiny N the empirical gate admits while MDL is conservative', async () => {
	const Comp = {
		normalize: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Normalize: true, normalized: s._.raw * 1.5 }),
		amplify: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Amplify: true, amplified: s._.normalized * 2 }),
	};
	const chainTree = { childConcepts: {
		Normalize: { _id: 'Normalize', _name: 'Normalize', require: ['raw'], provider: ['Comp::normalize'] },
		Amplify: { _id: 'Amplify', _name: 'Amplify', require: ['Normalize'], provider: ['Comp::amplify'] },
	} };
	const SEED = { lastRev: 0, nodes: [{ _id: 'D1', raw: 100 }, { _id: 'D2', raw: 200 }, { _id: 'D3', raw: 300 }], segments: [] };

	// default (rank-only): the authority admits — 3 real model-calls saved — even though MDL,
	// attached for inspection, is conservative at N=2 (they disagree).
	const res = await crystallize({ episodeTree: chainTree, seed: SEED, providers: { Comp }, equivKeys: ['normalized', 'amplified'] });
	assert.equal(res.admitted, true, 'empirical authority admits (gain 3)');
	assert.equal(res.mdl.admit, false, 'static MDL is conservative at tiny N — the documented divergence');

	// opt-in prefilter: MDL cuts the boot and (here, at tiny N) skips the empirical win — which is
	// why it is OFF by default and earns its keep only once the library/corpus grows.
	const pre = await crystallize({ episodeTree: chainTree, seed: SEED, providers: { Comp }, equivKeys: ['normalized', 'amplified'], mdlPrefilter: true });
	assert.equal(pre.admitted, false, 'prefilter ON skips the boot on an MDL reject');
	assert.match(pre.reason, /mdl-prefilter/);
});
