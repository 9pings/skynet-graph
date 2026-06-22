'use strict';
/**
 * The deterministic canonicalizer — the grid that defeats K1 (prose
 * memo-fragmentation): textually-divergent-but-semantically-equal LLM outputs must
 * snap onto the SAME discrete fact, so the memo key is stable across runs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonValue, canonFacts, digest } = require('../../lib/providers/canonicalize');

test('enum snaps to a closed vocabulary (exact, then case/whitespace-normalized)', () => {
	const spec = { enum: ['low', 'medium', 'high'] };
	assert.deepEqual(canonValue('high', spec), { value: 'high' });
	assert.deepEqual(canonValue('  HIGH ', spec), { value: 'high' }, 'normalized match -> canonical form');
	assert.deepEqual(canonValue('High', spec), { value: 'high' });
});

test('enum fails CLOSED on an out-of-vocab value (never a silent wrong snap)', () => {
	const spec = { enum: ['low', 'medium', 'high'], default: 'medium' };
	assert.deepEqual(canonValue('catastrophic', spec), { value: 'medium', miss: true });
	assert.deepEqual(canonValue('catastrophic', { enum: ['low', 'high'] }), { value: null, miss: true });
});

test('grain rounds a numeric to the nearest multiple (textual price wobble collapses)', () => {
	assert.equal(canonValue(1203.40, { grain: 100 }).value, 1200);
	assert.equal(canonValue(1203, { grain: 100 }).value, 1200, 'different prose, same bucket');
	assert.equal(canonValue('1249.99', { grain: 100 }).value, 1200, 'coerces a numeric string');
	assert.equal(canonValue(0.07, { grain: 0.1 }).value, 0.1, 'fractional grain keeps its decimals (no float dust)');
	assert.deepEqual(canonValue('NaN-ish', { grain: 100, default: 0 }), { value: 0, miss: true });
});

test('typed coercion: int / number / bool / id / string', () => {
	assert.equal(canonValue('3.7', { type: 'int' }).value, 4);
	assert.equal(canonValue('3.7', { type: 'number' }).value, 3.7);
	assert.equal(canonValue('YES', { type: 'bool' }).value, true);
	assert.equal(canonValue('0', { type: 'bool' }).value, false);
	assert.equal(canonValue('  node-7 ', { type: 'id' }).value, 'node-7');
	assert.equal(canonValue('a   b\tc', { type: 'string' }).value, 'a b c', 'collapses inner whitespace');
});

test('canonValue is idempotent (canon(canon(x)) == canon(x))', () => {
	for ( const [v, spec] of [['HIGH', { enum: ['low', 'high'] }], [1203.4, { grain: 100 }], ['3.7', { type: 'int' }]] ) {
		const once = canonValue(v, spec).value;
		assert.deepEqual(canonValue(once, spec).value, once, `idempotent for ${JSON.stringify(v)}`);
	}
});

test('canonFacts projects ONLY declared keys, snapped, and reports misses; digest is order-stable', () => {
	const schema = {
		severity: { enum: ['low', 'medium', 'high'] },
		priceK:   { grain: 100, from: 'price' },          // read raw `price`, write canonical `priceK`
		count:    { type: 'int' }
	};
	const runA = canonFacts({ severity: 'HIGH', price: 1203.4, count: '4.2', prose: 'long winded reply A' }, schema);
	const runB = canonFacts({ severity: 'high', price: 1188, count: 4, prose: 'totally different wording B' }, schema);

	assert.deepEqual(runA.facts, { severity: 'high', priceK: 1200, count: 4 });
	assert.deepEqual(runA.facts, runB.facts, 'divergent prose -> IDENTICAL discrete facts (K1 defeated)');
	assert.equal(digest(runA.facts), digest(runB.facts), 'identical memo key across runs');
	assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }), 'digest is key-order independent');
	assert.equal(runA.misses.length, 0);

	const miss = canonFacts({ severity: 'apocalyptic', price: 1200, count: 3 }, schema);
	assert.deepEqual(miss.misses, ['severity'], 'out-of-vocab enum is flagged (the other inputs are present + valid)');
	assert.equal(miss.facts.severity, null);

	// a fact whose raw input is ABSENT also fails closed + visible (never a silent pass)
	assert.deepEqual(canonFacts({ severity: 'low' }, schema).misses, ['priceK', 'count']);
});
