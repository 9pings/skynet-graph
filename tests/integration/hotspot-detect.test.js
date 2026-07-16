'use strict';
/**
 * §4.2-B — the distill go/no-go DETECTOR over the REAL provider cache + its fidelity mechanism.
 * The three-way pre-test that GATES the entire distilled-NN-concept build:
 *   POSITIVE: high-volume ∧ high-cardinality ∧ high-fidelity → 'distill-candidate'
 *   NEG 1   : low-cardinality exactly-recurrent             → 'cache-already-wins'
 *   NEG 2   : high-cardinality but low-fidelity             → 'unlearnable'
 *   (+ too-rare). NEG 1 & 2 differ from the positive in EXACTLY ONE factor — the controls.
 *
 * The honest go/no-go: the workloads skynet actually targets are recurrent typed K1 streams,
 * which the exact-key cache already serves at 0 calls → 'cache-already-wins' → the net stays
 * filed. A distilled net only earns its place on a frequent ∧ cache-MISSING ∧ learnable slice;
 * this detector proves/refutes that cheaply rather than on faith.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProviderCache } = require('../../lib/providers/cache.js');
const { trackCache, hotspots, anyCandidate } = require('../../plugins/learning/lib/hotspot.js');

// drive a sequence of keyed casts through the real cache (a pure provider wrapper — no engine).
function driver() {
	const t = trackCache();
	const cache = createProviderCache({ key: (g, c, s) => s._.k, fidelity: { threshold: 0.8, warmup: 2 }, onHit: t.onHit, onMiss: t.onMiss });
	let nondet = 0;
	const det    = (g, c, s, a, cb) => cb(null, { $_id: '_parent', [c._name]: true, verdict: 'v_' + s._.k });   // a function of the typed key → reproduces
	const nondet_ = (g, c, s, a, cb) => cb(null, { $_id: '_parent', [c._name]: true, verdict: 'v_' + (nondet++) }); // not a function of the key → never reproduces
	async function drive(name, fn, keys) {
		const C = { _name: name }, w = cache.wrap(fn, (g, c, s) => s._.k);
		for ( const k of keys ) await new Promise((r) => w(null, C, { _: { k } }, [], () => r()));
	}
	const repeat = (prefix, nKeys, reps, tail) => {
		const ks = [];
		for ( let i = 0; i < nKeys; i++ ) for ( let j = 0; j < reps; j++ ) ks.push(prefix + i);
		for ( let i = nKeys; i < nKeys + (tail || 0); i++ ) ks.push(prefix + i);
		return ks;
	};
	return { t, cache, det, nondet_, drive, repeat };
}

test('§4.2-B the three-way detector classifies all four buckets on the real cache', async () => {
	const d = driver();
	await d.drive('Recurrent', d.det, d.repeat('r', 3, 10, 0));          // 3 keys × 10 → exact-key memo wins
	await d.drive('Distillable', d.det, d.repeat('d', 10, 3, 20));       // 30 distinct keys, 10 reproduce → learnable
	await d.drive('Unlearnable', d.nondet_, d.repeat('u', 10, 3, 20));   // same shape, verdict NOT a fn of the key
	await d.drive('Rare', d.det, ['x', 'x', 'x']);                       // 1 key → too rare

	const report = hotspots(d.t, d.cache.fid, { minCalls: 20, maxHitRate: 0.5, minFidelity: 0.8 });
	const by = Object.fromEntries(report.map((r) => [r.concept, r]));

	assert.equal(by.Distillable.verdict, 'distill-candidate', 'frequent ∧ cache-missing ∧ K1-sufficient');
	assert.equal(by.Recurrent.verdict, 'cache-already-wins', 'a low-cardinality recurrent slice is already served');
	assert.equal(by.Unlearnable.verdict, 'unlearnable', 'high cardinality but the verdict is off the typed surface');
	assert.equal(by.Rare.verdict, 'too-rare', 'below the volume floor');

	// the controls isolate ONE factor each:
	assert.ok(by.Recurrent.hitRate > 0.5 && by.Distillable.hitRate <= 0.5, 'cardinality (hitRate) separates cache-wins from distill');
	assert.equal(by.Distillable.distinctKeys, by.Unlearnable.distinctKeys, 'distill vs unlearnable share volume+cardinality');
	assert.ok(by.Distillable.fidMean >= 0.8 && by.Unlearnable.fidMean < 0.8, '…they differ ONLY in fidelity (the K1-sufficiency control)');

	// distill-candidates sort first (the actionable ones on top).
	assert.equal(report[0].concept, 'Distillable');
});

test('§4.2-B honest go/no-go: a recurrent typed stream (the engine\'s target shape) yields NO distill-candidate', async () => {
	// the workload skynet targets — a recurrent typed K1 stream — is exactly-recurrent: the cache
	// serves it. The detector returns no candidate ⇒ the distilled net stays filed (the expected outcome).
	const d = driver();
	await d.drive('TypedStream', d.det, d.repeat('k', 5, 12, 0));   // 5 classes, recurrent
	const report = hotspots(d.t, d.cache.fid, { minCalls: 20, maxHitRate: 0.5, minFidelity: 0.8 });
	assert.equal(anyCandidate(report), false, 'no qualifying hot-spot — the net stays filed (honest no-go)');
	assert.equal(report[0].verdict, 'cache-already-wins', 'the recurrent stream is cache-served');
});
