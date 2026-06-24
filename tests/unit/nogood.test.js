'use strict';
/**
 * L3 nogood / sound-skip policy (lib/providers/nogood.js, experiment B). The packaged
 * pieces: recordNogood (the dead-end push fragment), createNogood (the guard provider —
 * store -> typed skip flags, self-flag LAST), and guardTrial (the wiring discipline).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordNogood, createNogood, guardTrial, nogoodGuardConcept } = require('../../lib/providers');

test('recordNogood builds a race-free {__push} into the shared store', () => {
	const tpl = recordNogood({ memId: 'mem', storeKey: 'nogoods', ctxKey: 'travel', trial: 'TrialB' });
	assert.equal(tpl.$$_id, 'mem');
	assert.deepEqual(tpl.nogoods, { __push: { ctxKey: 'travel', trial: 'TrialB' } });
});

test('guardTrial adds the require-defer + the sound-skip ensure (never caps the grammar)', () => {
	const base = { _id: 'TrialB', _name: 'TrialB', require: ['Trial', 'kind'], ensure: [], provider: ['Exp::TrialB'] };
	const g = guardTrial(base, { trial: 'TrialB' });
	assert.deepEqual(g.require, ['Trial', 'kind', 'NogoodGuard'], 'defers on the guard self-flag');
	assert.deepEqual(g.ensure, ['!$skip_TrialB'], 'sound-skip on the typed flag');
	assert.deepEqual(base.require, ['Trial', 'kind'], 'original schema not mutated');
});

test('Nogood::guard writes matching skip flags FIRST and its self-flag LAST', () => {
	const frag = createNogood();
	const store = [
		{ ctxKey: 'travel', trial: 'TrialB' },
		{ ctxKey: 'stay', trial: 'TrialA' },   // different ctx — must be ignored
		{ ctxKey: 'travel', trial: 'TrialX' }
	];
	const graph = { getEtty: () => ({ _: { nogoods: store } }) };
	const scope = { _: { kind: 'travel' } };
	const concept = { _name: 'NogoodGuard', _schema: { nogood: { memId: 'mem', storeKey: 'nogoods', ctxKeyField: 'kind' } } };
	let facts;
	frag.Nogood.guard(graph, concept, scope, null, (e, f) => { facts = f; });
	assert.equal(facts.skip_TrialB, true);
	assert.equal(facts.skip_TrialX, true);
	assert.ok(!('skip_TrialA' in facts), 'a different-context nogood is not applied');
	// ordering discipline: every skip_* key precedes the NogoodGuard self-flag
	const keys = Object.keys(facts);
	assert.ok(keys.indexOf('NogoodGuard') === keys.length - 1, 'self-flag is LAST');
	assert.ok(keys.indexOf('skip_TrialB') < keys.indexOf('NogoodGuard'), 'skip flags precede the self-flag');
});

test('nogoodGuardConcept wires a provider-cheap guard concept', () => {
	const c = nogoodGuardConcept({ ctxKeyField: 'kind' });
	assert.equal(c._name, 'NogoodGuard');
	assert.deepEqual(c.provider, ['Nogood::guard']);
	assert.equal(c.nogood.ctxKeyField, 'kind');
});
