'use strict';
/**
 * Roadmap #11.c.4 (the "#4" open-R&D enabler) — QUEUED ROLLBACK. Like add/patchConcept
 * (#11.a), `rollbackTo` issued mid-stabilize (from a meta-concept's provider) must NOT
 * re-mount re-entrantly — it defers to the quiescent `_loopTF` boundary, then re-mounts
 * cleanly. This is the missing primitive that lets the supervisor be a fully-reactive
 * concept flow instead of a host-orchestrated loop.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
console.log = console.info = console.warn = () => {};

const seg = (g) => g._objById['seg']._etty;

test('#11.c.4 rollbackTo issued mid-stabilize defers to the quiescent boundary and applies cleanly', async () => {
	Graph._providers = {
		Rewind: {
			go(graph, concept, scope, argz, cb) {
				// fired mid-stabilize: the rollback must DEFER (not re-mount under our feet)
				graph.__wasStabilizing = graph._stabilizing;
				graph.__pendingAfter = (graph.rollbackTo(graph.__r0), graph._pendingRollback);
				cb(null, { $_id: '_parent', Rewind: true });
			}
		}
	};
	const conceptMap = { common: { childConcepts: {
		Rewind: { _id: 'Rewind', _name: 'Rewind', require: 'rewindTrigger', provider: ['Rewind::go'] }
	} } };
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('rollback-queue timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			label: 'rollback-queue', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						g.__r0 = g.getCurrentRevision();
						assert.ok(!seg(g)._.Rewind, 'no Rewind yet');
						// add facts post-r0 AND the trigger that fires Rewind (whose provider rolls back to r0)
						g.pushMutation({ $$_id: 'seg', extra: 'after-r0', rewindTrigger: true }, 'seg');
					} else if (phase === 1) {
						clearTimeout(timer);
						assert.equal(g.__wasStabilizing, true, 'rollbackTo was called mid-stabilize');
						assert.equal(g.__pendingAfter, g.__r0, 'it was deferred (queued), not applied inline');
						assert.ok(!seg(g)._.extra, 'rolled back: the post-r0 fact is gone');
						assert.ok(!seg(g)._.rewindTrigger, 'rolled back: the trigger fact is gone');
						assert.ok(!seg(g)._.Rewind, 'rolled back: Rewind un-cast');
						assert.equal(g.getCurrentRevision(), g.__r0, 'graph is back at r0');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
