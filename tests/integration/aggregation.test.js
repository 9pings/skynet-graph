'use strict';
/**
 * Stratified set-aggregation (#8) on the real engine: a k-of-n consensus gate using `count`
 * inside an `ensure`, over a {__push}ed votes array. The gate combines the cardinality
 * completion check (`.length==$expected`, the stratification) with `count(...,'==','yes')>=k`
 * — closing the aggregation gap that previously forced a separate Vote::tally provider.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');

console.log = console.info = console.warn = () => {};

Graph._providers = Object.assign({}, Graph._providers, {
	V: { cast(graph, concept, scope, argz, cb) {
		// self-flag with the concept's OWN _name (Voter) or it re-fires forever (finding #1)
		cb(null, [{ $_id: '_parent', Voter: true }, { $$_id: 'tally', votes: { __push: scope._.vote } }]);
	} }
});

const cfg = { label: 'agg', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

const tree = { common: { childConcepts: {
	Voter: { _id: 'Voter', _name: 'Voter', require: ['voter'], provider: ['V::cast'] },
	Tally: { _id: 'Tally', _name: 'Tally', require: ['Tally'], childConcepts: {
		// the gate stratifies (wait for all votes) THEN aggregates (k-of-n) — no Vote::tally provider needed
		Consensus: { _id: 'Consensus', _name: 'Consensus', require: ['Tally'],
			ensure: ["$votes.length==$expected && count($votes,'==','yes')>=2"] }
	} }
} } };

async function run(votes) {
	const seed = { lastRev: 0, nodes: [{ _id: 'tally', Tally: true, expected: votes.length, votes: [] }]
		.concat(votes.map((v, i) => ({ _id: 'v' + i, voter: true, vote: v }))), segments: [] };
	const g = new Graph(seed, cfg, tree);
	await nextStable(g);
	const t = g._objById['tally']._etty._;
	return { consensus: !!t.Consensus, yes: t.votes.filter((x) => x === 'yes').length, n: t.votes.length };
}

test('count() inside an ensure gate: 2-of-3 yes -> Consensus casts', async () => {
	const r = await run(['yes', 'yes', 'no']);
	assert.equal(r.n, 3, 'all votes tallied (cardinality gate)');
	assert.equal(r.yes, 2);
	assert.equal(r.consensus, true, 'count($votes,==,yes) >= 2 holds -> Consensus cast');
});

test('count() inside an ensure gate: 1-of-3 yes -> Consensus does NOT cast', async () => {
	const r = await run(['yes', 'no', 'no']);
	assert.equal(r.n, 3);
	assert.equal(r.yes, 1);
	assert.equal(r.consensus, false, 'only 1 yes -> gate stays closed');
});
