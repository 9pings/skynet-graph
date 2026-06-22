'use strict';
/**
 * Manual MOE control: castConcept / unCastConcept (documented public API).
 * Force-cast a concept the engine would not auto-apply (`autoCast:false`),
 * watch a dependent child auto-cast under it, then force-uncast and watch the
 * retraction cascade to the child.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('castConcept force-casts an autoCast:false concept; unCastConcept retracts it and cascades', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: {
			childConcepts: {
				Flag: {
					_id: 'Flag', _name: 'Flag', require: 'Segment', autoCast: false,
					childConcepts: { SubFlag: { _id: 'SubFlag', _name: 'SubFlag', require: 'Flag' } }
				}
			}
		}
	};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b' }] };

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('manual-cast timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			label: 'mcast', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					const s = g._objById['s']._etty;
					if (phase === 0) {
						phase = 1;
						assert.ok(!s._.Flag, 'autoCast:false concept is NOT auto-cast');
						g.castConcept('s', 'Flag');
					} else if (phase === 1) {
						phase = 2;
						assert.equal(s._.Flag, true, 'castConcept force-cast Flag');
						assert.equal(s._.SubFlag, true, 'dependent child SubFlag auto-cast under Flag');
						g.unCastConcept('s', 'Flag');
					} else if (phase === 2) {
						clearTimeout(timer);
						assert.ok(!s._.Flag, 'unCastConcept retracted Flag');
						assert.ok(!s._.SubFlag, 'retraction cascaded to SubFlag');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
