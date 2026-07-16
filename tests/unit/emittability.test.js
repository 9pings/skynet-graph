'use strict';
/**
 * emittability — the signature-stability / paraphrase-consistency profiler (roadmap STAGE-0 Grammar-P1).
 * Hand-computable fixtures validate every formula and, crucially, the TWO failure modes stay DISTINCT
 * (Laurie confront): within-task agreement (fragmentation) vs pooled homogeneity (collision), plus the
 * chance-corrected vacuousness alarm (κ→null under mode collapse) and the format-netted cross-arm compare.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../lib/authoring/learning/emittability');

const typed = ( d ) => ({ status: 'typed', digest: d });
const untyped = () => ({ status: 'untyped', digest: undefined });
const approx = ( a, b, eps = 1e-9 ) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('perTaskStats: perfect within-task stability → collisionProb 1, single class', () => {
	const s = E.perTaskStats([typed('a'), typed('a'), typed('a'), typed('a')]);
	assert.equal(s.K, 4);
	assert.equal(s.typedRate, 1);
	approx(s.collisionProb, 1);
	approx(s.modalCoverage, 1);
	approx(s.effectiveSignatures, 1);
	assert.equal(s.numClasses, 1);
	assert.equal(E.perTaskStats([typed('a')]).collisionProb, null, 'K<2 → collisionProb undefined (null)');
});

test('perTaskStats: 50/50 fragmentation → unbiased collisionProb 1/3 (NOT modalCoverage 1/2)', () => {
	const s = E.perTaskStats([typed('a'), typed('a'), typed('b'), typed('b')]);
	approx(s.collisionProb, 1 / 3);           // Σ n(n-1)/K(K-1) = (2+2)/12
	approx(s.modalCoverage, 0.5);             // the biased secondary number
	approx(s.effectiveSignatures, 2);         // splinters into 2 memo keys
	assert.equal(s.numClasses, 2);
});

test('perTaskStats: untyped is its own ⊥ class; typedRate reported SEPARATELY (no survivorship bias)', () => {
	const s = E.perTaskStats([typed('a'), typed('a'), untyped(), untyped()]);
	assert.equal(s.typedRate, 0.5, 'typed-rate is a separate axis');
	approx(s.collisionProb, 1 / 3, 1e-9);     // classes {a:2, ⊥:2} — untyped counted, not dropped
	assert.equal(s.numClasses, 2);
	assert.equal(E.signatureClass(untyped()), E.UNTYPED);
});

test('poolAgreement: perfect (distinct tasks→distinct digests) → H=C=V=ARI=1', () => {
	const g = [
		{ taskId: 'T1', results: [typed('a'), typed('a'), typed('a'), typed('a')] },
		{ taskId: 'T2', results: [typed('b'), typed('b'), typed('b'), typed('b')] },
	];
	const p = E.poolAgreement(g);
	approx(p.homogeneity, 1); approx(p.completeness, 1); approx(p.vMeasure, 1); approx(p.ari, 1);
	approx(p.miBits, 1);
});

test('poolAgreement: MODE COLLAPSE (both tasks→same digest) → homogeneity 0, V 0, ARI 0 (collision caught)', () => {
	const g = [
		{ taskId: 'T1', results: [typed('a'), typed('a'), typed('a'), typed('a')] },
		{ taskId: 'T2', results: [typed('a'), typed('a'), typed('a'), typed('a')] },
	];
	const p = E.poolAgreement(g);
	approx(p.homogeneity, 0, 1e-9);           // each digest holds BOTH tasks → collision-fatal
	approx(p.completeness, 1);                 // within-task it looks perfect — the trap
	approx(p.vMeasure, 0, 1e-9);
	approx(p.ari, 0, 1e-9);
	approx(p.miBits, 0, 1e-9);
});

test('fleissKappa: the vacuousness alarm — mode collapse → κ null (raw agreement 1 but chance 1)', () => {
	const collapse = [
		{ taskId: 'T1', results: [typed('a'), typed('a'), typed('a'), typed('a')] },
		{ taskId: 'T2', results: [typed('a'), typed('a'), typed('a'), typed('a')] },
	];
	const k = E.fleissKappa(collapse);
	approx(k.Pbar, 1);                          // raw within-task agreement is perfect …
	approx(k.Pe, 1);                            // … but so is chance
	assert.equal(k.vacuous, true);
	assert.equal(k.kappa, null, 'κ refuses a verdict when agreement is indistinguishable from chance');

	const good = [
		{ taskId: 'T1', results: [typed('a'), typed('a'), typed('a'), typed('a')] },
		{ taskId: 'T2', results: [typed('b'), typed('b'), typed('b'), typed('b')] },
	];
	const kg = E.fleissKappa(good);
	approx(kg.Pbar, 1); approx(kg.Pe, 0.5); approx(kg.kappa, 1);   // (1-0.5)/(1-0.5)
	assert.equal(kg.vacuous, false);
});

test('crossArmAgreement: format NETTED OUT — only both-typed inputs compared', () => {
	const a = [typed('x'), typed('x'), typed('x')];              // constrained arm: always in-vocab
	const b = [typed('x'), typed('y'), untyped()];              // control: one flip, one format-fail
	const c = E.crossArmAgreement(a, b);
	assert.equal(c.nBothTyped, 2, 'the untyped input is excluded (not a semantic flip)');
	assert.equal(c.agree, 1);
	approx(c.agreeFraction, 0.5);               // semantic agreement on the in-vocab intersection
	approx(c.aTypedRate, 1); approx(c.bTypedRate, 2 / 3);
});

test('profile: aggregate keeps the replication unit = TASK, and per-field marginals localize instability', () => {
	// joint digest stable within task, but the `severity` field is the culprit in T2.
	const g = [
		{ taskId: 'T1', results: [
			{ status: 'typed', digest: 'c|h', facts: { bugClass: 'config', severity: 'high' } },
			{ status: 'typed', digest: 'c|h', facts: { bugClass: 'config', severity: 'high' } } ] },
		{ taskId: 'T2', results: [
			{ status: 'typed', digest: 'm|h', facts: { bugClass: 'memory', severity: 'high' } },
			{ status: 'typed', digest: 'm|m', facts: { bugClass: 'memory', severity: 'medium' } } ] },
	];
	const prof = E.profile(g, { fields: ['bugClass', 'severity'] });
	assert.equal(prof.nTasks, 2);
	// bugClass is perfectly stable in BOTH tasks; severity fragments in T2.
	approx(prof.marginals.bugClass.meanCollisionProb, 1);
	approx(prof.marginals.severity.meanCollisionProb, 0.5);   // T1: 1, T2: 0 → mean 0.5
	assert.ok(prof.marginals.severity.meanCollisionProb < prof.marginals.bugClass.meanCollisionProb,
		'the marginal pinpoints severity as the unstable field to demote');
});

test('_entropyOf: sanity — uniform binary = 1 bit, degenerate = 0', () => {
	approx(E._entropyOf(new Map([['a', 4], ['b', 4]]), 8), 1);
	approx(E._entropyOf(new Map([['a', 8]]), 8), 0);
});
