'use strict';
/**
 * Capstone — the "Git for reasoning" workflow, composing the V1 differentiators
 * in one run (each is unit-tested in isolation; this proves they compose):
 *   grow the graph -> fork a sub-agent to explore + merge its result back ->
 *   diff revisions across the journey -> rollback to the start (clean undo).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../../_lab/_boot.js');
const { buildConceptTree } = require('../../_lab/concepts.js');
const { CommonGeo } = require('../../providers');
console.log = console.info = console.warn = () => {};

test('grow -> fork/merge -> diffRevisions -> rollback compose end-to-end', async () => {
	// providers: real geo + a child-only "worker" that explores a sub-problem
	Graph._providers = {
		CommonGeo,
		AI: { work(graph, concept, scope, argz, cb) { cb(null, { $_id: '_parent', Worker: true, work: 42 }); } }
	};
	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });
	const conceptMap = {
		common: tree,
		worker: { childConcepts: { Worker: { _id: 'Worker', _name: 'Worker', require: 'Segment', provider: ['AI::work'] } } }
	};

	const seed = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } }
		],
		segments: [{ _id: 'long', originNode: 'paris', targetNode: 'singapore' }]
	};
	const subSeed = { lastRev: 0, nodes: [{ _id: 's' }, { _id: 't' }], segments: [{ _id: 'sub', originNode: 's', targetNode: 't' }] };

	let phase = 0, revStart = null, revForked = null;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('capstone timed out at phase ' + phase)), 20000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(seed, {
			label: 'g4r', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						revStart = g.getCurrentRevision();
						assert.equal(g._objById['long']._etty._.LongTravel, true, 'baseline: long is LongTravel');
						// (1) grow: add Tokyo + a Paris->Tokyo segment
						g.pushMutation([
							{ _id: 'tokyo', Node: true, Position: { lat: 35.6762, lng: 139.6503 } },
							{ _id: 'far', Segment: true, originNode: 'paris', targetNode: 'tokyo' }
						]);
						if (!g._running) g._taskFlow.run();
					} else if (phase === 1) {
						phase = 2;
						assert.ok(g._objById['far'] && g._objById['far']._etty._.LongTravel, 'grown segment classified');
						// (2) fork a sub-agent (worker capability) to explore; auto-merge onto tokyo
						g.fork(subSeed, {
							label: 'explorer', conceptSets: ['worker'],
							reintegrateInto: 'tokyo',
							project: (child) => ({ $$_id: 'tokyo', explored: child._objById['sub']._etty._.work })
						});
					} else if (phase === 2) {
						phase = 3;
						revForked = g.getCurrentRevision();
						assert.equal(g._objById['tokyo']._etty._.explored, 42, 'forked sub-agent result merged onto tokyo');
						// (3) diff the whole journey
						const d = g.diffRevisions(revStart, revForked);
						assert.deepEqual(Object.keys(d.added).sort(), ['far', 'tokyo'], 'diff: journey added tokyo + far');
						assert.equal(d.added.tokyo.explored, 42, 'diff: merged fact visible in the added object');
						assert.deepEqual(d.removed, {}, 'diff: nothing removed across the journey');
						// (4) rollback to the very start
						g.rollbackTo(revStart);
					} else if (phase === 3) {
						clearTimeout(timer);
						assert.ok(!g._objById['tokyo'], 'rollback undid the growth (tokyo gone)');
						assert.ok(!g._objById['far'], 'rollback undid the growth (far gone)');
						assert.equal(g.getCurrentRevision(), revStart, 'back at the start revision');
						assert.equal(g._objById['long']._etty._.LongTravel, true, 'baseline intact after the whole journey');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
