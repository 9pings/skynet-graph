'use strict';
/**
 * DERIVATION CACHE (2026-06-27) — an additive, opt-in content-addressed memo over a provider, keyed on the
 * canonical justification of a cast. Unit-level: hits/misses/bypass/CanonMiss/clone/version, with the
 * NEGATIVE CONTROL that a changed input must MISS (no false replay) and a `null` key must BYPASS.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProviderCache, keyFromScope } = require('../../lib/providers/cache.js');

// a counting provider: returns a template derived from the scope's `x`, records every real call.
function countingProvider() {
	const calls = [];
	const fn = function ( graph, concept, scope, argz, cb ) { calls.push(scope._.x); cb(null, { $_id: '_parent', Done: true, y: scope._.x * 10 }); };
	return { fn, calls };
}
const C = { _name: 'Demo' };
const scopeOf = ( x ) => ({ _: { x } });
const keyByX = ( g, c, s ) => ({ x: s._.x });   // key on the input fact

test('HIT/MISS: same justification replays (no real call); a CHANGED input MISSES (negative control)', () => {
	const cache = createProviderCache();
	const { fn, calls } = countingProvider();
	const wrapped = cache.wrap(fn, keyByX);
	let out;

	wrapped(null, C, scopeOf(3), null, ( e, t ) => { out = t; });          // miss → real call
	assert.deepEqual(calls, [3], 'first cast is a real call');
	assert.equal(out.y, 30);

	wrapped(null, C, scopeOf(3), null, ( e, t ) => { out = t; });          // same key → HIT, no real call
	assert.deepEqual(calls, [3], 'a re-derive with the same justification did NOT call the provider');
	assert.equal(out.y, 30, 'the replayed template is correct');

	wrapped(null, C, scopeOf(4), null, () => {});                          // NEGATIVE CONTROL: different input → MISS
	assert.deepEqual(calls, [3, 4], 'a changed input is a real call — no false replay');

	assert.equal(cache.stats.hits, 1);
	assert.equal(cache.stats.misses, 2);
});

test('REPLAY is a deep clone — mutating the returned template does not poison the store', () => {
	const cache = createProviderCache();
	const { fn } = countingProvider();
	const wrapped = cache.wrap(fn, keyByX);
	let a, b;
	wrapped(null, C, scopeOf(7), null, ( e, t ) => { a = t; });
	a.y = 999; a.injected = true;                                          // corrupt the caller's copy
	wrapped(null, C, scopeOf(7), null, ( e, t ) => { b = t; });           // hit
	assert.equal(b.y, 70, 'the cached template is untouched by a caller mutation');
	assert.ok(!('injected' in b), 'no leakage from the mutated copy');
});

test('BYPASS: a null key (CanonMiss / unkeyable / exploratory) always calls through', () => {
	const cache = createProviderCache();
	const { fn, calls } = countingProvider();
	const wrapped = cache.wrap(fn, () => null);                            // key fn says "unkeyable"
	wrapped(null, C, scopeOf(1), null, () => {});
	wrapped(null, C, scopeOf(1), null, () => {});
	assert.deepEqual(calls, [1, 1], 'both casts called through (no caching)');
	assert.equal(cache.stats.bypass, 2);
	assert.equal(cache.stats.hits, 0);

	// an `explore` flag on the object also bypasses.
	const c2 = createProviderCache(); const p2 = countingProvider(); const w2 = c2.wrap(p2.fn, keyByX);
	w2(null, C, { _: { x: 2, explore: true } }, null, () => {});
	w2(null, C, { _: { x: 2, explore: true } }, null, () => {});
	assert.deepEqual(p2.calls, [2, 2], 'an exploratory cast is never cached');
});

test('CanonMiss result is NOT stored (fail-closed) — the next same-key cast re-calls', () => {
	const cache = createProviderCache();
	const calls = [];
	const fn = ( g, c, s, a, cb ) => { calls.push(1); cb(null, { $_id: '_parent', Done: true, DemoCanonMiss: true }); };
	const wrapped = cache.wrap(fn, keyByX);
	wrapped(null, C, scopeOf(5), null, () => {});
	wrapped(null, C, scopeOf(5), null, () => {});
	assert.deepEqual(calls, [1, 1], 'a CanonMiss result is never cached → always re-calls (fail-closed)');
	assert.equal(cache.stats.stores, 0);
});

test('VERSION token (B8): a method/lib version bump changes the key — no stale template served', () => {
	let ver = 'v1';
	const cache = createProviderCache({ version: () => ver });
	const { fn, calls } = countingProvider();
	const wrapped = cache.wrap(fn, keyByX);
	wrapped(null, C, scopeOf(9), null, () => {});                          // miss under v1
	wrapped(null, C, scopeOf(9), null, () => {});                          // hit under v1
	assert.deepEqual(calls, [9]);
	ver = 'v2';                                                           // the method was patched
	wrapped(null, C, scopeOf(9), null, () => {});                          // MUST miss under v2 (not serve the v1 template)
	assert.deepEqual(calls, [9, 9], 'a version bump invalidates — the v1 template is not served to a v2 cast');
});

test('keyFromScope: digests facts + resolved refs; a missing required ref BYPASSES', () => {
	const cache = createProviderCache();
	const calls = [];
	const fn = ( g, c, s, a, cb ) => { calls.push(s._.id); cb(null, { ok: true }); };
	// key on the cast object's `from` fact + a resolved endpoint state ref.
	const kf = keyFromScope({ facts: ['from'], refs: { dstState: 'target:state' }, require: ['dstState'] });
	const mkScope = ( from, dst ) => ({ _: { id: from + '>' + dst, from }, getRef: ( p ) => p === 'target:state' ? { _: dst } : undefined });
	const wrapped = cache.wrap(fn, kf);

	wrapped(null, C, mkScope('a', 'b'), null, () => {});                   // miss
	wrapped(null, C, mkScope('a', 'b'), null, () => {});                   // hit (same from + same dst state)
	assert.deepEqual(calls, ['a>b'], 'same facts + same resolved ref → replay');
	wrapped(null, C, mkScope('a', 'c'), null, () => {});                   // different dst state → miss
	assert.deepEqual(calls, ['a>b', 'a>c'], 'a changed cross-object input is a real call');

	// a missing required ref → bypass (never a wrong replay on incomplete input).
	const noDst = { _: { id: 'a>?', from: 'a' }, getRef: () => undefined };
	wrapped(null, C, noDst, null, () => {});
	wrapped(null, C, noDst, null, () => {});
	assert.equal(cache.stats.bypass, 2, 'an unresolved required ref bypasses both times');
});
