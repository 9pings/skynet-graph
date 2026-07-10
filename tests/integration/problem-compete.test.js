'use strict';
/**
 * FLAGSHIP parallel COMPETITIVE exploration (2026-06-27): a `Compete` concept forks one sub-agent per
 * alternative, elaborates them CONCURRENTLY (possible-worlds rollout), and selects by the REALIZED outcome
 * (the true elaborated cost) instead of a static heuristic. This beats greedy exactly when the heuristic
 * mis-ranks the routes — a route that looks cheap up front but elaborates expensive is correctly rejected.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { solveCompetitively, ROUTES } = require('../../examples/poc/problem-compete.js');

test('ROLLOUT beats GREEDY: selection by realized cost overrides a misleading static heuristic', async () => {
	const { stats, solution } = await solveCompetitively();

	// the static heuristic ranks quick-hack cheapest (estimate 1) — but it elaborates into 6 steps.
	const greedy = ROUTES.slice().sort((a, b) => a.staticEstimate - b.staticEstimate)[0];
	assert.equal(greedy.name, 'quick-hack', 'the static-cheapest route is quick-hack');
	assert.equal(stats.greedyRealized, 6, 'greedy would pay its realized cost of 6');

	// the parallel rollout elaborates ALL routes and selects the realized-cheapest (proper-refactor, 2).
	assert.equal(stats.chosen, 'proper-refactor', 'competitive selects the realized-cheapest route');
	assert.equal(stats.chosenRealized, 2, 'its realized cost is 2');
	assert.ok(stats.chosenRealized < stats.greedyRealized, 'competitive is strictly cheaper than greedy');

	// NEGATIVE CONTROL: the chosen route is NOT the static-cheapest — the rollout genuinely OVERRODE the
	// heuristic (a vacuous test would just re-pick the heuristic's choice).
	assert.notEqual(stats.chosen, greedy.name, 'the rollout overrode the misleading static heuristic');

	// every route was actually elaborated (the rollout is exhaustive, not a short-circuit).
	assert.equal(stats.realized.length, ROUTES.length, 'all routes were elaborated in parallel');
	for ( const r of stats.realized ) {
		const def = ROUTES.find((x) => x.name === r.route);
		assert.equal(r.realized, def.realLen, `${r.route} realized its true elaborated length (${def.realLen}), not its estimate`);
	}

	// the winning plan crossed back in-graph, bounded to one summary line.
	assert.match(solution, /refactor cleanly \(2 steps\)/, 'the winning bounded plan is synthesized onto the root');
});
