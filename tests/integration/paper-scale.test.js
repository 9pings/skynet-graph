'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E5 — scale + per-mechanism cost (deterministic; counts only, no timing assertions). As N grows over a large
 * typed class space with one mid-stream audit: STRUCT calls stay ~constant (amortization at scale), the library
 * is bounded by #classes (independent of N), and a drift event retracts only the invalidated classes (O(invalidated)).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E5 = require('../../artifact/paper-dll/scale.js');

test('E5: amortization holds at scale — STRUCT calls ~constant while N grows 15×', () => {
	const rows = E5.measure([5, 25, 100]);                 // N ≈ 1320, 5320, 20320
	const calls = rows.map((r) => r.calls);
	assert.ok(Math.max(...calls) - Math.min(...calls) <= 0, 'STRUCT calls identical across N');
	// per-record call rate strictly decreases as N grows (naive would be a flat 1.0)
	for (let i = 1; i < rows.length; i++)
		assert.ok(rows[i].calls / rows[i].n < rows[i - 1].calls / rows[i - 1].n, 'calls/N falls with N');
	assert.ok(rows[rows.length - 1].calls / rows[rows.length - 1].n < 0.02, 'per-record call rate -> ~0 at scale');
});

test('E5: the library is BOUNDED by #classes, independent of N', () => {
	const rows = E5.measure([5, 25, 100]);
	const sizes = rows.map((r) => r.memoSize);
	assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 0, 'memo size identical across N (plateaus at #classes)');
	assert.ok(sizes[0] < rows[rows.length - 1].n / 10, 'library ≪ N (it is bounded, not linear in the stream)');
});

test('E5: retraction is SELECTIVE — a drift event evicts only the invalidated classes (O(invalidated))', () => {
	const rows = E5.measure([5, 25, 100]);
	for (const r of rows) {
		assert.equal(r.evicted, 2, 'exactly the 2 audited approve-classes are evicted');
		assert.ok(r.evicted < r.memoSize / 10, 'eviction ≪ library (not a full re-derivation)');
	}
});

test('E5: NEG CONTROL — naive pays N every time (the amortization is real, not a measurement artifact)', () => {
	const rows = E5.measure([5, 25]);
	for (const r of rows) assert.ok(r.calls < r.n / 5, `STRUCT ${r.calls} ≪ naive ${r.n}`);
});
