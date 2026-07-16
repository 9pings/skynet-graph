'use strict';
/**
 * authorConcept admission gate (study 2026-06-26, pass 2): the CEGIS loop gains an
 * optional `spec.gate` step between author-time validation and install. A proposal that
 * VALIDATES but the gate REJECTS is not installed — the rejection is a counterexample.
 * This is how the MDL/utility abstraction gate (lib/authoring/core/abstraction.js) plugs into
 * the authoring loop so it self-admits abstractions.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { authorConcept } = require('../../lib/authoring/core/author.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
console.log = console.info = console.warn = () => {};

function boot(label) {
	Graph._providers = {};
	const g = new Graph(
		{ lastRev: 0, nodes: [{ _id: 'n', x: true }], segments: [] },
		{ label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts: {} } }
	);
	return nextStable(g).then(() => g);
}
const mProposal = () => ({ op: 'add', parent: null, schema: { _id: 'M', _name: 'M', require: ['x'], applyMutations: [{ $_id: '_parent', M: true }] } });
const goal = (g) => ({ met: !!(g._objById['n']._etty._.M), counterexample: 'M not cast' });

test('a validated proposal the gate rejects is NOT installed (counterexample)', async () => {
	const g = await boot('gate-reject');
	const res = await authorConcept(g, { propose: async () => mProposal(), goal, gate: async () => ({ admit: false, reason: 'mdl-negative' }), maxRounds: 2 });
	assert.equal(res.ok, false);
	assert.equal(g.getConceptByName('M'), null, 'M must not be installed');
	assert.ok(res.rounds.some((r) => /gate-rejected/.test(r.counterexample || '')), 'rejection recorded as a counterexample');
});

test('a validated proposal the gate admits IS installed and meets the goal', async () => {
	const g = await boot('gate-admit');
	const res = await authorConcept(g, { propose: async () => mProposal(), goal, gate: async () => ({ admit: true }), maxRounds: 2 });
	assert.equal(res.ok, true);
	assert.ok(g.getConceptByName('M'), 'M must be installed');
});
