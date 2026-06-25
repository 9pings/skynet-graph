'use strict';
/**
 * Pareto / skyline selection as a semiring (Laurie's framing: skyline-of-union is an idempotent
 * commutative monoid → it folds in the SAME reducer as logodds/maxplus, inheriting E1 order-
 * independence). The multi-criteria SELECTION operator for the support grammar's Candidate/Selected
 * cluster: étage 1 = Pareto front (prune dominated, no weighting); étage 2 = pluggable tie-break
 * (default lexicographic-on-bands). Dominance on DISCRETE BAND RANKS (barrier-clean, deterministic).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	paretoFront, dominates, makePareto, paretoSelect, createSemiring, reduceSemiring
} = require('../../lib/providers/semiring.js');

// criteria as ORDERED band lists, worst → best (the order IS the preference direction; polarity folded in)
const CRIT = { conf: ['low', 'med', 'high'], cost: ['expensive', 'mid', 'cheap'] };
const ids = (pts) => pts.map((p) => p.id).sort();

test('paretoFront keeps the non-dominated trade-offs, drops the dominated', () => {
	const P = { id: 'P', conf: 'high', cost: 'mid' };   // best conf
	const Q = { id: 'Q', conf: 'med', cost: 'cheap' };  // best cost
	const R = { id: 'R', conf: 'low', cost: 'expensive' }; // dominated by both
	assert.deepEqual(ids(paretoFront([P, Q, R], CRIT)), ['P', 'Q'], 'P,Q incomparable; R dominated');
});

test('a point better-or-equal on all and strictly better on one dominates (strict Pareto)', () => {
	const S = { id: 'S', conf: 'high', cost: 'cheap' };
	const P = { id: 'P', conf: 'high', cost: 'mid' };
	assert.equal(dominates(S, P, CRIT), true, 'S ≥ on conf, > on cost → dominates');
	assert.equal(dominates(P, S, CRIT), false);
	assert.deepEqual(ids(paretoFront([S, P, { id: 'Q', conf: 'med', cost: 'cheap' }], CRIT)), ['S'], 'S dominates all');
});

test('ties are KEPT (weak-equal points do not dominate each other)', () => {
	const A = { id: 'A', conf: 'high', cost: 'mid' };
	const B = { id: 'B', conf: 'high', cost: 'mid' };
	assert.equal(dominates(A, B, CRIT), false, 'identical → no strict domination');
	assert.deepEqual(ids(paretoFront([A, B], CRIT)), ['A', 'B'], 'both survive');
});

test('numeric criteria with explicit polarity (max / min)', () => {
	const crit = { score: { dir: 'max' }, latency: { dir: 'min' } };
	const A = { id: 'A', score: 9, latency: 100 };
	const B = { id: 'B', score: 7, latency: 50 };
	const C = { id: 'C', score: 9, latency: 50 };  // ≥ both, > each → dominates both
	assert.deepEqual(ids(paretoFront([A, B], crit)), ['A', 'B'], 'lower latency is better → incomparable');
	assert.deepEqual(ids(paretoFront([A, B, C], crit)), ['C']);
});

test('makePareto is an idempotent commutative monoid → the front is ORDER-INVARIANT (E1)', () => {
	const pts = [
		{ id: 'P', conf: 'high', cost: 'mid' }, { id: 'Q', conf: 'med', cost: 'cheap' },
		{ id: 'R', conf: 'low', cost: 'expensive' }, { id: 'S', conf: 'med', cost: 'mid' }
	];
	const sr = makePareto(CRIT);
	const base = ids(reduceSemiring(pts, sr).value);
	const perms = [[...pts].reverse(), [pts[2], pts[0], pts[3], pts[1]], [pts[3], pts[1], pts[2], pts[0]]];
	for (const p of perms) assert.deepEqual(ids(reduceSemiring(p, sr).value), base, 'fold order is not semantic');
	assert.deepEqual(base, ['P', 'Q'], 'S dominated by P; R by both');
});

test('paretoSelect: étage-2 lexicographic tie-break picks within the front, by criterion priority', () => {
	const pts = [{ id: 'P', conf: 'high', cost: 'mid' }, { id: 'Q', conf: 'med', cost: 'cheap' }];
	assert.equal(paretoSelect(pts, CRIT, { lex: ['conf', 'cost'] }).selectedId, 'P', 'conf-first → P');
	assert.equal(paretoSelect(pts, CRIT, { lex: ['cost', 'conf'] }).selectedId, 'Q', 'cost-first → Q');
	const sel = paretoSelect(pts, CRIT, { lex: ['conf', 'cost'] });
	assert.deepEqual(sel.frontIds.sort(), ['P', 'Q']);
	assert.equal(sel.n, 2);
});

test('paretoSelect: a full tie is broken DETERMINISTICALLY by id (reproducible run-to-run)', () => {
	const a = { id: 'T2', conf: 'high', cost: 'mid' }, b = { id: 'T1', conf: 'high', cost: 'mid' };
	assert.equal(paretoSelect([a, b], CRIT).selectedId, 'T1');
	assert.equal(paretoSelect([b, a], CRIT).selectedId, 'T1', 'input order does not change the pick');
});

test('Semiring::reduce wires the pareto family — emits selectedId / frontSize / frontIds (barrier-clean)', () => {
	const reduce = createSemiring().Semiring.reduce;
	const scope = { contribs: [
		{ id: 'P', conf: 'high', cost: 'mid' }, { id: 'Q', conf: 'med', cost: 'cheap' },
		{ id: 'R', conf: 'low', cost: 'expensive' }
	] };
	const graph = { getRef: (k, s) => s[k] };
	const concept = { _name: 'Select', _schema: { semiring: {
		semiring: 'pareto', criteria: CRIT, contribKey: 'contribs', lex: ['conf', 'cost'], as: ''
	} } };
	let facts = null;
	reduce(graph, concept, scope, null, (e, f) => { facts = f; });
	assert.equal(facts.Select, true);
	assert.equal(facts.selectedId, 'P', 'conf-first lexicographic pick of the front');
	assert.equal(facts.frontSize, 2);
	assert.deepEqual(facts.frontIds.sort(), ['P', 'Q']);
	assert.equal(facts.n, 3);
});
