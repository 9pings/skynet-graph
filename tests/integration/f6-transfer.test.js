'use strict';
/**
 * F6 / U1 — CROSS-PROBLEM STRUCTURAL TRANSFER on the real engine (2026-06-27).
 *
 * The decisive-experiment gate put F6 on the critical path (finding #30): a STRUCTURAL decision bakes
 * ABSOLUTE ids, so the flat cache can't transfer it across related-but-different problems. This pins, on
 * the REAL stabilization loop, that `abstract.js#methodTransform` (relativize-on-store / bind-on-replay,
 * keyed on the typed K1 signature) makes that transfer NON-ZERO and SOUND, with:
 *   - a SOUNDNESS control: the flat cache replays A's id-space into B → unsound (reproduces #30 live);
 *   - a NEGATIVE control: a different typed transition (C) still pays (no false replay).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mode, sigKey, transform } = require('../../../WIP/experiments/2026-06-27-f6-abstractivation/F6-transfer.js');
const { createProviderCache } = require('../../lib/providers/cache.js');

const PROBLEMS = [
	{ pfx: 'A', fromKind: 'X', toKind: 'Y', from: 'x0', to: 'y0' },
	{ pfx: 'B', fromKind: 'X', toKind: 'Y', from: 'x1', to: 'y1' },   // same typed transition, OWN id-space
	{ pfx: 'C', fromKind: 'P', toKind: 'Q', from: 'p0', to: 'q0' }    // different transition (negative control)
];
const row = ( m, p ) => m.rows.find(( r ) => r.p === p );

test('baseline (no cache): every problem re-derives the structural method', async () => {
	const none = await mode('none', PROBLEMS, ( plan ) => ({ P: { plan: plan.plan } }));
	assert.equal(row(none, 'A').cost, 1);
	assert.equal(row(none, 'B').cost, 1, 'without transfer, B pays a full model call');
	assert.equal(row(none, 'C').cost, 1);
	assert.ok(row(none, 'B').ins.sound, 'baseline B is sound (derived in its own id-space)');
	assert.equal(row(none, 'B').ins.interKind, 'X~Y', 'baseline B derived the X→Y intermediate');
});

test('flat cache (SOUNDNESS control): replaying A’s absolute ids into B is UNSOUND — reproduces #30 live', async () => {
	const flat = await mode('flat', PROBLEMS, ( plan ) => {
		const cache = createProviderCache();
		return { P: cache.wrapFragment({ P: { plan: plan.plan } }, { 'P::plan': sigKey }).P };
	});
	assert.equal(row(flat, 'B').cost, 0, 'flat cache HITS on the shared typed signature (so it elides the call)…');
	assert.ok(row(flat, 'B').crashed || !row(flat, 'B').ins.sound,
		'…but the replay is UNSOUND — it injects A’s id-space into B (a crash or a foreign/dangling decomposition)');
});

test('F6 transform: cross-problem STRUCTURAL transfer is NON-ZERO + SOUND; a different transition still pays', async () => {
	const f6 = await mode('F6', PROBLEMS, ( plan ) => {
		const cache = createProviderCache();
		return { P: cache.wrapFragment({ P: { plan: plan.plan } }, { 'P::plan': sigKey }, { 'P::plan': transform }).P };
	});
	const A = row(f6, 'A'), B = row(f6, 'B'), C = row(f6, 'C');
	assert.equal(A.cost, 1, 'A is the cold derivation (warms the method)');
	// the headline: B replays at ZERO model calls AND lands a SOUND, rebased decomposition.
	assert.equal(B.cost, 0, 'B replays the structural decision at 0 model calls (the E0/#30 number, now non-zero)');
	assert.ok(B.ins.sound, 'B’s replayed decomposition is SOUND — rebased onto B’s own id-space');
	assert.deepEqual(B.ins.created, ['Broot_m0', 'Broot_a0', 'Broot_b0'], 'B’s created ids are all rebased onto B (no A leakage)');
	assert.equal(B.ins.interKind, 'X~Y', 'B replays the cached typed content (X→Y intermediate), identical to a fresh derivation');
	// NEGATIVE control: a different typed transition is a genuine miss — no false replay.
	assert.equal(C.cost, 1, 'C (a different typed transition) pays a real call — the cache keys on the K1 signature, no false replay');
	assert.ok(C.ins.sound);
});
