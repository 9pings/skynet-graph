'use strict';
/**
 * The support grammar end-to-end on the real engine (J1+J2): a problem DECOMPOSES (the graph holds
 * the structure — the Task DAG, never the model's context), each atomic segment GENERATES SEVERAL
 * candidate answers and the `pareto` SELECT keeps the non-dominated trade-offs + picks one
 * (lexicographic), and the parent SYNTHESIZES bottom-up (reactive Rollup). All canned (no LLM): it
 * proves the thesis mechanics — a locally-competent step + reified structure/search/selection.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { supportConceptTree, makeSupportProviders } = require('../../plugins/planner/lib/support.js');

console.log = console.info = console.warn = () => {};

const CRIT = { conf: ['low', 'med', 'high'], cost: ['expensive', 'mid', 'cheap'] };

// per-segment candidate alternatives (in production an LLM proposes these; canned here, keyed by label)
const CANDS = {
	c1: [ { id: 'P', conf: 'high', cost: 'mid', content: 'P-ans' },
	      { id: 'Q', conf: 'med', cost: 'cheap', content: 'Q-ans' },
	      { id: 'R', conf: 'low', cost: 'expensive', content: 'R-ans' } ],  // R dominated by both
	c2: [ { id: 'X', conf: 'med', cost: 'mid', content: 'X-ans' },
	      { id: 'Y', conf: 'high', cost: 'expensive', content: 'Y-ans' } ]  // X,Y incomparable
};

const providers = makeSupportProviders({
	maxDepth : 2,
	evalFn   : ( scope ) => ({ atomic: (scope._.depth || 0) >= 1 }),   // root splits, children are atomic
	expandFn : () => [{ name: 'c1' }, { name: 'c2' }],
	proposeFn: ( scope ) => CANDS[scope._.label] || [],
	rollupFn : ( seg, kids ) => 'ROOT[' + kids.join('|') + ']'
});
Graph._providers = Object.assign({}, Graph._providers, providers);

const cfg = { label: 'support', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

test('decompose holds structure; each segment Pareto-selects among alternatives; rollup synthesizes', async () => {
	const seed = { lastRev: 0,
		nodes: [{ _id: 'A' }, { _id: 'B' }],
		segments: [{ _id: 'root', originNode: 'A', targetNode: 'B', depth: 0, label: 'root', answeredBy: [] }] };
	const g = new Graph(seed, cfg, { common: supportConceptTree({ criteria: CRIT, lex: ['conf', 'cost'] }) });
	await nextStable(g);

	const root = g._objById['root']._etty._;
	assert.equal((root.expandedInto || []).length, 2, 'structure held: root expanded into 2 sub-steps');
	const c1 = g._objById[root.expandedInto[0]]._etty._;
	const c2 = g._objById[root.expandedInto[1]]._etty._;

	// segment c1: front {P,Q} (R dominated); conf-first lexicographic → P
	assert.equal(c1.frontSize, 2, 'c1 front excludes the dominated R');
	assert.equal(c1.selectedId, 'P', 'c1 picks the conf-first Pareto winner');
	assert.equal(c1.answer, 'P-ans', 'c1 adopts the selected candidate as its answer');
	assert.equal(c1.Answered, true);

	// segment c2: front {X,Y} (incomparable); conf-first → Y
	assert.equal(c2.selectedId, 'Y', 'c2 conf-first pick within the front');
	assert.equal(c2.answer, 'Y-ans');

	// the parent synthesized bottom-up once both children reported (reactive Rollup)
	assert.equal(root.Answered, true, 'root synthesized by Rollup');
	assert.equal(root.answer, 'ROOT[P-ans|Y-ans]', 'rollup reads children in expandedInto order');
});
