'use strict';
/**
 * fork/merge as a thin wrapper over the proven sub-graph pattern: fork() spins up
 * an independent child Graph (a sub-agent, here with a DIFFERENT concept set =
 * different capabilities) that works a sub-problem on its own; on the child's
 * stabilize its result is reintegrated into the parent via pushMutation, then the
 * child is destroyed. No new core engine machinery.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('fork runs an independent sub-agent and merge reintegrates its result', async () => {
	// child-only capability: a provider that "works" a segment
	Graph._providers = {
		AI: { work(graph, concept, scope, argz, cb) { cb(null, { $_id: '_parent', Worker: true, work: 42 }); } }
	};

	const conceptMap = {
		// parent does nothing but stabilize (Idle never fires: requires an absent flag)
		common: { childConcepts: { Idle: { _id: 'Idle', _name: 'Idle', require: 'NeverPresent' } } },
		worker: { childConcepts: { Worker: { _id: 'Worker', _name: 'Worker', require: 'Segment', provider: ['AI::work'] } } }
	};

	const parentSeed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 'root', originNode: 'a', targetNode: 'b' }] };
	const subSeed = { lastRev: 0, nodes: [{ _id: 's' }, { _id: 't' }], segments: [{ _id: 'sub', originNode: 's', targetNode: 't' }] };

	let phase = 0, childRef = null;

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('fork test timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };

		const parent = new Graph(parentSeed, {
			label: 'parent', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						// parent did not run the Worker capability
						assert.ok(!g._objById['root']._etty._.work, 'parent has no Worker capability');
						// fork a sub-agent with the `worker` concept set; auto-reintegrate onto root
						childRef = g.fork(subSeed, {
							label: 'child', conceptSets: ['worker'],
							reintegrateInto: 'root',
							project: (child) => ({ $$_id: 'root', mergedWork: child._objById['sub']._etty._.work })
						});
						assert.equal(typeof childRef.stabilize === 'function' || typeof childRef.fork === 'function', true, 'fork returns a Graph');
					} else if (phase === 1) {
						clearTimeout(timer);
						// the child's result was merged back onto the parent's root segment
						assert.equal(g._objById['root']._etty._.mergedWork, 42, 'child result reintegrated onto parent');
						// and the child was destroyed
						assert.equal(childRef._dead, true, 'forked child destroyed after merge');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
