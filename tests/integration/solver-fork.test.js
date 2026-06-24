'use strict';
/**
 * C-regime solver-fork at a real fork/merge frontier (experiment E8). A C-grammar sub-graph
 * SEARCHES (backtracking 3-coloring) what the D parent cannot propagate; snappedFrontier
 * crosses ONLY the snapped model (assignment + sat) so search internals never leak; the D
 * parent then verifies deterministically, and UNSAT is a discrete outcome.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createSolver, snappedFrontier, solverConceptTree } = require('../../lib/providers');

console.log = console.info = console.warn = () => {};

// D-side checker: count monochromatic edges in the crossed model (deterministic, auditable).
const dCheck = { Chk: { verify(graph, concept, scope, argz, cb) {
	const model = scope._.model || {}, edges = scope._.edges || [];
	let violations = 0;
	for (const [u, v] of edges) if (model[u] === model[v]) violations++;
	cb(null, { $_id: '_parent', Verify: true, violations, valid: violations === 0 });
} } };

Graph._providers = Object.assign({}, Graph._providers, createSolver(), dCheck);

// D parent grammar: verify a SAT model, or flag UNSAT discretely.
const dTree = {
	common: { childConcepts: {
		ProbRoot: { _id: 'ProbRoot', _name: 'ProbRoot', require: ['ProbRoot'], childConcepts: {
			Verify: { _id: 'Verify', _name: 'Verify', require: ['model', 'sat'], ensure: ['$sat==true'], provider: ['Chk::verify'] },
			Unsat: { _id: 'Unsat', _name: 'Unsat', require: ['sat'], ensure: ['$sat==false'] }
		} }
	} }
};

const cfg = { label: 'solver-fork', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

async function runInstance(nodes, edges) {
	const parent = new Graph({ lastRev: 0, nodes: [{ _id: 'prob', ProbRoot: true, nodes, edges }], segments: [] }, cfg, dTree);
	await nextStable(parent);
	const dAloneModel = parent._objById['prob']._etty._.model;   // D alone never searches

	// fork a C-regime sub-graph (different grammar = search), solve, then cross ONLY the model
	const child = parent.fork({ lastRev: 0, nodes: [{ _id: 'prob', toSolve: true, nodes, edges }], segments: [] },
		{ label: 'Csolver', conceptMap: { common: solverConceptTree() } });
	await nextStable(child);
	const childSearched = !!child._objById['prob']._etty._.Solve;
	const childSteps = child._objById['prob']._etty._.steps;

	parent.merge(child, 'prob', snappedFrontier({ targetId: 'prob' }));
	await nextStable(parent);

	const f = parent._objById['prob']._etty._;
	return {
		dAloneModel, childSearched, childSteps,
		sat: f.sat, model: f.model, stepsLeaked: f.steps != null,
		verifyValid: f.Verify ? f.valid : null,
		unsat: !!f.Unsat
	};
}

test('SAT (C5): D cannot search; the C-fork solves it and only the snapped model crosses', async () => {
	const r = await runInstance([0, 1, 2, 3, 4], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
	assert.equal(r.dAloneModel, undefined, 'D alone produced no model (it does not search)');
	assert.equal(r.childSearched, true, 'the C-fork searched');
	assert.ok(r.childSteps > 0, 'the fork actually backtracked');
	assert.equal(r.sat, true);
	assert.ok(r.model && Object.keys(r.model).length === 5, 'the model crossed the frontier');
	assert.equal(r.stepsLeaked, false, 'search internals (steps) did NOT cross — barrier preserved');
	assert.equal(r.verifyValid, true, 'the D parent verified the coloring deterministically');
	assert.equal(r.unsat, false);
});

test('UNSAT (K4): the C-fork reports UNSAT discretely; Verify does not cast', async () => {
	const r = await runInstance([0, 1, 2, 3], [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
	assert.equal(r.childSearched, true);
	assert.equal(r.sat, false);
	assert.equal(r.model, null, 'no model when UNSAT');
	assert.equal(r.unsat, true, 'the discrete UNSAT outcome cast on the D parent');
	assert.equal(r.verifyValid, null, 'Verify did not cast (its $sat==true gate is false)');
});
