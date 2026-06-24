'use strict';
/**
 * PoC M9-lite — smoke test for the end-to-end demo (examples/poc/demo.js): the full
 * narrative composes the tested rungs and runs on the real engine. Guards the COMPOSITION
 * (each rung has its own focused test; this asserts they still wire together).
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M9-lite cut-line).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { runDemo } = require('../../examples/poc/demo.js');
console.log = console.info = console.warn = () => {};

test('the PoC demo runs decompose -> tiling -> solve+merge -> learn end-to-end', async () => {
	const r = await runDemo();

	// 1 — decompose folded a bounded answer from 3 sub-steps
	assert.equal(r.decompose.subSteps, 3, 'trip tiled into 3 sub-steps');
	assert.match(r.decompose.rootAnswer, /DONE\[Book flights\]/, 'bounded root answer folded');

	// 2 — forkPlan derived the planted separator interface + 3 tiles (pavage)
	assert.deepEqual(r.tiling.separators, ['cost', 'risk'], 'derived separator alphabet');
	assert.equal(r.tiling.forks, 3, 'three tiles');

	// 3 — the C-solver fork solved it; only the snapped frontier crossed; D verified
	assert.equal(r.solve.sat, true, 'C-fork found a coloring');
	assert.equal(r.solve.modelSize, 5, 'the model crossed the frontier');
	assert.equal(r.solve.stepsLeaked, false, 'search internals did NOT leak (checked contract)');
	assert.equal(r.solve.valid, true, 'D parent verified deterministically');

	// 4 — cross-episode learning made the warm episode strictly cheaper, same fixpoint
	assert.equal(r.learn.coldRuns, 4);
	assert.equal(r.learn.warmRuns, 2);
	assert.ok(r.learn.warmRuns < r.learn.coldRuns, 'learning shrank the warm episode');
	assert.deepEqual(r.learn.learned, ['routeA', 'routeB']);

	// 5 — the niche: a refuted lab deterministically retracted the diagnosis + cascade, with a constat
	assert.equal(r.defeasance.retracted, true, 'diagnosis retracted on refutation');
	assert.equal(r.defeasance.cascaded, true, 'medication cascade-retracted');
	assert.equal(r.defeasance.constat.retractedBecause, 'labVerdict', 'typed constat records why');
});
