'use strict';
/**
 * Support grammar J3 — per-segment ESCALATION on Stuck. When a segment's own (small-model)
 * candidates all fall below a quality bar, the segment is Stuck: it escalates to a better-tier
 * proposer for THAT segment only, records the weak candidates as memory (escalatedFrom = a nogood),
 * and the SELECT then picks across the enriched pool. A segment that already has a strong candidate
 * never escalates (the better model is spent only where the small one is locally insufficient).
 * Bounded/additive: escalation happens before the single SELECT (no mutate-and-re-run loop — the
 * full reactive multi-attempt loop remains open R&D). Deterministic, no LLM.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { supportConceptTree, makeSupportProviders } = require('../../plugins/planner/lib/support.js');

console.log = console.info = console.warn = () => {};

const CRIT = { conf: ['low', 'med', 'high'], cost: ['expensive', 'mid', 'cheap'] };

const SMALL = {
	weak  : [ { id: 'w1', conf: 'low', cost: 'cheap', content: 'w1' }, { id: 'w2', conf: 'med', cost: 'mid', content: 'w2' } ], // no 'high'
	strong: [ { id: 's1', conf: 'high', cost: 'mid', content: 's1' }, { id: 's2', conf: 'med', cost: 'cheap', content: 's2' } ]  // has 'high'
};
const BETTER = { weak: [ { id: 'E', conf: 'high', cost: 'expensive', content: 'E' } ] };  // the escalated, stronger answer

const providers = makeSupportProviders({
	maxDepth   : 2,
	evalFn     : ( scope ) => ({ atomic: (scope._.depth || 0) >= 1 }),
	expandFn   : () => [{ name: 'weak' }, { name: 'strong' }],
	proposeFn  : ( scope ) => SMALL[scope._.label] || [],
	escalateFn : ( scope ) => BETTER[scope._.label] || [],
	escalateBar: { criterion: 'conf', order: ['low', 'med', 'high'], min: 'high' },
	rollupFn   : ( seg, kids ) => 'ROOT[' + kids.join('|') + ']'
});
Graph._providers = Object.assign({}, Graph._providers, providers);

const cfg = { label: 'escalate', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

test('a Stuck segment escalates to the better tier and records the weak candidates; a strong one does not', async () => {
	const seed = { lastRev: 0, nodes: [{ _id: 'A' }, { _id: 'B' }],
		segments: [{ _id: 'root', originNode: 'A', targetNode: 'B', depth: 0, label: 'root', answeredBy: [] }] };
	const g = new Graph(seed, cfg, { common: supportConceptTree({ criteria: CRIT, lex: ['conf', 'cost'] }) });
	await nextStable(g);

	const root = g._objById['root']._etty._;
	assert.equal((root.expandedInto || []).length, 2, 'structure held');
	const weak = g._objById[root.expandedInto[0]]._etty._;
	const strong = g._objById[root.expandedInto[1]]._etty._;

	// the weak segment: no small candidate reached the bar → escalated; the better candidate is adopted
	assert.equal(weak.Stuck, true, 'weak segment flagged Stuck (no small candidate cleared the bar)');
	assert.equal(weak.Escalated, true, 'it escalated to the better tier');
	assert.deepEqual([...(weak.escalatedFrom || [])].sort(), ['w1', 'w2'], 'the weak candidates are recorded (nogood memory)');
	assert.equal(weak.selectedId, 'E', 'the escalated high-confidence candidate is selected');
	assert.equal(weak.answer, 'E');

	// the strong segment: a small candidate already cleared the bar → no escalation (better model not spent)
	assert.ok(!strong.Stuck, 'strong segment is not Stuck');
	assert.ok(!strong.Escalated, 'strong segment did not escalate');
	assert.equal(strong.selectedId, 's1', 'the small high-confidence candidate is selected');
	assert.equal(strong.answer, 's1');

	assert.equal(root.Answered, true, 'root synthesized once both children reported');
	assert.equal(root.answer, 'ROOT[E|s1]');
});
