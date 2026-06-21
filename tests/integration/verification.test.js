'use strict';
/**
 * Verification (roadmap #3, K3 coherence≠truth) end-to-end. Three reliable patterns:
 *   1. deterministic verifier (`ensure` IS the invariant) + a nested consumer that
 *      cascade-retracts when the premise is refuted;
 *   2. k-of-n voting — n strategies `{__push}` votes; a `Vote` concept gated on the
 *      completion predicate emits consensus + confidence; downstream gates on a threshold;
 *   3. an independent verdict provider (`Verify::check`) whose discrete verdict fact gates
 *      a downstream via `ensure`, and a direct verdict flip retracts the dependent.
 * Hermetic (deterministic checkers; no LLM).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
const { createVerifier } = require('../../providers/verify');
console.log = console.info = console.warn = () => {};

const mark = (g, c, scope, argz, cb) => { const f = { $_id: '_parent' }; f[c._name] = true; cb(null, f); };

function drive(seed, conceptMap, providers, steps) {
	Graph._providers = providers;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('verification timed out')), 20000);
		let i = 0;
		const g = new Graph(seed, {
			label: 'verify', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() {
				const step = steps[i++];
				if (!step) return;
				const next = step(g);                       // each step asserts, optionally returns a mutation
				if (next) g.pushMutation(next.tpl, next.id);
				else { clearTimeout(timer); resolve(g); }
			}
		}, { common: conceptMap });
	});
}

test('deterministic verifier + nested consumer: refuting the premise cascade-retracts the dependent', async () => {
	const tree = { childConcepts: {
		BudgetOK: {
			_id: 'BudgetOK', _name: 'BudgetOK', require: ['cost', 'cap'], ensure: ['$cost <= $cap'], provider: ['AI::mark'],
			childConcepts: { Proceed: { _id: 'Proceed', _name: 'Proceed', require: ['BudgetOK'], provider: ['AI::mark'] } }
		}
	} };
	const cast = (g, k) => !!g._objById['n']._etty._mappedConcepts[k];
	await drive(
		{ lastRev: 0, nodes: [{ _id: 'n', cost: 50, cap: 100 }], segments: [] },
		tree, { AI: { mark } },
		[
			(g) => { assert.ok(cast(g, 'BudgetOK') && cast(g, 'Proceed'), 'within budget: verifier + consumer cast');
			         return { tpl: { $$_id: 'n', cost: 150 }, id: 'n' }; },          // blow the budget
			(g) => { assert.ok(!cast(g, 'BudgetOK'), 'verifier retracted on refutation');
			         assert.ok(!cast(g, 'Proceed'), 'consumer cascade-retracted (K3 defeasance)'); }
		]
	);
});

test('k-of-n voting: consensus + confidence as facts; downstream gates on a threshold', async () => {
	const { Vote } = createVerifier();
	const tree = { childConcepts: {
		Task: { _id: 'Task', _name: 'Task', require: 'Segment', childConcepts: {
			S0: { _id: 'S0', _name: 'S0', require: ['Task'], provider: ['AI::s0'] },
			S1: { _id: 'S1', _name: 'S1', require: ['Task'], provider: ['AI::s1'] },
			S2: { _id: 'S2', _name: 'S2', require: ['Task'], provider: ['AI::s2'] },
			Vote: { _id: 'Vote', _name: 'Vote', require: ['Task', 'votes'], ensure: ['$votes.length == $expected'], provider: ['Vote::tally'], vote: { votesKey: 'votes' } },
			Accept:       { _id: 'Accept', _name: 'Accept', require: ['confidence'], ensure: ['$confidence >= 0.6'], provider: ['AI::mark'] },
			StrictAccept: { _id: 'StrictAccept', _name: 'StrictAccept', require: ['confidence'], ensure: ['$confidence >= 0.7'], provider: ['AI::mark'] }
		} }
	} };
	const vote = (v) => (g, c, scope, argz, cb) => { const f = { $_id: '_parent', votes: { __push: v } }; f[c._name] = true; cb(null, f); };
	const providers = { Vote, AI: { mark, s0: vote('A'), s1: vote('A'), s2: vote('B') } };

	const g = await drive(
		{ lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 'r', originNode: 'a', targetNode: 'b', expected: 3 }] },
		tree, providers, [() => null]
	);
	const e = g._objById['r']._etty._;
	assert.deepEqual([...e.votes].sort(), ['A', 'A', 'B'], 'three votes fanned in race-free via {__push}');
	assert.equal(e.consensus, 'A', 'majority consensus');
	assert.ok(Math.abs(e.confidence - 2 / 3) < 1e-9, 'confidence = agree/n = 2/3');
	assert.equal(g._objById['r']._etty._mappedConcepts.Accept != null, true, 'threshold 0.6 accepted');
	assert.equal(g._objById['r']._etty._mappedConcepts.StrictAccept == null, true, 'threshold 0.7 NOT accepted');
});

test('independent verdict provider gates a downstream; a verdict flip retracts it', async () => {
	const { Verify } = createVerifier();
	const tree = { childConcepts: {
		RangeCheck: { _id: 'RangeCheck', _name: 'RangeCheck', require: ['value'], provider: ['Verify::check'],
			verify: { target: 'value', check: 'range', params: { min: 0, max: 100 }, as: 'value' } },
		Trusted: { _id: 'Trusted', _name: 'Trusted', require: ['valueVerified'], ensure: ['$valueVerified == true'], provider: ['AI::mark'] }
	} };
	const cast = (g, k) => !!g._objById['n']._etty._mappedConcepts[k];
	const providers = { Verify, AI: { mark } };

	// (a) value in range -> verdict pass -> Trusted casts; then a direct verdict flip retracts it
	const gA = await drive(
		{ lastRev: 0, nodes: [{ _id: 'n', value: 50 }], segments: [] }, tree, providers,
		[
			(g) => { assert.equal(g._objById['n']._etty._.valueVerdict, 'pass');
			         assert.ok(cast(g, 'Trusted'), 'downstream trusts a passing verdict');
			         return { tpl: { $$_id: 'n', valueVerified: false }, id: 'n' }; },   // refute
			(g) => { assert.ok(!cast(g, 'Trusted'), 'downstream retracts when the verdict flips (defeasance)'); }
		]
	);
	assert.ok(gA);

	// (b) value out of range -> verdict fail -> downstream never casts
	const gB = await drive(
		{ lastRev: 0, nodes: [{ _id: 'n', value: 150 }], segments: [] }, tree, providers,
		[() => null]
	);
	assert.equal(gB._objById['n']._etty._.valueVerdict, 'fail');
	assert.equal(gB._objById['n']._etty._.valueVerified, false);
	assert.ok(!gB._objById['n']._etty._mappedConcepts.Trusted, 'a failing verdict never gates the downstream on');
});
