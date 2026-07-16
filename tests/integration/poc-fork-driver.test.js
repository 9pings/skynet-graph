'use strict';
/**
 * PoC M3 — the fork-creation driver tiles a sub-problem to a C-regime solver fork and
 * merges back ONLY the snapped frontier {sat, model}, with the frontier enforced as a
 * CHECKED contract at runtime (validateMergeProjection). Reproduces E8 THROUGH the driver,
 * and the negative control proves a `steps` leak is CAUGHT (not just derivable).
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M2/M3).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createSolver, snappedFrontier, solverConceptTree } = require('../../lib/providers');
const { forkSolveAndMerge, checkedProjection } = require('../../examples/poc/fork-driver.js');

console.log = console.info = console.warn = () => {};

// D-side checker: count monochromatic edges in the crossed model (deterministic, auditable).
const dCheck = { Chk: { verify( graph, concept, scope, argz, cb ) {
	const model = scope._.model || {}, edges = scope._.edges || [];
	let violations = 0;
	for ( const [u, v] of edges ) if ( model[u] === model[v] ) violations++;
	cb(null, { $_id: '_parent', Verify: true, violations, valid: violations === 0 });
} } };
Graph._providers = Object.assign({}, Graph._providers, createSolver(), dCheck);

const dTree = { common: { childConcepts: {
	ProbRoot: { _id: 'ProbRoot', _name: 'ProbRoot', require: ['ProbRoot'], childConcepts: {
		Verify: { _id: 'Verify', _name: 'Verify', require: ['model', 'sat'], ensure: ['$sat==true'], provider: ['Chk::verify'] },
		Unsat: { _id: 'Unsat', _name: 'Unsat', require: ['sat'], ensure: ['$sat==false'] }
	} }
} } };
const cfg = { label: 'poc-fork', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const FRONTIER = ['sat', 'model'];   // the declared contract for a C-solver fork (the snapped model)

test('the driver forks a solver, merges only the snapped frontier, and the C-parent verifies', async () => {
	const nodes = [0, 1, 2, 3, 4], edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]];
	const parent = new Graph({ lastRev: 0, nodes: [{ _id: 'prob', ProbRoot: true, nodes, edges }], segments: [] }, cfg, dTree);
	await nextStable(parent);
	assert.equal(parent._objById['prob']._etty._.model, undefined, 'D alone never searches');

	await forkSolveAndMerge(parent, {
		childSeed: { lastRev: 0, nodes: [{ _id: 'prob', toSolve: true, nodes, edges }], segments: [] },
		childConf: { label: 'Csolver', conceptMap: { common: solverConceptTree() } },
		targetId: 'prob', frontierAlphabet: FRONTIER, project: snappedFrontier({ targetId: 'prob' }), nextStable
	});

	const f = parent._objById['prob']._etty._;
	assert.equal(f.sat, true, 'the C-fork found a coloring');
	assert.ok(f.model && Object.keys(f.model).length === 5, 'the snapped model crossed the frontier');
	assert.equal(f.steps, undefined, 'search internals (steps) did NOT leak — the contract held');
	assert.equal(f.valid, true, 'the D parent verified the coloring deterministically');
});

test('NEGATIVE CONTROL: a projection that leaks an internal `steps` fact is CAUGHT at runtime', async () => {
	const nodes = [0, 1, 2], edges = [[0, 1], [1, 2]];
	const parent = new Graph({ lastRev: 0, nodes: [{ _id: 'prob', ProbRoot: true, nodes, edges }], segments: [] }, cfg, dTree);
	await nextStable(parent);

	// a leaky projection crosses the solver's internal step count alongside the model
	const leakyProject = ( child ) => {
		const e = child._objById['prob']._etty._;
		return { $$_id: 'prob', sat: e.sat, model: e.model, steps: e.steps };
	};
	await assert.rejects(
		forkSolveAndMerge(parent, {
			childSeed: { lastRev: 0, nodes: [{ _id: 'prob', toSolve: true, nodes, edges }], segments: [] },
			childConf: { label: 'Cleak', conceptMap: { common: solverConceptTree() } },
			targetId: 'prob', frontierAlphabet: FRONTIER, project: leakyProject, nextStable
		}),
		/frontier-leak.*steps/, 'the driver refuses to merge a projection that leaks `steps`'
	);
	// and the leak NEVER reached the parent (the contract blocked it before merge)
	assert.equal(parent._objById['prob']._etty._.steps, undefined, 'no internal fact crossed the boundary');
});

test('checkedProjection passes a clean frontier projection untouched', () => {
	const ok = checkedProjection(() => ({ $$_id: 'p', sat: true, model: { 0: 0 } }), FRONTIER);
	assert.doesNotThrow(() => ok({}));
	const bad = checkedProjection(() => ({ $$_id: 'p', sat: true, steps: 9 }), FRONTIER);
	assert.throws(() => bad({}), /frontier-leak/);
});
