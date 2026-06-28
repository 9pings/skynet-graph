'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P4 — the K1-coverage ceiling, OWNED (the reviewer's #1 attack). On a mixed workload (typed + prose), measured
 * via the REAL canon barrier (`canonValue`): amortization is a GRADIENT in coverage; STRUCT stays SOUND at every
 * coverage (the non-K1 fraction is a micro-LLM cost, never a soundness cliff); amortizing BEYOND K1 (greedy) is
 * UNSOUND → the ceiling is a soundness boundary. Holds on two domains; deterministic.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P4 = require('../../artifact/paper-dll/p4-coverage.js');

for ( const domain of ['approval', 'triage'] ) {
	test(`P4 [${domain}]: amortization is a GRADIENT in coverage, STRUCT sound throughout`, () => {
		const sw = P4.sweep(domain, 200);
		// monotone non-decreasing amortization (the honest bound: more typed coverage -> more elision)
		for ( let i = 1; i < sw.length; i++ )
			assert.ok(sw[i].amort >= sw[i - 1].amort, `amort rises with coverage (${sw[i - 1].amort}->${sw[i].amort})`);
		assert.ok(sw[sw.length - 1].amort > sw[0].amort, 'a real gradient, not flat');
		// sustained soundness: STRUCT correct at EVERY coverage (no cliff)
		assert.ok(sw.every((r) => r.structAcc === 1), 'STRUCT sound at every coverage');
		// the measured K1-coverage tracks the workload's typed fraction (the canonValue barrier is the classifier)
		for ( const r of sw ) assert.ok(Math.abs(r.measuredCoverage - r.p) < 0.02, `measured coverage ≈ set (${r.measuredCoverage} vs ${r.p})`);
	});

	test(`P4 [${domain}]: NEG CONTROL — amortizing BEYOND K1 (greedy) is UNSOUND (the ceiling is a soundness boundary)`, () => {
		const sw = P4.sweep(domain, 200);
		for ( const r of sw.filter((x) => x.p > 0 && x.p < 1) )
			assert.ok(r.greedyAcc < 1, `greedy unsound at coverage ${r.p} (acc ${r.greedyAcc}) while STRUCT stays ${r.structAcc}`);
		// at the extremes (all-typed or all-prose) there is no clean/messy mix → greedy is incidentally sound
		assert.equal(sw.find((x) => x.p === 0).greedyAcc, 1);
		assert.equal(sw.find((x) => x.p === 1).greedyAcc, 1);
	});
}

test('P4: the K1 classifier is the REAL canon barrier — an out-of-vocab field misses (non-K1)', () => {
	const d = P4.DOMAINS.approval;
	assert.equal(P4.k1Classify({ kind: 'loan', region: 'EU', score: 'high' }, d).k1, true, 'fully typed -> K1');
	assert.equal(P4.k1Classify({ kind: 'crypto-loan', region: 'EU', score: 'high' }, d).k1, false, 'out-of-vocab kind -> canonValue miss -> non-K1');
	assert.equal(P4.k1Classify({ kind: 'loan', region: 'EU', score: 'high', note: 'x' }, d).k1, false, 'a prose note -> non-K1');
});

test('P4: deterministic — two identical sweeps produce identical results', () => {
	assert.equal(JSON.stringify(P4.sweep('approval', 200)), JSON.stringify(P4.sweep('approval', 200)));
	assert.equal(JSON.stringify(P4.sweep('triage', 200)), JSON.stringify(P4.sweep('triage', 200)));
});
