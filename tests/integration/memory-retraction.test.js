'use strict';
/**
 * Memory-on-retraction: when a path/concept is RETRACTED (a premise fell), its
 * `cleaner` deposits a durable memory entry — on a stable anchor free-node that
 * SURVIVES the retraction — recording what failed and why. Future strategy
 * concepts can read it to avoid repeats. Race-safe by construction: the memory is
 * stored under a DISTINCT key (failed_<id>), not appended to a shared array
 * (Entity.set REPLACES arrays, so append would race).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('a retracted concept leaves a durable memory entry on a surviving anchor', async () => {
	// cleaner provider: write a distinct-key memory entry onto the stable `memory` anchor
	Graph._providers = {
		Mem: {
			record(graph, concept, scope, argz, cb) {
				const tpl = { $$_id: 'memory' };
				tpl['failed_' + scope._._id] = {
					strategy: concept._name,
					reason: 'viable=' + scope._.viable,
					atRev: graph.getCurrentRevision()
				};
				cb(null, tpl);
			}
		}
	};
	const conceptMap = {
		common: {
			childConcepts: {
				// Plan casts while viable; when viable falls it uncasts -> cleaner records the failure
				Plan: { _id: 'Plan', _name: 'Plan', require: 'Segment', ensure: ['$viable'], cleaner: ['Mem::record'] }
			}
		}
	};
	const seed = {
		lastRev: 0,
		freeNodes: [{ _id: 'memory' }],
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 's', originNode: 'a', targetNode: 'b', viable: true }]
	};

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('memory-retraction timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		const g = new Graph(seed, {
			label: 'mem', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(graph) {
				try {
					if (phase === 0) {
						phase = 1;
						assert.equal(graph._objById['s']._etty._.Plan, true, 'Plan cast while viable');
						assert.ok(!graph._objById['memory']._etty._.failed_s, 'no memory yet');
						// premise falls -> Plan must retract -> cleaner records
						graph.pushMutation({ $$_id: 's', viable: false }, 's');
						if (!graph._running) graph._taskFlow.run();
					} else if (phase === 1) {
						clearTimeout(timer);
						assert.ok(!graph._objById['s']._etty._.Plan, 'Plan retracted after premise fell');
						const mem = graph._objById['memory']._etty._.failed_s;
						assert.ok(mem, 'memory entry deposited on the surviving anchor');
						assert.equal(mem.strategy, 'Plan', 'records which strategy failed');
						assert.equal(mem.reason, 'viable=false', 'records why it failed');
						assert.equal(typeof mem.atRev, 'number', 'records the revision');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
