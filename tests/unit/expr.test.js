'use strict';
/**
 * Tests for the safe expression evaluator that replaces `new Function()`
 * across the engine (Concept asserts, Graph.queryMaps/getChildMatching,
 * Entity.doEval/test, PathMap queries).
 *
 * The grammar is the concept mini-DSL: `$ref` tokens resolved via an injected
 * resolver, numeric arithmetic, comparisons, logical operators and grouping.
 * Every string expression below is either taken verbatim from concepts/common
 * or is a minimal variation exercising one grammar feature.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileExpression } = require('../../lib/graph/expr');

// A resolver standing in for `scope.getRef(refName)`: the engine delegates
// dotted/colon path walking to getRef, so the resolver is keyed by the full
// ref string ("Distance.inKm"), exactly as getRef receives it.
function resolverFrom(facts) {
	return function resolve(ref) {
		return Object.prototype.hasOwnProperty.call(facts, ref) ? facts[ref] : undefined;
	};
}

test('ref compared to a number (Edge/Travel: "$Distance.inKm!=0")', () => {
	const fn = compileExpression('$Distance.inKm!=0');
	assert.equal(fn(resolverFrom({ 'Distance.inKm': 320 })), true);
	assert.equal(fn(resolverFrom({ 'Distance.inKm': 0 })), false);
});

test('greater-than (Edge/Travel/LongTravel: "$Distance.inKm > 300")', () => {
	const fn = compileExpression('$Distance.inKm > 300');
	assert.equal(fn(resolverFrom({ 'Distance.inKm': 301 })), true);
	assert.equal(fn(resolverFrom({ 'Distance.inKm': 300 })), false);
});

test('less-than with trailing whitespace (Edge/Travel/ShortTravel: "$Distance.inKm < 300 ")', () => {
	const fn = compileExpression('$Distance.inKm < 300 ');
	assert.equal(fn(resolverFrom({ 'Distance.inKm': 120 })), true);
	assert.equal(fn(resolverFrom({ 'Distance.inKm': 300 })), false);
});

test('arithmetic precedence and || (Edge/Stay/LongStay)', () => {
	// "$TimePeriod.length > 1000*60*60*24 || $FuzzyTimePeriod.length > 1000*60*60*24"
	const expr = '$TimePeriod.length > 1000*60*60*24 || $FuzzyTimePeriod.length > 1000*60*60*24';
	const fn = compileExpression(expr);
	const day = 1000 * 60 * 60 * 24;
	assert.equal(fn(resolverFrom({ 'TimePeriod.length': day + 1 })), true);
	assert.equal(fn(resolverFrom({ 'FuzzyTimePeriod.length': day + 1 })), true);
	assert.equal(fn(resolverFrom({ 'TimePeriod.length': 10, 'FuzzyTimePeriod.length': 10 })), false);
});

test('logical NOT on a ref-as-truthy (Edge/Stay: "!$Travel")', () => {
	const fn = compileExpression('!$Travel');
	assert.equal(fn(resolverFrom({ Travel: true })), false);
	assert.equal(fn(resolverFrom({})), true); // undefined ref -> !undefined -> true
});

test('mixed || && == with refs as truthy (Edge/Stay second assert)', () => {
	// "$Undefined||$Distance&&$Distance.inKm==0"  (&& binds tighter than ||)
	const fn = compileExpression('$Undefined||$Distance&&$Distance.inKm==0');
	assert.equal(fn(resolverFrom({ Undefined: true })), true);
	assert.equal(fn(resolverFrom({ Distance: {}, 'Distance.inKm': 0 })), true);
	assert.equal(fn(resolverFrom({ Distance: {}, 'Distance.inKm': 5 })), false);
	assert.ok(!fn(resolverFrom({}))); // undefined || (undefined && ...) -> undefined (falsy)
});

test('array of expressions is AND-joined (Edge/Stay full assert)', () => {
	const fn = compileExpression(['!$Travel', '$Undefined||$Distance&&$Distance.inKm==0']);
	assert.equal(fn(resolverFrom({ Undefined: true })), true); // !Travel && Undefined
	assert.equal(fn(resolverFrom({ Travel: true, Undefined: true })), false); // Travel present -> !Travel false
});

test('empty source returns the configured fallback', () => {
	assert.equal(compileExpression([])(resolverFrom({})), true); // default fallback true (Concept/queryMaps)
	assert.equal(compileExpression('')(resolverFrom({})), true);
	assert.equal(compileExpression([], { empty: false })(resolverFrom({})), false); // getChildMatching/test fallback
});

test('parentheses override precedence', () => {
	assert.ok(!compileExpression('(1 || 0) && 0')(resolverFrom({}))); // (truthy) && 0 -> 0 (falsy)
	assert.ok(compileExpression('1 || 0 && 0')(resolverFrom({})));    // 1 || (0 && 0) -> 1 (truthy)
});

test('double-dollar ref passes the inner $ to the resolver (bagRef/literal-id syntax)', () => {
	// `$$_id` in templates means getRef("$_id"); the parser keeps the inner $.
	const seen = [];
	compileExpression('$$_id == 1')(function (ref) { seen.push(ref); return 1; });
	assert.deepEqual(seen, ['$_id']);
});

test('runtime resolver error yields undefined (faithful to original try/catch)', () => {
	const fn = compileExpression('$boom > 1');
	assert.equal(fn(function () { throw new Error('getRef blew up'); }), undefined);
});

test('strict equality and inequality operators', () => {
	assert.equal(compileExpression('$a === 1')(resolverFrom({ a: 1 })), true);
	assert.equal(compileExpression('$a !== 1')(resolverFrom({ a: 2 })), true);
});

test('bare identifiers resolve against the optional names map (doEval with(refMap))', () => {
	// Entity.doEval wraps the body in `with(refMap)`, so bare names resolve there.
	const fn = compileExpression('$a > threshold');
	assert.equal(fn(resolverFrom({ a: 50 }), { threshold: 10 }), true);
	assert.equal(fn(resolverFrom({ a: 5 }), { threshold: 10 }), false);
});

test('keyword literals true/false/null', () => {
	assert.equal(compileExpression('true')(resolverFrom({})), true);
	assert.equal(compileExpression('false')(resolverFrom({})), false);
	assert.equal(compileExpression('$a == null')(resolverFrom({ a: null })), true);
});

// ---- Coverage grounded in aetheris-graph QueryBased concepts (the rich set) ----

test('single-quoted string literal (aetheris: "$Record._cls == \'City\'")', () => {
	const fn = compileExpression("$Record._cls == 'City'");
	assert.equal(fn(resolverFrom({ 'Record._cls': 'City' })), true);
	assert.equal(fn(resolverFrom({ 'Record._cls': 'Town' })), false);
});

test('ref walk across linked objects with member + string (aetheris departure assert)', () => {
	// "$originNode:TimeStep && $originNode:TimeStep.type == 'fixed'"
	// The whole colon/dot path is one ref handed to getRef; member access is folded in.
	const fn = compileExpression("$originNode:TimeStep && $originNode:TimeStep.type == 'fixed'");
	assert.equal(fn(resolverFrom({ 'originNode:TimeStep': {}, 'originNode:TimeStep.type': 'fixed' })), true);
	assert.ok(!fn(resolverFrom({ 'originNode:TimeStep': {}, 'originNode:TimeStep.type': 'now' })));
	assert.ok(!fn(resolverFrom({}))); // originNode:TimeStep absent -> falsy
});

test('big grouped expression (aetheris: departureTM || (fixed origin) || (fixed target))', () => {
	const expr = "$departureTM || ( $originNode:TimeStep && $originNode:TimeStep.type == 'fixed' ) || ( $targetNode:TimeStep && $targetNode:TimeStep.type == 'fixed' )";
	const fn = compileExpression(expr);
	assert.ok(fn(resolverFrom({ departureTM: true })));
	assert.ok(fn(resolverFrom({ 'targetNode:TimeStep': {}, 'targetNode:TimeStep.type': 'fixed' })));
	assert.ok(!fn(resolverFrom({})));
});

test('ref-as-truthy guard with parens (aetheris: "$Distance.inKm && ($Distance.inKm < 600)")', () => {
	const fn = compileExpression('$Distance.inKm && ($Distance.inKm < 600)');
	assert.ok(fn(resolverFrom({ 'Distance.inKm': 120 })));
	assert.ok(!fn(resolverFrom({ 'Distance.inKm': 700 })));
	assert.ok(!fn(resolverFrom({}))); // undefined -> falsy
});

// ---- Un-capped capability: full expression grammar must be available ----

test('index access on a resolved ref (literal and computed)', () => {
	assert.equal(compileExpression('$arr[0] == 5')(resolverFrom({ arr: [5, 9] })), true);
	assert.equal(compileExpression('$arr[$i]')(resolverFrom({ arr: [5, 9], i: 1 })), 9);
});

test('method call on a resolved value', () => {
	// NOTE: `$s.indexOf` would be captured as the ref path "s.indexOf" (greedy,
	// faithful to the original engine — getRef walks dotted paths). To call a
	// method on the resolved value, group the ref: `($s).indexOf(...)`.
	const fn = compileExpression("($s).indexOf('x') != -1");
	assert.equal(fn(resolverFrom({ s: 'axb' })), true);
	assert.equal(fn(resolverFrom({ s: 'abc' })), false);
});

test('ternary conditional', () => {
	const fn = compileExpression('$x > 1 ? $y : 0');
	assert.equal(fn(resolverFrom({ x: 5, y: 42 })), 42);
	assert.equal(fn(resolverFrom({ x: 0, y: 42 })), 0);
});

test('curated safe globals are available (Math)', () => {
	assert.equal(compileExpression('Math.max($x, $y) == 5')(resolverFrom({ x: 3, y: 5 })), true);
});

test('array literal and its methods', () => {
	assert.equal(compileExpression('[1,2,3].length == 3')(resolverFrom({})), true);
});

// ---- Security: the prototype-escape must NOT be reachable (the point of dropping eval) ----

test('constructor/__proto__ access is blocked (no Function escape)', () => {
	// Classic sandbox escape: "".constructor.constructor("...")() === Function("...")()
	const escape = compileExpression("$s.constructor.constructor('return 42')()");
	assert.equal(escape(resolverFrom({ s: 'x' })), undefined); // blocked -> caught -> undefined
	assert.equal(compileExpression('$s.__proto__')(resolverFrom({ s: 'x' })), undefined);
	assert.equal(compileExpression("$o['constructor']")(resolverFrom({ o: {} })), undefined); // computed too
});

// ---- Stratified set-aggregation (#8): count / all / any over a {__push}ed value array ----

test('count over a value array with a comparison predicate (k-of-n gate)', () => {
	const votes = ['yes', 'no', 'yes', 'yes'];
	assert.equal(compileExpression("count($votes,'==','yes')")(resolverFrom({ votes })), 3);
	// the canonical k-of-n consensus gate
	assert.equal(compileExpression("count($votes,'==','yes') >= 3")(resolverFrom({ votes })), true);
	assert.equal(compileExpression("count($votes,'==','no') >= 3")(resolverFrom({ votes })), false);
	// numeric predicate
	assert.equal(compileExpression("count($s,'>=',0.5)")(resolverFrom({ s: [0.2, 0.7, 0.9, 0.4] })), 2);
});

test('count with no predicate = count of truthy values', () => {
	assert.equal(compileExpression('count($a)')(resolverFrom({ a: [1, 0, 3, '', 'x'] })), 3);
	// an all-truthy array: count == its length (provide the walked "a.length" key like getRef would)
	assert.equal(compileExpression('count($a) == $a.length')(resolverFrom({ a: [1, 2, 3], 'a.length': 3 })), true);
});

test('all / any over a value array', () => {
	assert.equal(compileExpression("all($s,'>=',0.5)")(resolverFrom({ s: [0.6, 0.9, 0.5] })), true);
	assert.equal(compileExpression("all($s,'>=',0.5)")(resolverFrom({ s: [0.6, 0.4] })), false);
	assert.equal(compileExpression("any($s,'>',0.9)")(resolverFrom({ s: [0.6, 0.95] })), true);
	assert.equal(compileExpression('all($flags)')(resolverFrom({ flags: [true, true] })), true);
	assert.equal(compileExpression('any($flags)')(resolverFrom({ flags: [false, false] })), false);
});

test('aggregation edge cases: empty is vacuously all-true; a not-yet-present ref is all-false', () => {
	assert.equal(compileExpression('all($s)')(resolverFrom({ s: [] })), true, 'vacuous all on []');
	assert.equal(compileExpression('any($s)')(resolverFrom({ s: [] })), false);
	// a ref that has not appeared yet (undefined) -> all/any false (gate stays closed), count 0
	assert.equal(compileExpression('all($missing)')(resolverFrom({})), false, 'non-array -> not satisfied');
	assert.equal(compileExpression('count($missing)')(resolverFrom({})), 0);
});

