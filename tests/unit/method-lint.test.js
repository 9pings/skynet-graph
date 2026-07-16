'use strict';
/**
 * BRICK 2 — the METHOD LINT: the 4 decidability invariants + the footprint/frame check that make the
 * "decidable line" CHECKED, not emergent (design doc §3 / C4; specialist review: the engineering make-or-break).
 *
 * lintMethod(def, opts) → { errors:[{method,kind,message,slot?}], warnings:[...] }  (mirrors validate.js).
 *
 * Invariants a method DEFINITION must satisfy (each parameter slot):
 *   (a) NAMED                — no empty slot name.
 *   (b) K1-TYPED             — no prose-typed slot/interface (a prose key re-keys every run → memo death).
 *   (c) BOUND-BY-REF         — never `infer:true`; a param sub-graph is SUPPLIED via a frontier, not solved-for.
 *   (c2) DECL ↔ IMPL         — the declared `frontier` matches the body's actual `@ref` holes.
 *   (d) TENTACLE-FIXED       — `frontier` is a fixed array (not '*' / variable arity).
 *   (e) FOOTPRINT/FRAME      — `post` keys ⊆ write-footprint, `pre` keys ⊆ read-footprint; no contract → WARNING.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relativize } = require('../../lib/authoring/core/abstract.js');
const { lintMethod } = require('../../lib/authoring/core/method.js');

// the body the `body` slot declares — a typed convert(elem)→Place sub-graph, parameterized on frontier `elem`.
const bodyParam = relativize(
	[ { _id: 'B_out', Node: true, kind: 'Place', from: 'ELEM' },
	  { _id: 'B_seg', Segment: true, originNode: 'ELEM', targetNode: 'B_out', label: 'convert' } ],
	{ base: 'B', refs: { elem: 'ELEM' } }
);

// a VALID Map method definition (mutated per test). coll = the CASES (role:case), body = the PARAM (role:param).
function validMap() {
	return {
		name: 'Map',
		slots: {
			coll: { role: 'case', kind: 'list', elem: 'POI' },
			body: { role: 'param', kind: 'subgraph', frontier: ['elem'], in: 'POI', out: 'Place' }
		},
		body: bodyParam,
		contract: { read: ['coll'], write: ['Map', 'kind', 'from'], pre: [], post: ['kind'], effect: 'pure' }
	};
}
const kindsOf = ( r ) => r.errors.map(( e ) => e.kind);

// 1 — baseline: a correct method passes clean (nothing over-flagged).
test('a valid method definition passes with no errors', () => {
	const r = lintMethod(validMap());
	assert.deepEqual(r.errors, [], 'no errors on a valid method: ' + JSON.stringify(r.errors));
});

// 2 — (a) named slots.
test('(a) an empty slot name is rejected', () => {
	const d = validMap(); d.slots[''] = { role: 'param', kind: 'enum', values: ['x'] };
	assert.ok(kindsOf(lintMethod(d)).includes('unnamed-slot'));
});

// 3 — (b) THE memo-death footgun: a prose-typed PARAM slot.
test('(b) a prose-typed param slot is rejected (memo death — the K1 barrier)', () => {
	const d = validMap(); d.slots.body.kind = 'prose';
	assert.ok(kindsOf(lintMethod(d)).includes('prose-slot'));
});

// 4 — (b) a sub-graph slot's typed interface must be typed too.
test('(b) a sub-graph slot with a prose in/out interface is rejected', () => {
	const d = validMap(); d.slots.body.in = 'text';
	assert.ok(kindsOf(lintMethod(d)).includes('prose-interface'));
});

// 5 — (b) a collection slot needs a typed element type.
test('(b) a collection slot without a typed elem is rejected', () => {
	const d = validMap(); delete d.slots.coll.elem;
	assert.ok(kindsOf(lintMethod(d)).includes('untyped-collection'));
});

// 6 — (b) the param/case ASYMMETRY: a CASE slot is high-cardinality (its values are NOT in the key), so it is
//      NOT flagged for carrying arbitrary value data — only its element TYPE must be typed.
test('(b) a case slot is NOT flagged for high-cardinality values (role/cut asymmetry)', () => {
	const d = validMap(); d.slots.coll.values = ['louvre', 'arc', 'sacre', 'eiffel'];   // arbitrary case data
	assert.deepEqual(kindsOf(lintMethod(d)).filter(( k ) => /prose|untyped/.test(k)), [], 'case values do not trip the K1 key check');
});

// 7 — (c) THE decidability cliff: an inferred (solved-for) slot.
test('(c) an infer:true slot is rejected (the undecidable cliff — never solve for a body)', () => {
	const d = validMap(); d.slots.body.infer = true;
	assert.ok(kindsOf(lintMethod(d)).includes('inference-slot'));
});

// 8 — (c) a param sub-graph must be SUPPLIED (have a frontier), not left unbound.
test('(c) a param sub-graph slot with no frontier is rejected (unbound param)', () => {
	const d = validMap(); delete d.slots.body.frontier;
	assert.ok(kindsOf(lintMethod(d)).includes('unbound-param'));
});

// 9 — (c2) DECLARATION ↔ IMPLEMENTATION consistency, BOTH directions.
test('(c2) a frontier declaring a ref the body never uses is rejected (declared-but-unused)', () => {
	const d = validMap(); d.slots.body.frontier = ['elem', 'ghost'];
	assert.ok(kindsOf(lintMethod(d)).includes('frontier-mismatch'));
});
test('(c2) a body using a ref the frontier never declares is rejected (used-but-undeclared)', () => {
	const d = validMap(); d.slots.body.frontier = [];   // body still uses @ref:elem
	assert.ok(kindsOf(lintMethod(d)).includes('frontier-mismatch'));
});

// 10 — (d) fixed tentacles.
test('(d) a variable/non-array frontier is rejected (variable tentacles)', () => {
	const d = validMap(); d.slots.body.frontier = '*';
	assert.ok(kindsOf(lintMethod(d)).includes('variable-tentacles'));
});

// 11/12 — (e) the FRAME check: post over the write-footprint, pre over the read-footprint.
test('(e) a postcondition over a key outside the write-footprint is a frame violation', () => {
	const d = validMap(); d.contract.post = ['notWritten'];
	assert.ok(kindsOf(lintMethod(d)).includes('frame-violation'));
});
test('(e) a precondition over a key outside the read-footprint is a frame violation', () => {
	const d = validMap(); d.contract.pre = ['notRead'];
	assert.ok(kindsOf(lintMethod(d)).includes('frame-violation'));
});

// 13 — (e/O4) the COST GRADIENT, not a cliff: no contract is ALLOWED but FLAGGED (→ runtime micro-LLM), not an error.
test('(e) an uncontracted method is a WARNING, not an error (the cost gradient, §0.1)', () => {
	const d = validMap(); delete d.contract;
	const r = lintMethod(d);
	assert.deepEqual(r.errors, [], 'no contract is not an error');
	assert.ok(r.warnings.some(( w ) => w.kind === 'uncontracted'), 'but it is flagged uncontracted');
});
