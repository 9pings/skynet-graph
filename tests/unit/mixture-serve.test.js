'use strict';
/**
 * C8 mixture-serve (mixture-runtime) — the cheap oriented tier + cross-agreement trust-gate + escalation, promoted
 * from the 2026-07-09 kill-gates (WIP/experiments/2026-07-09-mixture-runtime). Every claim carries a discriminating
 * NEG control. ZERO-CORE, pure (stub models — no GPU). The load-bearing invariant: 0-false lives ONLY on the learned
 * certified layer (a `local-trusted` result's shape is ALWAYS certified) — never on the decomposition pick.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMixtureServe, makeSurfaceDispatch } = require('../../lib/combos/mixture-serve.js');

const SHAPES = ['aggregate>select', 'join>filter>select', 'filter>select'];
// a labelled anchor corpus (training queries → their certified shape) for the surface-dispatch signal.
const ANCHORS = [
	{ text: 'how many singers are there', shape: 'aggregate>select' },
	{ text: 'count the number of albums', shape: 'aggregate>select' },
	{ text: 'total number of students enrolled', shape: 'aggregate>select' },
	{ text: 'name of the pet owned by the student called Smith', shape: 'join>filter>select' },
	{ text: 'the make of the car driven by driver Jones', shape: 'join>filter>select' },
	{ text: 'the countries of singers older than twenty', shape: 'filter>select' },
	{ text: 'the ages of employees in the sales department', shape: 'filter>select' }
];

test('makeSurfaceDispatch — predict/proposeMenu retrieve the surface-similar shape; deterministic', () => {
	const sd = makeSurfaceDispatch({ anchors: ANCHORS, k: 2 });
	// a query lexically close to the aggregate anchors → predicted aggregate.
	assert.equal(sd.predict('how many albums are there'), 'aggregate>select');
	// a query close to the join anchors → predicted join.
	assert.equal(sd.predict('the name of the pet owned by student Jones'), 'join>filter>select');
	const menu = sd.proposeMenu('how many albums are there');
	assert.equal(menu.length, 2, 'proposeMenu narrows to k=2');
	assert.equal(menu[0], 'aggregate>select', 'top proposal is the surface-nearest shape');
	// determinism: same query → identical output.
	assert.deepEqual(sd.proposeMenu('how many albums are there'), menu);
});

test('cross-agreement trust-gate: small ↔ predictor concur → local-trusted (0 big call)', async () => {
	const sd = makeSurfaceDispatch({ anchors: ANCHORS });
	let bigCalls = 0;
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async ( q, menu ) => { assert.ok(Array.isArray(menu) && menu.length, 'small is oriented by a menu'); return 'aggregate>select'; },
		big: async () => { bigCalls++; return 'filter>select'; },
		proposeMenu: sd.proposeMenu, predict: sd.predict
	});
	const r = await mx.serve('how many albums are there');   // predict → aggregate; small → aggregate → concur
	assert.equal(r.tier, 'local-trusted');
	assert.equal(r.certified, true);
	assert.equal(r.shape, 'aggregate>select');
	assert.equal(bigCalls, 0, 'a trusted local answer never calls the big tier (amortization)');
	assert.equal(mx.stats.localTrusted, 1);
});

test('NEG control — confidently-wrong-but-certified (small ≠ predictor) → NOT trusted → escalates', async () => {
	const sd = makeSurfaceDispatch({ anchors: ANCHORS });
	let bigCalls = 0;
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		// the steered-wrong case: the small emits a CERTIFIED shape that disagrees with the surface predictor.
		small: async () => 'aggregate>select',
		big: async () => { bigCalls++; return 'join>filter>select'; },
		proposeMenu: sd.proposeMenu, predict: sd.predict
	});
	const r = await mx.serve('the name of the pet owned by student Jones');   // predict → join; small → aggregate → disagree
	assert.equal(r.tier, 'escalated', 'disagreement is caught: a certified-but-wrong shape is not auto-trusted');
	assert.equal(r.local, 'aggregate>select', 'the untrusted local shape is reported');
	assert.equal(r.shape, 'join>filter>select', 'the served shape is the big tier’s');
	assert.equal(bigCalls, 1);
	assert.equal(mx.stats.escalated, 1);
});

test('0-false invariant — an UNCERTIFIED small shape is never trusted, even if it equals the predictor', async () => {
	// predictor and small AGREE, but on a shape NOT in the certified vocabulary → must NOT be local-trusted.
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async () => 'group>having>aggregate>select',        // not in SHAPES
		big: async () => 'aggregate>select',
		predict: () => 'group>having>aggregate>select'             // agrees, but the shape is uncertified
	});
	const r = await mx.serve('q');
	assert.equal(r.tier, 'escalated', 'cross-agreement on an UNCERTIFIED shape is not trust — closed-vocabulary soundness');
	assert.notEqual(r.tier, 'local-trusted');
});

test('fail-closed default — no predictor and no trust → nothing auto-trusted (never trust a bare certified shape)', async () => {
	let bigCalls = 0;
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async () => 'aggregate>select',                     // certified, but no independent corroboration
		big: async () => { bigCalls++; return 'aggregate>select'; }
	});
	const r = await mx.serve('q');
	assert.equal(r.tier, 'escalated', 'without an independent signal, a bare certified shape is NOT auto-trusted (47% live precision)');
	assert.equal(bigCalls, 1);
});

test('no big tier → an untrusted result is tagged local-untrusted (never forced, no false negative claim)', async () => {
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async () => 'aggregate>select',
		predict: () => 'filter>select'                             // disagree, and no big tier wired
	});
	const r = await mx.serve('q');
	assert.equal(r.tier, 'local-untrusted');
	assert.equal(r.trusted, false);
	assert.equal(r.certified, true, 'still reports certified-vocabulary membership honestly');
	assert.equal(mx.stats.localUntrusted, 1);
});

test('custom trust predicate overrides the default (e.g. a host self-fit gate)', async () => {
	let seen = null;
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async () => 'filter>select',
		big: async () => 'aggregate>select',
		trust: ( q, shape, ctx ) => { seen = { q, shape, ctx }; return shape === 'filter>select'; }
	});
	const r = await mx.serve('qx');
	assert.equal(r.tier, 'local-trusted');
	assert.equal(seen.shape, 'filter>select');
	assert.ok('menu' in seen.ctx && 'predicted' in seen.ctx, 'trust receives the {menu, predicted} context');
});

test('guards — missing certifiedShapes or small throw', () => {
	assert.throws(() => createMixtureServe({ small: async () => 'x' }), /certifiedShapes/);
	assert.throws(() => createMixtureServe({ certifiedShapes: SHAPES }), /small/);
	assert.throws(() => makeSurfaceDispatch({}), /anchors/);
});
