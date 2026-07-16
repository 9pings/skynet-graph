'use strict';
/**
 * Merge-consistency at a real fork/merge frontier (the sheaf C1 brick, experiment E6).
 * Two sub-graphs each contribute a CONTINUOUS log-odds partial; the parent's packaged
 * `Merge::combine` provider crosses them, computes ε, and snaps it; a pure-D `Reconcile`
 * gate (from `consistencyConceptTree`) casts ONLY in the conflict band. The decisive case:
 * confident-conflict and genuine-neutral collide at κ=0.5 but Reconcile distinguishes them.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createConsistency, consistencyConceptTree } = require('../../lib/providers');

console.log = console.info = console.warn = () => {};

// wire the packaged Merge::combine provider (host opt-in)
Graph._providers = Object.assign({}, Graph._providers, createConsistency());

// BeliefRoot hosts the audited contract (Combine crosses+snaps; Reconcile gates on conflict).
const conceptMap = {
	common: {
		childConcepts: {
			BeliefRoot: {
				_id: 'BeliefRoot', _name: 'BeliefRoot', require: ['BeliefRoot'],
				childConcepts: consistencyConceptTree({ partials: ['ellA', 'ellB'] }).childConcepts
			}
		}
	}
};

const cfg = { label: 'merge-consist', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

// run one scenario: two forks each carry a partial, each merged onto the parent belief.
async function scenario(ellA, ellB) {
	const parent = new Graph({ lastRev: 0, nodes: [{ _id: 'belief', BeliefRoot: true }], segments: [] }, cfg, conceptMap);
	await nextStable(parent);

	const fA = parent.fork({ lastRev: 0, nodes: [{ _id: 'src', partial: ellA }], segments: [] }, { label: 'A' });
	await nextStable(fA);
	parent.merge(fA, 'belief', (c) => ({ $$_id: 'belief', ellA: c.getEtty('src')._.partial }));
	await nextStable(parent);

	const fB = parent.fork({ lastRev: 0, nodes: [{ _id: 'src', partial: ellB }], segments: [] }, { label: 'B' });
	await nextStable(fB);
	parent.merge(fB, 'belief', (c) => ({ $$_id: 'belief', ellB: c.getEtty('src')._.partial }));
	await nextStable(parent);

	const f = parent._objById['belief']._etty._;
	return { kappa: f.kappa, eps: f.eps, mergeConsistency: f.mergeConsistency, reconcile: !!f.Reconcile };
}

test('agreement: combine snaps to "agree", Reconcile does not cast', async () => {
	const s = await scenario(1.5, 1.2);
	assert.equal(s.mergeConsistency, 'agree');
	assert.equal(s.reconcile, false);
});

test('confident conflict: ε high -> "conflict" band -> Reconcile casts (κ=0.5)', async () => {
	const s = await scenario(2.5, -2.5);
	assert.ok(Math.abs(s.kappa - 0.5) < 1e-9, 'the monoid collapses to κ=0.5');
	assert.equal(s.mergeConsistency, 'conflict');
	assert.equal(s.reconcile, true, 'the conflict band fires the D Reconcile gate');
});

test('genuine neutral: same κ=0.5 but ε low -> "agree" -> Reconcile does NOT cast', async () => {
	const s = await scenario(0.1, -0.1);
	assert.ok(Math.abs(s.kappa - 0.5) < 1e-9);
	assert.equal(s.mergeConsistency, 'agree');
	assert.equal(s.reconcile, false);
});

test('DECISIVE on the engine: conflict and neutral collide in κ but Reconcile disambiguates', async () => {
	const conflict = await scenario(2.5, -2.5);
	const neutral = await scenario(0.1, -0.1);
	assert.ok(Math.abs(conflict.kappa - neutral.kappa) < 1e-9, 'identical κ — combine alone is blind');
	assert.notEqual(conflict.reconcile, neutral.reconcile, 'ε/mergeConsistency restores the distinction (C1)');
});
