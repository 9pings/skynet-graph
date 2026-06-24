'use strict';
/**
 * C-regime solver-fork operator (lib/providers/solver-fork.js, experiment E8). The reference
 * backend SEARCHES (backtracking CSP) what D cannot propagate; snappedFrontier enforces the
 * barrier — only the snapped model (assignment enums + sat bool) may cross a merge frontier.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backtrackColoring, createSolver, snappedFrontier, solverConceptTree } = require('../../lib/providers');

const C5 = { nodes: [0, 1, 2, 3, 4], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]] };   // odd cycle -> 3-colorable
const K4 = { nodes: [0, 1, 2, 3], edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] }; // needs 4 colors -> UNSAT for 3

test('reference backend SEARCHES: C5 is 3-colorable, K4 is not', () => {
	const sat = backtrackColoring(C5);
	assert.equal(sat.sat, true);
	assert.equal(Object.keys(sat.model).length, 5, 'a full assignment');
	// the model is a proper coloring: no edge is monochromatic
	for (const [u, v] of C5.edges) assert.notEqual(sat.model[u], sat.model[v]);
	assert.ok(sat.steps > 0, 'it actually searched');

	const unsat = backtrackColoring(K4);
	assert.equal(unsat.sat, false);
	assert.equal(unsat.model, null, 'no model when UNSAT');
});

test('createSolver: Solve::run emits sat + model + internals (backend injectable)', () => {
	const frag = createSolver();
	assert.equal(typeof frag.Solve.run, 'function');
	// a custom backend is honoured
	const custom = createSolver({ solve: () => ({ sat: true, model: { x: 1 }, steps: 7 }) });
	const writes = [];
	const scope = { _: { spec: { nodes: [], edges: [] } } };
	const graph = { getRef: (k, s) => s._[k] };
	const concept = { _name: 'Solve', _schema: { solve: { specKey: 'spec' } } };
	custom.Solve.run(graph, concept, scope, null, (err, facts) => writes.push(facts));
	assert.equal(writes[0].sat, true);
	assert.deepEqual(writes[0].model, { x: 1 });
	assert.equal(writes[0].steps, 7, 'internals are emitted on the child object');
	assert.equal(writes[0].Solve, true, 'self-flag');
});

test('snappedFrontier crosses ONLY the model + sat — search internals do NOT leak', () => {
	// a fake solved child: the result object also carries `steps` (a search internal)
	const child = { getEtty: () => ({ _: { sat: true, model: { 0: 'R' }, steps: 99, tree: ['...'] } }) };
	const project = snappedFrontier({ targetId: 'prob' });
	const tpl = project(child);
	assert.equal(tpl.$$_id, 'prob');
	assert.equal(tpl.sat, true);
	assert.deepEqual(tpl.model, { 0: 'R' });
	assert.ok(!('steps' in tpl), 'steps must NOT cross the frontier (barrier)');
	assert.ok(!('tree' in tpl), 'the search tree must NOT cross the frontier');
	// a custom frontier is honoured
	const proj2 = snappedFrontier({ targetId: 'p', frontier: ['sat'] });
	assert.deepEqual(Object.keys(proj2(child)).sort(), ['$$_id', 'sat']);
});

test('solverConceptTree wires a Solve concept for the C-fork grammar', () => {
	const tree = solverConceptTree({ specKey: 'spec' });
	const s = tree.childConcepts.Solve;
	assert.deepEqual(s.provider, ['Solve::run']);
	assert.deepEqual(s.require, ['toSolve']);
	assert.equal(s.solve.specKey, 'spec');
});
