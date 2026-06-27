'use strict';
/**
 * ABSTRACTIVATION (2026-06-27, F6 / U1) — anti-unification + splice-time binding of a STRUCTURAL method.
 * Unit-level: relativize/instantiate round-trip, cross-call-site REBASE (no base/frontier leakage), the
 * Plotkin LGG `antiUnify` (two ground derivations → one stable skeleton), and the cache `transform`
 * integration (a structural template TRANSFERS across related-but-different call sites), each with a
 * NEGATIVE CONTROL (an un-relativizable template doesn't store; an unbound frontier ref bypasses; two
 * different-signature derivations don't false-unify).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relativize, instantiate, antiUnify, hasHoles, methodTransform } = require('../../lib/authoring/abstract.js');
const { createProviderCache } = require('../../lib/providers/cache.js');

// a ground structural template, exactly the problem-paths `plan` shape: parent update + created
// intermediate node + 2 child segments wired to the call-site endpoints, with ABSOLUTE ids.
function ground( base, origin, target, mid ) {
	return [
		{ $_id: '_parent', Plan: true, Decomposed: true, alts: [{ mid: mid, segA: base + '_a0', segB: base + '_b0' }] },
		{ _id: base + '_m0', Node: true, state: mid },
		{ _id: base + '_a0', Segment: true, originNode: origin, targetNode: base + '_m0', parentSeg: base },
		{ _id: base + '_b0', Segment: true, originNode: base + '_m0', targetNode: target, parentSeg: base }
	];
}
const ctxOf = ( base, origin, target ) => ({ base, refs: { origin, target } });

test('relativize→instantiate ROUND-TRIPS to the same call site (identity)', () => {
	const g = ground('root', 'S', 'G', 'mid-x');
	const ctx = ctxOf('root', 'S', 'G');
	const param = relativize(g, ctx);
	assert.ok(hasHoles(param), 'the parameterized form carries holes');
	assert.deepEqual(instantiate(param, ctx), g, 'binding back to the SAME ctx reproduces the ground template');
});

test('REBASE to a DIFFERENT call site: ids rebased, frontier refs rebound, NO leakage of the old base', () => {
	const param = relativize(ground('root', 'S', 'G', 'mid-x'), ctxOf('root', 'S', 'G'));
	const bound = instantiate(param, ctxOf('seg7', 'N3', 'N9'));   // a different problem's call site
	const flat = JSON.stringify(bound);
	assert.ok(!/root/.test(flat), 'no old base id ("root") leaks into the rebased template');
	assert.ok(!/"S"|"G"/.test(flat), 'no old frontier ids leak');
	// the structural skeleton is rebased onto the new call site:
	assert.equal(bound[1]._id, 'seg7_m0', 'created node id is rebased to the new base');
	assert.equal(bound[2]._id, 'seg7_a0');
	assert.equal(bound[2].originNode, 'N3', 'first child wired from the NEW origin');
	assert.equal(bound[2].targetNode, 'seg7_m0', 'first child wired into the rebased intermediate');
	assert.equal(bound[3].originNode, 'seg7_m0');
	assert.equal(bound[3].targetNode, 'N9', 'second child wired to the NEW target');
	assert.equal(bound[3].parentSeg, 'seg7', 'parentSeg rebased to the new base');
	// CONTENT (the typed payload the model derived) is replayed verbatim — it is the cache payload:
	assert.equal(bound[1].state, 'mid-x', 'the derived intermediate state is the cached content (replayed)');
	assert.deepEqual(bound[0].alts, [{ mid: 'mid-x', segA: 'seg7_a0', segB: 'seg7_b0' }], 'nested ledger ids rebased too, content kept');
	assert.equal(bound[0].$_id, '_parent', "'_parent' (already relative) passes through");
});

test("NEGATIVE CONTROL — an unbound frontier ref at the new call site BYPASSES (instantiate→null)", () => {
	const param = relativize(ground('root', 'S', 'G', 'm'), ctxOf('root', 'S', 'G'));
	const bound = instantiate(param, { base: 'seg7', refs: { origin: 'N3' /* target MISSING */ } });
	assert.equal(bound, null, 'a missing frontier ref → null (the caller bypasses to a fresh call, never a wrong replay)');
});

