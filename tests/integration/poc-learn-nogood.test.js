'use strict';
/**
 * PoC M6 — the LEARNING axis, cross-EPISODE. A recurring trial (SolveRoute) is a dead-end
 * for some context kinds. Episode 1 (cold) tries every route and LEARNS the dead-ends as
 * nogoods; episode 2 (warm — the learned store carried in) SOUND-SKIPS them, doing strictly
 * less expensive work while reaching the IDENTICAL useful fixpoint. The "trace shrinks on
 * the second episode" of the PoC cut-line — distinct from nogood-policy's within-run 24->12
 * (it shows the learning PERSISTS and pays across episodes). Setup in examples/poc/learn-nogood.js.
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M6).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { runNogoodEpisodes } = require('../../examples/poc/learn-nogood.js');
console.log = console.info = console.warn = () => {};

test('cross-episode: the warm episode sound-skips the learned dead-ends, same useful fixpoint', async () => {
	const r = await runNogoodEpisodes();
	assert.equal(r.coldRuns, 4, 'episode 1: all 4 routes were tried (expensive)');
	assert.equal(r.warmRuns, 2, 'episode 2: the dead-ends were sound-skipped -> only the 2 useful routes ran');
	assert.ok(r.warmRuns < r.coldRuns, 'the warm episode does strictly less expensive work');
	assert.deepEqual(r.learned, ['routeA', 'routeB'], 'the two dead routes were learned, keyed by context');
	assert.deepEqual(r.skipped, ['s0', 's1'], 'routeA/routeB skipped in the warm episode');
	// fixpoint-preserving: the surviving useful conclusions are identical cold vs warm
	assert.equal(r.results.s2.warm, 'ok:routeC');
	assert.equal(r.results.s3.warm, 'ok:routeD');
	assert.equal(r.results.s2.cold, r.results.s2.warm, 'routeC identical cold vs warm');
	assert.equal(r.results.s3.cold, r.results.s3.warm, 'routeD identical cold vs warm');
	assert.deepEqual(r.divergentWarm, [], 'no oscillation in the warm episode');
});
