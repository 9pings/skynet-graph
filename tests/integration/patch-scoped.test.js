'use strict';
/**
 * Roadmap #11.b — scoped re-eval. patchConcept's re-eval was O(graph) (it scanned
 * EVERY object). This characterizes the behavior the scoped version MUST preserve:
 * across many objects, a patch must still cast/uncast EXACTLY the right ones — in
 * particular it must reach an object that was NEVER cast but becomes applicable after
 * a loosening patch (the cast direction, scoped via `_mapsByConcept[<require>]`), and
 * must not disturb objects that don't carry the concept's require fact at all.
 *
 * (A behavior-preserving optimization: this passes both before and after the scope
 * change; it is the regression guard that the scope set is a sound superset.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('#11.b patchConcept casts/uncasts exactly the right objects across many objects (both directions)', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: { childConcepts: {
			Far: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] }
		} }
	};
	// three segments with Distance + extra bare nodes that never carry Distance (must stay untouched)
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'd' }, { _id: 'e' }, { _id: 'f' }],
		segments: [
			{ _id: 's1', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } },
			{ _id: 's2', originNode: 'c', targetNode: 'd', Distance: { inKm: 200 } },
			{ _id: 's3', originNode: 'e', targetNode: 'f', Distance: { inKm: 500 } }
		]
	};
	const far = (g, id) => g._objById[id]._etty._.Far;

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('patch-scoped timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			label: 'patch-scoped', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						assert.equal(far(g, 's1'), true, 's1 (400) Far');
						assert.ok(!far(g, 's2'), 's2 (200) not Far');
						assert.equal(far(g, 's3'), true, 's3 (500) Far');
						g.patchConcept('Far', { assert: ['$Distance.inKm > 450'] });   // tighten -> uncast s1
					} else if (phase === 1) {
						phase = 2;
						assert.ok(!far(g, 's1'), 's1 (400) lost Far after tighten to >450');
						assert.ok(!far(g, 's2'), 's2 still not Far');
						assert.equal(far(g, 's3'), true, 's3 (500) kept Far');
						g.patchConcept('Far', { assert: ['$Distance.inKm > 100'] });   // loosen -> cast ALL incl. never-cast s2
					} else if (phase === 2) {
						clearTimeout(timer);
						assert.equal(far(g, 's1'), true, 's1 regained Far');
						assert.equal(far(g, 's2'), true, 's2 cast for the FIRST time (scope reached a never-cast object)');
						assert.equal(far(g, 's3'), true, 's3 still Far');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
