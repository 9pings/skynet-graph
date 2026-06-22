'use strict';
/**
 * Verification building blocks (roadmap #3): the deterministic checker library, the
 * majority vote, and the two providers in isolation (graph stubbed = the boundary).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVerifier, checks, majority } = require('../../lib/providers/verify');

test('deterministic checkers are total and side-effect-free', () => {
	assert.equal(checks.range(50, { min: 0, max: 100 }).pass, true);
	assert.equal(checks.range(150, { min: 0, max: 100 }).pass, false);
	assert.equal(checks.range('not-a-number', { min: 0, max: 100 }).pass, false, 'non-numeric fails closed');
	assert.equal(checks.oneOf('b', { values: ['a', 'b', 'c'] }).pass, true);
	assert.equal(checks.oneOf('z', { values: ['a', 'b'] }).pass, false);
	assert.equal(checks.equals(5, { to: 5 }).pass, true);
	assert.equal(checks.approx(99, { to: 100, tol: 2 }).pass, true);
	assert.equal(checks.approx(90, { to: 100, tol: 2 }).pass, false);
	assert.equal(checks.nonEmpty('', {}).pass, false);
	assert.equal(checks.nonEmpty([1], {}).pass, true);
});

test('majority returns value, agree, total and confidence = agree/total', () => {
	assert.deepEqual(majority(['A', 'A', 'B']), { value: 'A', agree: 2, total: 3, confidence: 2 / 3 });
	assert.deepEqual(majority(['x']), { value: 'x', agree: 1, total: 1, confidence: 1 });
	assert.equal(majority([]).confidence, 0, 'empty is a 0-confidence no-op');
});

test('Verify::check emits a distinct verdict fact + provenance, never touching the target', () => {
	const { Verify } = createVerifier();
	const concept = { _name: 'RC', _schema: { verify: { target: 'val', check: 'range', params: { min: 0, max: 100 }, as: 'x' } } };
	const graph = { getRef: (ref, scope) => (ref === 'val' ? scope._.val : undefined) };

	const pass = {};
	Verify.check(graph, concept, { _: { val: 50 } }, [], (e, r) => Object.assign(pass, r));
	assert.equal(pass.RC, true, 'self-flag set');
	assert.equal(pass.xVerdict, 'pass');
	assert.equal(pass.xVerified, true);
	assert.equal(pass.xVerifiedAgainst, 'range', 'provenance recorded');
	assert.equal(pass.val, undefined, 'never writes/overwrites the checked fact');

	const fail = {};
	Verify.check(graph, concept, { _: { val: 150 } }, [], (e, r) => Object.assign(fail, r));
	assert.equal(fail.xVerdict, 'fail');
	assert.equal(fail.xVerified, false);

	const unknown = {};
	Verify.check(graph, { _name: 'U', _schema: { verify: { target: 'val', check: 'nope' } } }, { _: { val: 1 } }, [], (e, r) => Object.assign(unknown, r));
	assert.equal(unknown.UVerdict, 'fail', 'an unknown checker fails closed');
});

test('Vote::tally emits majority consensus + confidence over a votes array', () => {
	const { Vote } = createVerifier();
	const concept = { _name: 'V', _schema: { vote: { votesKey: 'votes' } } };
	const graph = { getRef: (ref, scope) => (ref === 'votes' ? scope._.votes : undefined) };
	const out = {};
	Vote.tally(graph, concept, { _: { votes: ['A', 'A', 'B'] } }, [], (e, r) => Object.assign(out, r));
	assert.equal(out.V, true);
	assert.equal(out.consensus, 'A');
	assert.equal(out.confidence, 2 / 3);
	assert.equal(out.agree, 2);
	assert.equal(out.total, 3);
});
