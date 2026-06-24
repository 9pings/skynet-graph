'use strict';
/**
 * Merge-consistency operator (lib/providers/merge-consistency.js) — the sheaf C1 brick.
 * The decisive property (E6): the monoid combine collapses confident-conflict and genuine-
 * neutral to the SAME κ=0.5; the consistency radius ε, snapped to a band, disambiguates them.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bandOf } = require('../../lib/providers/merge-consistency');
// the facade (lib/providers) re-exports the operator + factory + tree fragment:
const { mergeConsistency, consistencyBandOf, createConsistency, consistencyConceptTree } = require('../../lib/providers');
assert.equal(bandOf, consistencyBandOf, 'facade re-exports the same bandOf');

test('combines log-odds partials: ell=Σ, kappa=σ(ell), eps=max−min', () => {
	const r = mergeConsistency([1.5, 1.2]);
	assert.equal(r.ell, 2.7);
	assert.ok(Math.abs(r.kappa - 1 / (1 + Math.exp(-2.7))) < 1e-12);
	assert.ok(Math.abs(r.eps - 0.3) < 1e-12);
	assert.equal(r.label, 'agree');
	assert.equal(r.rank, 0);
	assert.equal(r.n, 2);
});

test('DECISIVE: confident-conflict and genuine-neutral have IDENTICAL κ but opposite ε band', () => {
	const conflict = mergeConsistency([2.5, -2.5]);   // confident YES vs confident NO
	const neutral  = mergeConsistency([0.1, -0.1]);   // genuinely neutral
	// the monoid combine cannot tell them apart
	assert.ok(Math.abs(conflict.kappa - 0.5) < 1e-12);
	assert.ok(Math.abs(neutral.kappa - 0.5) < 1e-12);
	assert.ok(Math.abs(conflict.kappa - neutral.kappa) < 1e-12, 'same κ — combine loses the disagreement');
	// ε restores the lost dimension
	assert.equal(conflict.eps, 5);
	assert.ok(Math.abs(neutral.eps - 0.2) < 1e-12);
	assert.equal(conflict.label, 'conflict');
	assert.equal(neutral.label, 'agree');
	assert.notEqual(conflict.rank, neutral.rank, 'ε disambiguates them');
});

test('band boundaries: agree <1, borderline <3, conflict ≥3 (custom bands honoured)', () => {
	assert.equal(bandOf(0).label, 'agree');
	assert.equal(bandOf(0.99).label, 'agree');
	assert.equal(bandOf(1).label, 'borderline');     // ε==1 is no longer "agree"
	assert.equal(bandOf(2.99).label, 'borderline');
	assert.equal(bandOf(3).label, 'conflict');
	assert.equal(bandOf(100).label, 'conflict');     // catch-all
	// custom 2-band table
	const bands = [{ max: 2, label: 'ok', rank: 0 }, { label: 'bad', rank: 1 }];
	assert.equal(mergeConsistency([2.5, -2.5], { bands }).label, 'bad');
	assert.equal(mergeConsistency([0.5, -0.5], { bands }).label, 'ok');
});

test('a single partial has zero disagreement; empty has zero everything', () => {
	const one = mergeConsistency([1.8]);
	assert.equal(one.eps, 0);
	assert.equal(one.label, 'agree');
	const none = mergeConsistency([]);
	assert.equal(none.ell, 0);
	assert.equal(none.kappa, 0.5);
	assert.equal(none.n, 0);
});

test('createConsistency exposes a Merge::combine provider; tree fragment wires Combine+Reconcile', () => {
	const frag = createConsistency();
	assert.equal(typeof frag.Merge.combine, 'function');
	const tree = consistencyConceptTree({ partials: ['ellA', 'ellB'] });
	const combine = tree.childConcepts.Combine;
	assert.deepEqual(combine.require, ['ellA', 'ellB']);
	assert.deepEqual(combine.provider, ['Merge::combine']);
	// the pure-D Reconcile gate keys on the SNAPPED rank (no raw float on the gate — barrier)
	assert.deepEqual(combine.childConcepts.Reconcile.ensure, ['$mergeConsistencyRank>=2']);
});
