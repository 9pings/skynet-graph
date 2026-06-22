'use strict';
/**
 * Graph.addConcept: install a NEW expert (concept) into the live library and
 * re-evaluate the graph against it — no restart, no rebuild. The symmetric twin
 * of patchConcept (roadmap #10, declarative AI-authoring): an authoring loop
 * proposes a concept term, the validator gates it, addConcept installs it.
 *
 * Behaviours covered:
 *   - a root-level concept added at runtime casts onto a live applicable object;
 *   - a concept added under an already-cast parent casts + cascades to a grandchild;
 *   - a concept whose `require` is not yet present stays dormant, then fires when
 *     the required fact later appears (the deferred-require watcher);
 *   - structural guards: a duplicate `_id` and an unknown parent both throw.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

const baseConf = (label) => ({
	label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}
});

test('addConcept at root casts the new concept onto a live applicable object', async () => {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {} } };
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('add-root timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			...baseConf('add-root'),
			onStabilize(g) {
				try {
					const seg = g._objById['seg']._etty;
					if (phase === 0) {
						phase = 1;
						assert.ok(!seg._.Far, 'no Far concept exists yet');
						g.addConcept(null, {
							_id: 'Far', _name: 'Far', require: 'Distance',
							assert: ['$Distance.inKm > 300']
						});
					} else if (phase === 1) {
						clearTimeout(timer);
						assert.equal(seg._.Far, true, 'seg gained Far (400 > 300) from the runtime-added concept');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});

test('addConcept under an already-cast parent casts and its own child cascades', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: {
			childConcepts: {
				Far: {
					_id: 'Far', _name: 'Far', require: 'Distance',
					assert: ['$Distance.inKm > 300']
				}
			}
		}
	};
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('add-child timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			...baseConf('add-child'),
			onStabilize(g) {
				try {
					const seg = g._objById['seg']._etty;
					if (phase === 0) {
						phase = 1;
						assert.equal(seg._.Far, true, 'parent Far is cast');
						// add VeryFar as a child of the already-cast Far, with its own child Extreme
						g.addConcept('Far', {
							_id: 'VeryFar', _name: 'VeryFar', require: 'Far',
							assert: ['$Distance.inKm > 350'],
							childConcepts: {
								Extreme: {
									_id: 'Extreme', _name: 'Extreme', require: 'VeryFar',
									assert: ['$Distance.inKm > 380']
								}
							}
						});
					} else if (phase === 1) {
						clearTimeout(timer);
						assert.equal(seg._.VeryFar, true, 'VeryFar cast under the live cast parent (400 > 350)');
						assert.equal(seg._.Extreme, true, 'grandchild Extreme cascaded (400 > 380)');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});

test('addConcept with an unresolved require stays dormant, then fires when the fact appears', async () => {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {} } };
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b' }]  // no Distance yet
	};

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('deferred-require timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			...baseConf('deferred-require'),
			onStabilize(g) {
				try {
					const seg = g._objById['seg']._etty;
					if (phase === 0) {
						phase = 1;
						g.addConcept(null, {
							_id: 'Far', _name: 'Far', require: 'Distance',
							assert: ['$Distance.inKm > 300']
						});
					} else if (phase === 1) {
						phase = 2;
						assert.ok(!seg._.Far, 'Far is dormant — its require Distance is absent');
						g.pushMutation({ $$_id: 'seg', Distance: { inKm: 400 } }, 'seg');
					} else if (phase === 2) {
						clearTimeout(timer);
						assert.equal(seg._.Far, true, 'Far fired once Distance appeared (deferred-require watcher)');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});

test('addConcept rejects a duplicate _id and an unknown parent', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: { childConcepts: { Far: { _id: 'Far', _name: 'Far', assert: ['true'] } } }
	};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }], segments: [] };

	let done = false;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('guards timed out')), 15000);
		new Graph(seed, {
			...baseConf('add-guards'),
			onStabilize(g) {
				if (done) return;
				done = true;
				clearTimeout(timer);
				try {
					assert.throws(
						() => g.addConcept(null, { _id: 'Far', _name: 'Far2', assert: ['true'] }),
						/exists|duplicate|collision/i,
						'duplicate _id is rejected'
					);
					assert.throws(
						() => g.addConcept('NoSuchParent', { _id: 'New', _name: 'New', assert: ['true'] }),
						/parent|no concept/i,
						'unknown parent is rejected'
					);
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, conceptMap);
	});
});
