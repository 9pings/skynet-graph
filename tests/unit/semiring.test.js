'use strict';
/**
 * Semiring-parameterized reducer (lib/providers/semiring.js, experiments E1/E4). D and P are
 * one fold parameterized by the certainty algebra; coherence holds iff ⊕ is a commutative monoid.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reduceSemiring, SEMIRINGS, createSemiring, semiringConceptTree } = require('../../lib/providers');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

test('logodds (P): ⊕=+ then readout σ — reproduces E1 (κ=σ(0.8)=0.6899…)', () => {
	const r = reduceSemiring([0.5, 0.3], 'logodds');
	assert.equal(r.acc, 0.8);
	assert.ok(Math.abs(r.value - sigmoid(0.8)) < 1e-12);
	assert.ok(Math.abs(r.value - 0.6899744811) < 1e-9);
	assert.equal(r.n, 2);
});

test('boolean (D socle): ⊕=OR — any contribution holds', () => {
	assert.equal(reduceSemiring([false, false, true], 'boolean').value, true);
	assert.equal(reduceSemiring([false, false], 'boolean').value, false);
	assert.equal(reduceSemiring([], 'boolean').value, false, 'identity is false');
});

test('maxplus (best-path): ⊕=max; probor (noisy-OR): ⊕=a+b−ab', () => {
	assert.equal(reduceSemiring([1, 5, 3], 'maxplus').value, 5);
	assert.equal(reduceSemiring([], 'maxplus').value, -Infinity, 'identity is -Infinity');
	// noisy-OR of 0.5 and 0.5 = 0.75
	assert.ok(Math.abs(reduceSemiring([0.5, 0.5], 'probor').value - 0.75) < 1e-12);
});

test('coherence: a commutative ⊕ is ORDER-INVARIANT (E1 Théorème 1)', () => {
	const xs = [0.9, -0.4, 0.2, 0.7, -0.1];
	const base = reduceSemiring(xs, 'logodds').value;
	// 24 shuffles all agree (commutative monoid -> scheduler order is not semantic)
	const perms = [[...xs].reverse(), [xs[2], xs[0], xs[4], xs[1], xs[3]], [xs[4], xs[3], xs[2], xs[1], xs[0]]];
	for (const p of perms) assert.ok(Math.abs(reduceSemiring(p, 'logodds').value - base) < 1e-12, 'order-invariant');
});

test('a custom semiring is honoured (provenance-style plug-in)', () => {
	const r = reduceSemiring([2, 3, 10], { plus: Math.min, zero: Infinity, readout: (x) => x }); // min-semiring
	assert.equal(r.value, 2);
});

test('createSemiring exposes Semiring::reduce; semiringConceptTree wires the cardinality gate', () => {
	assert.equal(typeof createSemiring().Semiring.reduce, 'function');
	assert.ok(SEMIRINGS.logodds && SEMIRINGS.boolean && SEMIRINGS.maxplus && SEMIRINGS.probor);
	const t = semiringConceptTree({ semiring: 'logodds', contribKey: 'contribs' });
	assert.deepEqual(t.childConcepts.Reduce.provider, ['Semiring::reduce']);
	assert.deepEqual(t.childConcepts.Reduce.ensure, ['$contribs.length==$expected']);
});