test('antiUnify: two ground derivations of the SAME shape → STABLE; content diffs become content-vars', () => {
	const A = ground('root', 'S', 'G', 'midA');
	const B = ground('seg7', 'N3', 'N9', 'midB');                  // different ids/refs AND different content (midA≠midB)
	const r = antiUnify(A, ctxOf('root', 'S', 'G'), B, ctxOf('seg7', 'N3', 'N9'));
	assert.ok(r.stable, 'the two derivations are shape-compatible (one structural skeleton)');
	assert.equal(r.shapeDiffs.length, 0, 'no tree-shape differences');
	// the ONLY differences are the content leaves (the intermediate state appears twice: node + ledger).
	const paths = r.contentVars.map(( d ) => d.path).sort();
	assert.ok(paths.some(( p ) => /state/.test(p)), 'the derived intermediate state is a content-var (a cache-KEY obligation, not a call-site hole)');
	assert.ok(r.contentVars.every(( d ) => /midA|midB/.test(JSON.stringify([d.a, d.b]))), 'content-vars are exactly the model-derived content (midA vs midB)');
	// the runtime replay path: each instance's OWN relativized form binds back to its OWN call site.
	assert.deepEqual(instantiate(relativize(A, ctxOf('root', 'S', 'G')), ctxOf('root', 'S', 'G')), A);
	assert.deepEqual(instantiate(relativize(B, ctxOf('seg7', 'N3', 'N9')), ctxOf('seg7', 'N3', 'N9')), B);
});

test('antiUnify NEGATIVE CONTROL — a different STRUCTURE does not falsely unify', () => {
	const A = ground('root', 'S', 'G', 'm');
	// B inserts TWO intermediates (a different skeleton), not one.
	const B = [
		{ $_id: '_parent', Plan: true, Decomposed: true },
		{ _id: 'seg7_m0', Node: true, state: 'm' }, { _id: 'seg7_m1', Node: true, state: 'm2' },
		{ _id: 'seg7_a0', Segment: true, originNode: 'N3', targetNode: 'seg7_m0', parentSeg: 'seg7' }
	];
	const r = antiUnify(A, ctxOf('root', 'S', 'G'), B, ctxOf('seg7', 'N3', 'N9'));
	assert.ok(!r.stable, 'structurally-different derivations are reported NOT stable');
	assert.ok(r.shapeDiffs.length > 0, 'the tree-shape differences are reported');
});

test('methodTransform + cache: a STRUCTURAL decision TRANSFERS across related-but-different call sites', () => {
	// the cache keys on the TYPED signature (the K1 surface) — NOT the absolute ids/states — so two
	// different problems sharing a typed transition share a key; the transform rebases on replay.
	const calls = [];
	const provider = function ( g, c, scope, argz, cb ) {
		const seg = scope._;
		calls.push(seg._id);
		cb(null, ground(seg._id, seg.originNode, seg.targetNode, 'mid:' + seg.sig));
	};
	const sigKey = ( g, c, s ) => ({ sig: s._.sig });             // the typed signature (shared across problems)
	const T = methodTransform({ frontier: { origin: 'originNode', target: 'targetNode' } });

	const cache = createProviderCache();
	const wrapped = cache.wrap(provider, sigKey, T);
	const scope = ( id, o, t, sig ) => ({ _: { _id: id, originNode: o, targetNode: t, sig } });

	let outA, outB, outC;
	wrapped(null, { _name: 'Plan' }, scope('root', 'S', 'G', 'X>Y'), null, ( e, t ) => { outA = t; });        // COLD A
	assert.deepEqual(calls, ['root'], 'problem A is a real call (cold)');

	// problem B: SAME typed signature X>Y, DIFFERENT ids/endpoints → HIT, rebased, ZERO real calls.
	wrapped(null, { _name: 'Plan' }, scope('seg7', 'N3', 'N9', 'X>Y'), null, ( e, t ) => { outB = t; });
	assert.deepEqual(calls, ['root'], 'problem B replayed at 0 real calls (cross-problem STRUCTURAL transfer)');
	assert.equal(outB[1]._id, 'seg7_m0', 'B got correctly rebased ids');
	assert.equal(outB[2].originNode, 'N3', "B wired to B's own endpoints");
	assert.ok(!/root|"S"|"G"/.test(JSON.stringify(outB)), 'no A id-space leaked into B (sound)');

	// NEGATIVE CONTROL: problem C with a DIFFERENT signature → miss → pays (no false replay).
	wrapped(null, { _name: 'Plan' }, scope('segZ', 'P0', 'P1', 'P>Q'), null, ( e, t ) => { outC = t; });
	assert.deepEqual(calls, ['root', 'segZ'], 'a different typed transition pays a real call (no false replay)');

	assert.equal(cache.stats.hits, 1, 'exactly one cross-problem hit');
});

test('methodTransform onStore returns null for a template with NO holes (not transfer-safe → not stored)', () => {
	// a purely id-relative leaf template ($_id:_parent only) has no structural holes; the structural
	// transform declines to store it (the flat cache already handles id-relative transfer soundly).
	const T = methodTransform({ frontier: { origin: 'originNode', target: 'targetNode' } });
	const leaf = { $_id: '_parent', result: 42 };
	const info = { scope: { _: { _id: 'x', originNode: 'S', targetNode: 'G' } } };
	assert.equal(T.onStore(leaf, info), null, 'a hole-free template is not stored by the structural transform');
});
