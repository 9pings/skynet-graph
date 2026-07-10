'use strict';
/**
 * makeSplitServe — the RECURSIVE composite path (KG-SPLIT GO, WIP/experiments/2026-07-10-recursive-split:
 * single-shot composed emission refuted at 0-14%; kind-route → NL SPLIT → plain-decompose per sub-question
 * reaches 55% strict / 64% relaxed with 0% plain false-positives). Pure stubs — no GPU; the live numbers live
 * in the kill-gate. The brick owns NO model: `split` and `plain` are injected.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSplitServe } = require('../../lib/authoring/split-serve.js');

test('plain routing — split says none → the original query goes to the plain decomposer untouched', async () => {
	const calls = [];
	const sv = makeSplitServe({
		split: async () => ({ setop: 'none', nested: false, q1: 'ignored', q2: '' }),
		plain: async ( q ) => { calls.push(q); return 'join>filter>select'; }
	});
	const r = await sv.serve('list the stadium names in London');
	assert.deepEqual(calls, ['list the stadium names in London'], 'plain path uses the ORIGINAL query, not q1');
	assert.equal(r.kind, 'plain');
	assert.equal(r.shape, 'join>filter>select');
});

test('set-op — both sub-questions are decomposed independently; shape = operand|op with both parts carried', async () => {
	const calls = [];
	const sv = makeSplitServe({
		split: async () => ({ setop: 'intersect', nested: false, q1: 'stadiums with concerts in 2014', q2: 'stadiums with concerts in 2015' }),
		plain: async ( q ) => { calls.push(q); return 'join>filter>select'; }
	});
	const r = await sv.serve('stadiums with concerts in both 2014 and 2015');
	assert.deepEqual(calls, ['stadiums with concerts in 2014', 'stadiums with concerts in 2015']);
	assert.equal(r.kind, 'setop');
	assert.equal(r.shape, 'join>filter>select|intersect');
	assert.equal(r.parts.s2, 'join>filter>select');
	assert.equal(r.sameOperand, true, 'same-operand is reported (the certification-relevant strict criterion)');
});

test('set-op with DIFFERENT operand shapes — shape names the FIRST operand, sameOperand=false (honest)', async () => {
	const sv = makeSplitServe({
		split: async () => ({ setop: 'except', nested: false, q1: 'a', q2: 'b' }),
		plain: async ( q ) => q === 'a' ? 'join>filter>select' : 'filter>select'
	});
	const r = await sv.serve('q');
	assert.equal(r.shape, 'join>filter>select|except');
	assert.equal(r.sameOperand, false);
});

test('nested — only the outer (q1, VALUE-placeholder) is decomposed; the inner question is carried, not decomposed', async () => {
	const calls = [];
	const sv = makeSplitServe({
		split: async () => ({ setop: 'none', nested: true, q1: 'singers older than VALUE', q2: 'the average age of singers' }),
		plain: async ( q ) => { calls.push(q); return 'filter>aggregate>select'; }
	});
	const r = await sv.serve('singers older than the average age');
	assert.deepEqual(calls, ['singers older than VALUE'], 'the inner sub-query is NOT plain-decomposed (residual: 2/6 live — do not claim it)');
	assert.equal(r.kind, 'nested');
	assert.equal(r.shape, 'filter>aggregate>select|n');
	assert.equal(r.parts.inner, 'the average age of singers');
});

test('fail-closed — a set-op split MISSING q2 falls back to the plain path on the original query, tagged', async () => {
	const calls = [];
	const sv = makeSplitServe({
		split: async () => ({ setop: 'intersect', nested: false, q1: 'only one side', q2: '' }),
		plain: async ( q ) => { calls.push(q); return 'aggregate>select'; }
	});
	const r = await sv.serve('original');
	assert.deepEqual(calls, ['original']);
	assert.equal(r.kind, 'plain');
	assert.equal(r.fallback, true, 'a malformed split never invents a composition');
});

test('fail-closed — conflicting split (setop AND nested) falls back to plain (never guess which)', async () => {
	const sv = makeSplitServe({
		split: async () => ({ setop: 'except', nested: true, q1: 'a', q2: 'b' }),
		plain: async () => 'aggregate>select'
	});
	const r = await sv.serve('q');
	assert.equal(r.kind, 'plain');
	assert.equal(r.fallback, true);
});

test('fail-closed — the splitter THROWING falls back to plain (the router never blocks the query)', async () => {
	const sv = makeSplitServe({
		split: async () => { throw new Error('boom'); },
		plain: async () => 'group>aggregate>select'
	});
	const r = await sv.serve('q');
	assert.equal(r.shape, 'group>aggregate>select');
	assert.equal(r.fallback, true);
});

test('guards — split and plain are required', () => {
	assert.throws(() => makeSplitServe({ plain: async () => 'x' }), /split/);
	assert.throws(() => makeSplitServe({ split: async () => ({}) }), /plain/);
});
