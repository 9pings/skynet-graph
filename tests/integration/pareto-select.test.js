'use strict';
/**
 * The support grammar's SELECT cluster on the real engine (J2): per-segment alternative attempts
 * `{__push}` their criteria vector into a pool; a `Select` concept, gated on the cardinality, folds
 * them with the `pareto` semiring → the multi-criteria Pareto front + a deterministic lexicographic
 * pick (`selectedId`). Same pool+gate machine as semiring/vote — the SELECT step of Candidate/Selected.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createSemiring, selectConceptTree } = require('../../lib/providers');

console.log = console.info = console.warn = () => {};

// each attempt pushes its candidate vector into the shared pool (race-free {__push})
const pushProv = { Cand: { push(graph, concept, scope, argz, cb) {
	cb(null, [{ $_id: '_parent', Attempt: true }, { $$_id: 'pool', candidates: { __push: scope._.cv } }]);
} } };
Graph._providers = Object.assign({}, Graph._providers, createSemiring(), pushProv);

const cfg = { label: 'pareto', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const CRIT = { conf: ['low', 'med', 'high'], cost: ['expensive', 'mid', 'cheap'] };

function tree( lex ) {
	return { common: { childConcepts: {
		Attempt: { _id: 'Attempt', _name: 'Attempt', require: ['cand'], provider: ['Cand::push'] },
		PoolRoot: { _id: 'PoolRoot', _name: 'PoolRoot', require: ['PoolRoot'],
			childConcepts: selectConceptTree({ criteria: CRIT, lex: lex, require: ['PoolRoot'] }).childConcepts }
	} } };
}

async function run( cands, lex ) {
	const seed = { lastRev: 0, nodes: [{ _id: 'pool', PoolRoot: true, expected: cands.length, candidates: [] }]
		.concat(cands.map(( cv, i ) => ({ _id: 'a' + i, cand: true, cv }))), segments: [] };
	const g = new Graph(seed, cfg, tree(lex));
	await nextStable(g);
	return g._objById['pool']._etty._;
}

const CANDS = [
	{ id: 'P', conf: 'high', cost: 'mid' },        // best conf
	{ id: 'Q', conf: 'med', cost: 'cheap' },       // best cost
	{ id: 'R', conf: 'low', cost: 'expensive' }    // dominated by both -> out of the front
];

test('Select folds the pooled candidates → Pareto front excludes the dominated one', async () => {
	const pool = await run(CANDS, ['conf', 'cost']);
	assert.equal(pool.Select, true, 'Select cast after the cardinality gate');
	assert.equal(pool.frontSize, 2, 'P and Q are the non-dominated trade-offs');
	assert.deepEqual([...pool.frontIds].sort(), ['P', 'Q'], 'R (dominated by both) is pruned');
	assert.equal(pool.n, 3);
});

test('the lexicographic tie-break picks within the front by criterion priority (deterministic)', async () => {
	const confFirst = await run(CANDS, ['conf', 'cost']);
	assert.equal(confFirst.selectedId, 'P', 'conf-first → the high-confidence candidate');
	const costFirst = await run(CANDS, ['cost', 'conf']);
	assert.equal(costFirst.selectedId, 'Q', 'cost-first → the cheap candidate');
});
