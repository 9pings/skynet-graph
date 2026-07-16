'use strict';
/**
 * compress — the DIGRAM-grain affinity miner (the reopened compress.js, built on the 2026-07-03 GO kill-gate:
 * digram invariance exists strictly below the whole-structure threshold on the RUN-8 0-splits). Mines recurring
 * ADJACENT typed-step pairs + recurring sub-expansions from decompose shape-trees, folds them under the mdl.js
 * ΔL objective (step-alphabet face), and mints typed-loop-parity expand patches for the dispatchable ones.
 * Pure unit level — shapes in, stats/templates out; no engine boot.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mineDigrams, subExpansionIndex, foldSubpaths, toExpandPatch, mineForest } = require('../../plugins/learning/lib/compress.js');
const { makeTypedDecomposeProviders } = require('../../lib/authoring/core/typed-loop.js');

// shape-tree helper: n('filter', n('filter')) = a filter step whose expansion is one atomic filter
const n = ( k, ...c ) => ({ k, c });

// A tiny corpus in the RUN-8 dump shape: entries = [{ cls, mult, tree }] — tree is the ROOT task's expansion.
// The compare class varies in the TAIL (the RUN-8 pattern) but shares the (filter,aggregate) digram everywhere.
const CORPUS = [
	{ cls: 'compare', mult: 3, tree: [n('filter', n('filter')), n('aggregate', n('aggregate')), n('check'), n('emit')] },
	{ cls: 'compare', mult: 2, tree: [n('filter', n('filter')), n('aggregate', n('aggregate'))] },
	{ cls: 'compare', mult: 1, tree: [n('filter', n('filter')), n('aggregate', n('aggregate')), { c: [] }] }, // malformed tail
	{ cls: 'count', mult: 2, tree: [n('filter'), n('aggregate')] },
];

test('mineDigrams — support is per-TASK (multiplicity-weighted), occurrences overlap, malformed kinds fail-closed to ∅', () => {
	const r = mineDigrams(CORPUS);
	const fa = r.digrams.find(( d ) => d.a === 'filter' && d.b === 'aggregate');
	assert.ok(fa, '(filter,aggregate) mined');
	assert.equal(fa.support, 8, 'all 8 tasks contain it (3+2+1 compare + 2 count)');
	const agc = r.digrams.find(( d ) => d.a === 'aggregate' && d.b === 'check');
	assert.equal(agc.support, 3, 'only the ×3 variant has (aggregate,check)');
	const mal = r.digrams.find(( d ) => d.b === '∅');
	assert.ok(mal && mal.a === 'aggregate' && mal.support === 1, 'the malformed node mines as ∅, never a typed kind');
	assert.equal(r.tasks, 8);
});

test('subExpansionIndex kind-grain — a stable body dispatches with its support; a conflicting body goes undetermined (K1 rule)', () => {
	const ix = subExpansionIndex();
	for ( const e of CORPUS ) ix.observe(e.tree, { rootKind: e.cls, mult: e.mult });
	// 'filter' expands to [filter(atomic)] in every compare task (6 tasks) — unique body, dispatchable
	const hit = ix.dispatch('compare', 'filter');
	assert.ok(hit, 'stable interior level dispatches');
	assert.equal(hit.support, 6);
	assert.deepEqual(hit.body, [{ k: 'filter', a: true }]);
	// the ROOT expansion of 'compare' has 3 distinct bodies → undetermined at every grain that sees them all
	assert.equal(ix.dispatch('⊤', 'compare'), null, 'conflicting root bodies are undetermined (K1: refuse, never first-wins)');
	assert.equal(ix.dispatch(null, 'compare'), null, 'kind-grain fallback sees the same conflict');
});

test('subExpansionIndex ctx-grain — the (parentKind, kind) key discriminates what the kind-grain key conflates', () => {
	const ix = subExpansionIndex({ minSupport: 2 });
	// the SAME kind 'agg' expands to two DIFFERENT bodies under two different parents:
	// kind-grain goes undetermined (K1), ctx-grain splits the class and both halves dispatch.
	ix.observe([n('agg', n('filter'), n('aggregate'))], { rootKind: 'sum', mult: 2 });
	ix.observe([n('agg', n('aggregate'), n('emit'))], { rootKind: 'top', mult: 2 });
	assert.equal(ix.dispatch(null, 'agg'), null, 'kind-grain conflates the two bodies → undetermined');
	assert.ok(ix.dispatch('sum', 'agg'), 'ctx key (sum→agg) dispatches its own body');
	assert.deepEqual(ix.dispatch('sum', 'agg').body, [{ k: 'filter', a: true }, { k: 'aggregate', a: true }]);
	assert.ok(ix.dispatch('top', 'agg'), 'ctx key (top→agg) dispatches the other body');
});

test('subExpansionIndex — minSupport gates the dispatch (support 1 never dispatches)', () => {
	const ix = subExpansionIndex({ minSupport: 2 });
	ix.observe([n('filter', n('filter'))], { rootKind: 'compare', mult: 1 });
	assert.equal(ix.dispatch('compare', 'filter'), null, 'one observation is not a recurrence');
	ix.observe([n('filter', n('filter'))], { rootKind: 'compare', mult: 1 });
	assert.ok(ix.dispatch('compare', 'filter'), 'the second identical observation crosses minSupport');
});

test('subExpansionIndex.observeProduction — the streaming grain accrues one paid expand, both key grains', () => {
	const ix = subExpansionIndex({ minSupport: 2 });
	ix.observeProduction('compare', 'filter', [{ k: 'filter', a: true }]);
	assert.equal(ix.dispatch('compare', 'filter'), null, 'support 1 < minSupport');
	ix.observeProduction('compare', 'filter', [{ k: 'filter', a: true }]);
	assert.deepEqual(ix.dispatch('compare', 'filter').body, [{ k: 'filter', a: true }], 'ctx grain accrued');
	assert.ok(ix.dispatch(null, 'filter'), 'kind grain accrued by the same observation');
});

test('subExpansionIndex.invalidate — a contradicted key goes K1-undetermined at ITS grain only (the false-hit discipline)', () => {
	const ix = subExpansionIndex({ minSupport: 1 });
	ix.observeProduction('compare', 'filter', [{ k: 'filter', a: true }]);
	assert.ok(ix.dispatch(null, 'filter') && ix.dispatch('compare', 'filter'), 'both grains dispatch before');
	ix.invalidate('compare', 'filter');
	assert.equal(ix.dispatch('compare', 'filter'), null, 'the ctx key is dead');
	assert.ok(ix.dispatch(null, 'filter'), 'the kind grain is untouched — invalidation is per-key, never a blanket');
});

test('foldSubpaths — the mdl.js ΔL objective (step-alphabet face) admits the recurrent digram, rejects the singleton', () => {
	const r = foldSubpaths(CORPUS);
	const fa = r.subpaths.find(( s ) => s.a === 'filter' && s.b === 'aggregate');
	assert.ok(fa && fa.admitted && fa.dl.delta < 0, 'the 8-task digram pays its dictionary + tax');
	const mal = r.subpaths.find(( s ) => s.b === '∅');
	assert.ok(!mal || !mal.admitted, 'a singleton digram never folds (ΔL ≥ 0)');
	assert.ok(r.dlAfter < r.dlBefore, 'net compression when anything folds');
});

test('toExpandPatch — parity with the typed-loop expand patch (the mount/guard conventions ride the template)', async () => {
	const steps = [{ kind: 'filter', atomic: true }, { kind: 'aggregate', atomic: false }];
	const site = { baseId: 'T1', origin: 'S', target: 'G', depth: 1 };
	const patch = toExpandPatch(steps, site);
	// reference: what the live typed-loop provider emits for the same steps at the same site
	const P = makeTypedDecomposeProviders({ stepKinds: { enum: ['filter', 'aggregate'] }, maxDepth: 3,
		expandFn: () => [{ stepKind: 'filter' }, { stepKind: 'aggregate', atomic: false }] });
	const ref = await new Promise(( res, rej ) => P.AI.expand(null, null, { _: { _id: 'T1', originNode: 'S', targetNode: 'G', depth: 0, Segment: true } },
		null, ( e, tpl ) => e ? rej(e) : res(tpl)));
	const strip = ( o ) => { const r = {}; for ( const k of Object.keys(o) ) if ( o[k] !== undefined ) r[k] = o[k]; return r; };
	assert.deepEqual(patch, ref.map(strip), 'a minted subpath mounts EXACTLY like a live expand (guards + plan-state + id scheme)');
});

test('mineForest — per-class variant multiset (the method-forest skeleton) + digrams shared across ≥2 variants', () => {
	const f = mineForest(CORPUS);
	const cmp = f.classes.compare;
	assert.equal(cmp.variants.length, 3, 'three distinct compare variants');
	assert.equal(cmp.variants.reduce(( a, v ) => a + v.mult, 0), 6, 'multiplicities preserved');
	assert.ok(cmp.shared.includes('filter→aggregate'), 'the shared subpath annotates the forest');
	assert.ok(!cmp.shared.includes('aggregate→check'), 'a single-variant digram is not shared structure');
});
