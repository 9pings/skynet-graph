'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * A (Proxy-KD lesson 4 — per-case fidelity weighting → the continuous K1 gradient). The derivation cache learns,
 * per canonical key, how reliably the key predicts the provider's verdict: a FAITHFUL key (answer determined by
 * the keyed facts) amortizes (replays at 0 calls after a short warm-up); a LOSSY key (the canonicalization drops a
 * decision-relevant fact, so the same key maps to DIFFERENT true answers) drops below the fidelity threshold and
 * ESCALATES — re-deriving instead of serving a stale entry. The negative control is the binary cache, which
 * serves the lossy key stale (wrong). Study: docs/WIP/studies/2026-06-28-proxy-kd-distillation-lessons.md.
 */
const test = require('node:test');
const assert = require('node:assert');
const { createProviderCache } = require('../../lib/providers/cache.js');

// a counting provider whose TRUE answer for kind='lossy' depends on `b` — a fact the key (below) DROPS.
function makeProvider() {
	let calls = 0;
	const fn = ( g, c, scope, argz, cb ) => {
		calls++; const f = scope._;
		const answer = f.kind === 'faithful' ? `f:${f.a}` : `l:${f.a}:${f.b}`;
		cb(null, { $_id: '_parent', answer: answer, Decided: true });
	};
	fn.calls = () => calls;
	return fn;
}
const keyFn = ( g, c, scope ) => ({ kind: scope._.kind, a: scope._.a });        // DROPS `b` → lossy for kind='lossy'
const drive = ( wrapped, facts ) => new Promise(( res ) => wrapped({}, { _name: 'Dec' }, { _: facts }, null, ( e, tpl ) => res(tpl.answer)));

// ── negative control: the binary (default) cache replays a lossy key STALE ────────────────────────
test('binary cache serves a LOSSY key stale — the failure fidelity-gating fixes', async () => {
	const fn = makeProvider();
	const w = createProviderCache({}).wrap(fn, keyFn);
	const r1 = await drive(w, { kind: 'lossy', a: 1, b: 'X' });    // MISS → derives l:1:X, caches under {lossy,1}
	const r2 = await drive(w, { kind: 'lossy', a: 1, b: 'Y' });    // HIT on {lossy,1} → replays l:1:X (true is l:1:Y)
	assert.equal(r1, 'l:1:X');
	assert.equal(r2, 'l:1:X', 'binary cache replays the STALE entry (should be l:1:Y)');
	assert.equal(fn.calls(), 1, 'and saves the call — at the cost of a wrong answer');
});

// ── fidelity-gating: the lossy key escalates (correct), the faithful key amortizes ────────────────
test('fidelity-gated cache escalates a LOSSY key (always correct) and amortizes a FAITHFUL key', async () => {
	const fn = makeProvider();
	const cache = createProviderCache({ fidelity: { threshold: 0.8, warmup: 2 } });
	const w = cache.wrap(fn, keyFn);

	// LOSSY class {lossy,1}: vary b. 1 miss + warm-up verifies reveal low fidelity → escalate. EVERY served answer
	// is the TRUE (freshly-derived) one — never a stale replay.
	const lossy = [];
	for ( const b of ['X', 'Y', 'Z', 'W', 'V'] ) lossy.push(await drive(w, { kind: 'lossy', a: 1, b }));
	assert.deepEqual(lossy, ['l:1:X', 'l:1:Y', 'l:1:Z', 'l:1:W', 'l:1:V'], 'lossy key never serves stale');
	const lossyCalls = fn.calls();
	assert.equal(lossyCalls, 5, 'the lossy key keeps re-deriving (1 miss + warm-up + escalations) — pays per case');
	assert.ok(cache.fid.get(cache.key({ _name: 'Dec' }, require('../../lib/providers/canonicalize.js').digest({ kind: 'lossy', a: 1 }))).ok === 0,
		'its measured reproduce-rate is 0 (the canonicalization is unreliable)');

	// FAITHFUL class {faithful,2}: answer ignores b → high fidelity → replays after warm-up.
	const before = fn.calls();
	const faithful = [];
	for ( const b of ['X', 'Y', 'Z', 'W', 'V'] ) faithful.push(await drive(w, { kind: 'faithful', a: 2, b }));
	assert.deepEqual(faithful, ['f:2', 'f:2', 'f:2', 'f:2', 'f:2'], 'faithful key is always correct too');
	const faithfulCalls = fn.calls() - before;
	assert.equal(faithfulCalls, 3, 'the faithful key amortizes: 1 miss + 2 warm-up verifies, then 0-call replays');
	assert.ok(faithfulCalls < lossyCalls, 'fidelity-gating amortizes the reliable class but escalates the lossy one');
});
