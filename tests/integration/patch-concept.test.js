'use strict';
/**
 * Graph.patchConcept: hot-patch an expert (concept) and re-evaluate the whole
 * graph against it, in BOTH directions:
 *   - tightening an assert UNCASTS the concept where it no longer holds,
 *     and that retraction CASCADES to the concept's children (JTMS defeasance);
 *   - loosening an assert CASTS the concept onto objects that just became
 *     applicable.
 * This is the "patch d'experts à chaud" differentiator — no restart, no rebuild.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
console.log = console.info = console.warn = () => {};

test('patchConcept tightening an assert uncasts the concept and cascades to its children', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: {
			childConcepts: {
				Far: {
					_id: 'Far', _name: 'Far', require: 'Distance',
					assert: ['$Distance.inKm > 300'],
					childConcepts: {
						VeryFar: {
							_id: 'VeryFar', _name: 'VeryFar', require: 'Far',
							assert: ['$Distance.inKm > 350']
						}
					}
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
		const timer = setTimeout(() => reject(new Error('patch tighten test timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			label: 'patch-tighten', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					const seg = g._objById['seg']._etty;
					if (phase === 0) {
						phase = 1;
						assert.equal(seg._.Far, true, 'seg is Far at 400km (>300)');
						assert.equal(seg._.VeryFar, true, 'seg is VeryFar at 400km (>350)');
						g.patchConcept('Far', { assert: ['$Distance.inKm > 500'] });
					} else if (phase === 1) {
						clearTimeout(timer);
						assert.ok(!seg._.Far, 'seg lost Far after patch (400 not > 500)');
						assert.ok(!seg._.VeryFar, 'seg lost VeryFar via cascade uncast of the parent');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});

test('patchConcept loosening an assert casts the concept onto newly-applicable objects', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: {
			childConcepts: {
				Far: {
					_id: 'Far', _name: 'Far', require: 'Distance',
					assert: ['$Distance.inKm > 500']
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
		const timer = setTimeout(() => reject(new Error('patch loosen test timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			label: 'patch-loosen', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					const seg = g._objById['seg']._etty;
					if (phase === 0) {
						phase = 1;
						assert.ok(!seg._.Far, 'seg is NOT Far at 400km (>500)');
						g.patchConcept('Far', { assert: ['$Distance.inKm > 300'] });
					} else if (phase === 1) {
						clearTimeout(timer);
						assert.equal(seg._.Far, true, 'seg gained Far after loosening to >300');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
