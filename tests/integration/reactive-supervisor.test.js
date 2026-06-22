'use strict';
/**
 * Roadmap #11.c.4 — the supervisor as a REACTIVE concept flow (not a host loop),
 * enabled by queued rollback. This drives the happy path end-to-end through concepts:
 * a `Stuck` sub-problem → `Supervise` hypothesizes a self-mod → the fix lands → `Evaluate`
 * (the better-model judge) returns 'better' → `Revert` does NOT fire → the problem is
 * resolved. The Revert/queued-rollback path itself is covered by rollback-queue.test.js
 * (a concept's provider triggering a deferred rollback).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { reactiveSupervisorTree, makeSupervisorProviders } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

const seg = (g) => g._objById['seg']._etty;

test('#11.c.4 reactive supervisor resolves a Stuck problem through a concept flow (happy path)', async () => {
	// the injected STRATEGY: add a fix expert that resolves the problem (posts the
	// completion marker `hypothesized` so Evaluate fires, `resolved`, and clears `Stuck`).
	const hypothesize = (graph) => {
		if (!graph._conceptLib['Fix'])
			graph.addConcept(null, {
				_id: 'Fix', _name: 'Fix', require: 'Stuck',
				applyMutations: [{ $_id: '_parent', Fix: true, hypothesized: true, resolved: true, Stuck: null }]
			});
	};
	// the SUPERVISOR judgment (a better-model hook): better iff the problem is resolved.
	const evaluate = (graph) => (graph._objById['seg']._etty._.resolved ? 'better' : 'worse');

	Graph._providers = makeSupervisorProviders({ hypothesize, evaluate });
	const conceptMap = { common: reactiveSupervisorTree() };
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 }, Stuck: true }]
	};

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('reactive supervisor timed out')), 15000);
		new Graph(seed, {
			label: 'reactive-sup', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, applyCap: 50,
			onStabilize(g) {
				if (!seg(g)._.resolved) return;          // wait for the reactive flow to resolve it
				clearTimeout(timer);
				try {
					assert.equal(seg(g)._.resolved, true, 'the problem is resolved');
					assert.equal(seg(g)._.Supervise, true, 'Supervise fired reactively');
					assert.equal(seg(g)._.Evaluate, true, 'Evaluate fired reactively');
					assert.equal(seg(g)._.verdict, 'better', 'the supervisor judged the hypothesis better');
					assert.ok(!seg(g)._.Revert, 'Revert did NOT fire (verdict was not worse)');
					assert.ok(g._conceptLib['Fix'], 'the accepted fix expert is in the live lib');
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, conceptMap);
	});
});
