'use strict';
/**
 * FLAGSHIP typed-domain DAG (2026-06-27): a domain corpus that is a DAG OF KINDS — genuinely alternative
 * typed routes from start to goal — so the problem-paths grammar's BEST-PATH choice (Select) and
 * feasibility-driven BACKTRACK (Reselect) finally do real work IN A DOMAIN. The domain is an online DB
 * schema migration with three strategies (downtime / expand-contract / blue-green). Measured (the K6 cost
 * question): the engine searches the DAG at ZERO LLM cost — the corpus carries the structure, the LLM is
 * spent only on genuine gaps. The route choice is REAL (3 routes proposed, the cheapest chosen) and the
 * backtrack is REAL (a feasibility wall forces a switch to the next-best route), both with negative controls.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { solve } = require('../../examples/poc/problem-paths.js');
const { makeDagDomainContent, LABEL, OPS } = require('../../examples/poc/problem-domain-dag.js');

const PROB = { start: LABEL.current, startKind: 'current', goal: LABEL.migrated, goalKind: 'migrated' };
const throwLLM = () => { throw new Error('LLM must not be called for an in-vocabulary DAG'); };
const segs = ( g ) => Object.keys(g._objById).map((id) => g._objById[id]._etty._).filter((e) => e && e.Segment);

test('BEST-PATH: 3 alternative typed routes are proposed and the CHEAPEST is chosen — ZERO LLM', async () => {
	const C = makeDagDomainContent({ llm: throwLLM });
	const { graph, steps } = await solve(PROB, C, { maxDepth: 16, alts: 3, label: 'dag-best' });

	// the greedy pick is the downtime route (cheapest total weight, 2): two named operators, in order.
	assert.deepEqual(steps, [OPS['current>maintenance'].op, OPS['maintenance>migrated'].op], 'the cheapest route (downtime) was resolved end to end');
	assert.equal(C.stats.calls, 0, 'the corpus grounded the whole search — no LLM escalation');
	assert.equal(C.stats.deterministic, 2, 'both moves came from deterministic domain operators');

	// NEGATIVE CONTROL: a genuine CHOICE among 3 routes happened — not a single forced route.
	const root = graph.getEtty('root')._;
	assert.equal(root.alts.length, 3, 'three alternative routes were proposed at the root (a real DAG, not a chain)');
	assert.equal(root.chosen, LABEL.maintenance, 'the chosen route is the cheapest (downtime)');
	assert.equal(Math.max(...root.scores), root.scores[root.alts.findIndex((a) => a.mid === root.chosen)], 'the chosen route is the max-scored one');
	// the two losing routes (expand-contract, blue-green) were proposed but never put on the path.
	const onPathMids = segs(graph).filter((e) => e.onPath).map((e) => e.label);
	assert.ok(!onPathMids.some((l) => /v2 column exists|cloned database/.test(l || '')), 'the un-chosen routes were never explored');
});

test('FEASIBILITY BACKTRACK: a zero-downtime SLA dead-ends the cheap route → the grammar switches to the next-best — ZERO LLM', async () => {
	const C = makeDagDomainContent({ zeroDowntime: true, llm: throwLLM });
	const { graph, steps } = await solve(PROB, C, { maxDepth: 16, alts: 3, label: 'dag-bt' });

	// the SLA makes the downtime cutover infeasible → the search backtracks to EXPAND/CONTRACT (the next
	// cheapest feasible route, weight 4) — NOT blue/green (weight 6). The textbook online-migration answer.
	assert.deepEqual(steps, [OPS['current>dualwrite'].op, OPS['dualwrite>backfilled'].op, OPS['backfilled>migrated'].op], 'resolved the online expand/contract route');
	assert.equal(C.stats.calls, 0, 'the backtracking search stayed in-vocabulary — no LLM');
	assert.equal(C.stats.deadends, 1, 'exactly one route dead-ended (the downtime cutover)');

	// NEGATIVE CONTROL #1: the downtime route was GENUINELY entered then abandoned — not avoided up front.
	const entered = segs(graph).find((e) => e.step === OPS['current>maintenance'].op);
	assert.ok(entered, 'the downtime route was actually entered (EnterMaintenance resolved)');
	assert.equal(entered.onPath, false, 'and then pruned OFF the path by the backtrack');
	const root = graph.getEtty('root')._;
	assert.ok((root.tried || []).includes(LABEL.maintenance), 'the audit ledger records the downtime route as tried');
	assert.equal(root.chosen, LABEL.dualwrite, 'the live route is now expand/contract');

	// NEGATIVE CONTROL #2: blue/green (the more expensive feasible route) was NOT taken — cost order respected.
	assert.ok(!steps.some((s) => /Clone|SwapOver/.test(s)), 'the expensive blue/green route was not used');
});

test('GAP ESCALATION: an UNTYPED start is bridged by the LLM on one segment, then the DAG takes over', async () => {
	let bridged = 0;
	const C = makeDagDomainContent({ llm: async () => { bridged++; return 'BRIDGE: classify the legacy app and bring it to a clean v1 baseline'; } });
	const { steps } = await solve(
		{ start: 'a legacy app on an undocumented schema', goal: LABEL.migrated, goalKind: 'migrated' },
		C, { maxDepth: 16, alts: 3, label: 'dag-gap' });

	// the untyped start routes via the chain entry (current); the one bridge is the only LLM spend, then
	// the deterministic DAG search resolves the rest.
	assert.equal(bridged, 1, 'exactly one LLM bridge for the untyped start');
	assert.equal(C.stats.calls, 1, 'the LLM was spent only on the genuine gap');
	assert.ok(steps.length >= 3, 'the bridged start still produced a full migration plan');
	assert.equal(steps[0], 'BRIDGE: classify the legacy app and bring it to a clean v1 baseline', 'the bridge is the first step, in order');
});
