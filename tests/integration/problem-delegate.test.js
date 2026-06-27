'use strict';
/**
 * FLAGSHIP sub-problem DELEGATION (2026-06-27): a parent grammar delegates a self-contained, hard
 * sub-problem to a forked SUB-AGENT (the Level-1 possible-worlds regime). The sub-agent runs a DIFFERENT
 * capability (the DAG migration solver) in its own world, and ONLY the bounded plan crosses back through a
 * snapped frontier — the sub-agent's internal segments/states never pollute the parent. This is the
 * bounded-context promise applied to delegation: the parent's plan carries a one-line summary of a whole
 * sub-problem; the elaboration lived (and died) in the fork.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { solveWithDelegation, namespaced } = require('../../examples/poc/problem-delegate.js');
const { makeParentContent } = require('../../examples/poc/problem-delegate.js');
const { makeDagDomainContent, LABEL } = require('../../examples/poc/problem-domain-dag.js');
const { checkedProjection } = require('../../examples/poc/fork-driver.js');

const PROB = { start: 'a feature spec needing a schema change', goal: 'the feature shipped' };

test('DELEGATION: a sub-problem is solved by a forked sub-agent; only the bounded plan crosses back', async () => {
	const parentC = makeParentContent();
	const subC = makeDagDomainContent({ zeroDowntime: true });        // the sub-agent runs the DAG migration capability
	const { graph, steps, subStats } = await solveWithDelegation(PROB, parentC, subC, { sub: { maxDepth: 16, alts: 3 }, label: 'deleg-test' });

	// the parent plan is bounded: a prep step + ONE delegated step (the whole migration as a one-liner).
	assert.equal(steps.length, 2, 'the parent plan has two steps');
	assert.match(steps[0], /feature spec.*database needs migrating/, 'step 1 is the inline prep step');
	assert.match(steps[1], /^⟦delegated⟧/, 'step 2 is the DELEGATED sub-plan, as a single bounded step');
	assert.equal(subStats.delegations, 1, 'exactly one delegation happened');
	assert.equal(subStats.subSteps, 3, 'the sub-agent solved 3 sub-steps — IN THE FORK');

	// CAPABILITY ISOLATION: the sub-agent ran the DAG migration (a DIFFERENT content) and did its OWN
	// best-path + zero-downtime backtrack in isolation — its plan is expand/contract, not downtime.
	assert.match(steps[1], /AddColumnAndDualWrite/, 'the sub-agent produced the DAG migration plan (its own capability)');
	assert.ok(!/EnterMaintenance/.test(steps[1]), 'the sub-agent did its own zero-downtime backtrack (no downtime route)');

	// NEGATIVE CONTROL (the bounded interface): the sub-agent's INTERNAL intermediate states (the migration
	// kinds) must NOT exist in the parent graph — they lived in the fork and were destroyed with it.
	let leakedInternal = 0;
	for ( const id in graph._objById ) {
		const e = graph._objById[id]._etty._;
		if ( e && e.Node && (e.state === LABEL.dualwrite || e.state === LABEL.backfilled || e.kind) ) leakedInternal++;
	}
	assert.equal(leakedInternal, 0, 'no sub-agent internal state (migration kinds) leaked into the parent');
	// the parent holds only its own handful of objects (S, G, the mid node, root + two segments).
	assert.ok(Object.keys(graph._objById).length <= 7, 'the parent stayed bounded — the fork internals are gone');
});

test('FRONTIER GUARD: an internal fact cannot cross the sub-graph boundary — a leak is caught', () => {
	const frontier = ['Delegate', 'step', 'subStepCount', 'reached', '$_id', '$$_id', 'originNode', 'targetNode'];
	// a clean projection passes…
	assert.doesNotThrow(() => checkedProjection(() => ({ $_id: '_parent', Delegate: true, step: 'ok', subStepCount: 3 }), frontier)(null));
	// …but projecting a child-internal fact (a candidate's score) THROWS frontier-leak.
	assert.throws(
		() => checkedProjection(() => ({ $_id: '_parent', step: 'ok', internalScores: [1, 2, 3] }), frontier)(null),
		/frontier-leak/, 'an internal fact crossing the boundary is rejected');
});

test('NAMESPACE: the sub-agent concept pool is re-pointed to its own provider namespace (no global swap)', () => {
	const tree = { common: { childConcepts: { A: { provider: ['P::plan'], childConcepts: { B: { provider: ['P::resolve'] } } } } } };
	const sub = namespaced(tree, 'Sub');
	assert.deepEqual(sub.common.childConcepts.A.provider, ['Sub::plan'], 'top concept re-pointed to Sub::');
	assert.deepEqual(sub.common.childConcepts.A.childConcepts.B.provider, ['Sub::resolve'], 'nested concept re-pointed too');
	assert.deepEqual(tree.common.childConcepts.A.provider, ['P::plan'], 'the original tree is untouched (deep copy)');
});
