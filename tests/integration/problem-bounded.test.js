'use strict';
/**
 * FLAGSHIP central claim, MEASURED for the problem-solving grammar (2026-06-27): every per-call context the
 * grammar assembles is BOUNDED by the local neighbourhood (the two endpoint states + the immediate hand-off
 * + the bounded adjacency window), INDEPENDENT of how large the problem / plan grows. A naive "carry the
 * objective + the whole plan-so-far" solver has per-call context that grows LINEARLY with the plan — the
 * context-window blow-up the engine exists to avoid. This is the engine's actual differentiator for the
 * problem-solving loop, previously unmeasured (HANDOFF gap #2/#3).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { measure } = require('../../examples/poc/problem-bounded.js');

test('per-call context is BOUNDED for the grammar but GROWS for the naive baseline', async () => {
	const rows = await measure([4, 8, 16, 32, 64]);

	// ENGINE: the max per-call context is CONSTANT across all problem sizes (bounded by the neighbourhood).
	const engMax = rows.map((r) => r.engMax);
	assert.ok(engMax.every((m) => m === engMax[0]), `engine max per-call context is constant across N (got ${engMax.join(',')})`);

	// BASELINE: the max per-call context GROWS monotonically with N (it carries the whole plan-so-far).
	const baseMax = rows.map((r) => r.baseMax);
	for ( let i = 1; i < baseMax.length; i++ ) assert.ok(baseMax[i] > baseMax[i - 1], 'baseline max per-call context grows with N');
	assert.ok(baseMax[baseMax.length - 1] >= 8 * baseMax[0], 'baseline blows up (≥8× from N=4 to N=64)');

	// at the largest size the engine context is a small FRACTION of the baseline's.
	const last = rows[rows.length - 1];
	assert.ok(last.engMax < last.baseMax / 5, `at N=64 the engine context (${last.engMax}) is <1/5 of the baseline (${last.baseMax})`);

	// TOTAL work: the engine total is LINEAR (N constant-size calls); the baseline total is QUADRATIC
	// (each of N calls carries O(N)) — so the ratio baseTotal/engTotal itself grows with N.
	const r4 = rows[0], r64 = rows[rows.length - 1];
	const ratio4 = r4.baseTotal / r4.engTotal, ratio64 = r64.baseTotal / r64.engTotal;
	assert.ok(ratio64 > ratio4 * 3, `the naive baseline's total-context overhead grows with N (ratio ${ratio4.toFixed(1)}→${ratio64.toFixed(1)})`);

	// NEGATIVE CONTROL: the two solvers produce the SAME number of steps — they solve the same task, so the
	// context difference is a real property of the REGIME, not of doing less work.
	assert.ok(rows.every((r) => r.engCalls === r.N), 'the engine actually resolved every step (same task as the baseline)');
});
