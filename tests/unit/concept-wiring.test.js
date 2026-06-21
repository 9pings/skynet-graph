'use strict';
/**
 * Integration test for the parser wiring: Concept._assertTest must now evaluate
 * concept asserts via the safe parser (compileExpression) instead of
 * `new Function`. Concept.js is plain CommonJS, so it loads without the webpack
 * build — exercising the real wiring end to end.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Concept = require('../../App/objects/Concept');

// Minimal graph stub: Concept.init only needs `_conceptLib` to register itself.
function makeConcept(schema) {
	return new Concept(schema, { _conceptLib: {} });
}

// A scope stub providing getRef, like an Entity does at assert time.
function scope(facts) {
	return { getRef: (ref) => (Object.prototype.hasOwnProperty.call(facts, ref) ? facts[ref] : undefined) };
}

test('Concept._assertTest evaluates a real assert via the safe parser (Edge/Travel/LongTravel)', () => {
	const c = makeConcept({ _id: 'LongTravel', assert: ['$Distance.inKm > 300'] });
	assert.equal(c._assertTest(scope({ 'Distance.inKm': 500 })), true);
	assert.equal(c._assertTest(scope({ 'Distance.inKm': 100 })), false);
});

test('Concept._assertTest defaults to true when there are no asserts', () => {
	const c = makeConcept({ _id: 'Vertice' });
	assert.equal(c._assertTest(scope({})), true);
});

test('Concept.init folds `ensure` clauses into the assert (AND)', () => {
	const c = makeConcept({ _id: 'Y', assert: ['$a'], ensure: ['$b'] });
	assert.ok(c._assertTest(scope({ a: 1, b: 1 })));
	assert.ok(!c._assertTest(scope({ a: 1 }))); // b missing -> falsy
});

test('Concept._assertTest handles a cross-object ref walk (aetheris-style)', () => {
	const c = makeConcept({ _id: 'Dep', assert: ["$originNode:TimeStep.type == 'fixed'"] });
	assert.ok(c._assertTest(scope({ 'originNode:TimeStep.type': 'fixed' })));
	assert.ok(!c._assertTest(scope({ 'originNode:TimeStep.type': 'now' })));
});
