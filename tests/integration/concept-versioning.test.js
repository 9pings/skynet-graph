'use strict';
/**
 * Roadmap #11.c.2 / N6 — concept-library versioning. `rollbackTo(rev)` restored the
 * FACT state but NOT the concept library, so a runtime `add`/`patchConcept` survived a
 * rollback — and worse, the surviving concept re-cast after the rollback re-stabilized
 * (the edit *resurrected*). Under self-modification that breaks "Git for reasoning":
 * rolling back to before a bad AI-authored concept must also remove that concept.
 *
 * The fix snapshots the FULL live concept schema tree alongside each state snapshot and
 * rebuilds the concept library on rollback. Verified by: an added concept is gone (not
 * resurrected) after rolling back to before it, and a patched assert reverts.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

const seg = (g) => g._objById['seg']._etty;
const baseSeed = () => ({
	lastRev: 0,
	nodes: [{ _id: 'a' }, { _id: 'b' }],
	segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
});

test('#11.c.2 rollback removes a concept added after the target rev (no resurrection)', async () => {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {
		Far: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] }
	} } };

	let phase = 0, r0 = null;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('add-revert timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(baseSeed(), {
			label: 'cv-add', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						r0 = g.getCurrentRevision();
						assert.equal(seg(g)._.Far, true, 'Far cast at r0');
						g.addConcept('Far', { _id: 'VeryFar', _name: 'VeryFar', require: 'Far', assert: ['$Distance.inKm > 350'] });
					} else if (phase === 1) {
						phase = 2;
						assert.equal(seg(g)._.VeryFar, true, 'VeryFar cast after add');
						assert.ok(g._conceptLib['VeryFar'], 'VeryFar is in the live concept lib');
						g.rollbackTo(r0);
					} else if (phase === 2) {
						clearTimeout(timer);
						assert.ok(!seg(g)._.VeryFar, 'VeryFar fact gone — and NOT resurrected by a surviving concept');
						assert.ok(!g._conceptLib['VeryFar'], 'the concept itself was removed from the lib (N6)');
						assert.equal(g.getConceptByName('VeryFar'), null, 'getConceptByName no longer resolves VeryFar');
						assert.equal(seg(g)._.Far, true, 'Far (present at r0) is restored');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});

test('#11.c.2 rollback reverts a concept patched after the target rev', async () => {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {
		Far: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] }
	} } };

	let phase = 0, r0 = null;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('patch-revert timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(baseSeed(), {
			label: 'cv-patch', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						r0 = g.getCurrentRevision();
						assert.equal(seg(g)._.Far, true, 'Far cast at r0 (>300)');
						g.patchConcept('Far', { assert: ['$Distance.inKm > 500'] });   // tighten -> uncast Far
					} else if (phase === 1) {
						phase = 2;
						assert.ok(!seg(g)._.Far, 'Far uncast after tightening to >500');
						g.rollbackTo(r0);
					} else if (phase === 2) {
						clearTimeout(timer);
						assert.equal(seg(g)._.Far, true, 'Far re-cast — its assert reverted to >300 (concept-lib restored)');
						assert.deepEqual(g.getConceptByName('Far')._schema.assert, ['$Distance.inKm > 300'], 'the schema itself reverted');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
