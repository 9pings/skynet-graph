'use strict';
/**
 * Revision indexing/search over the snapshots captured on every stabilize:
 *   - getSnapshot(rev)        -> the serialized snapshot for a revision (or null)
 *   - diffRevisions(a, b)     -> per-object { added, removed, changed } facts
 * This is the inspection layer of "Git for reasoning": what did revision B add /
 * remove / change versus revision A.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../../_lab/_boot.js');
const { buildConceptTree } = require('../../_lab/concepts.js');
const { register, CommonGeo } = require('../../providers');
console.log = console.info = console.warn = () => {};

register(Graph, [{ CommonGeo }]);
const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });

// advance the graph by running `mutate` and awaiting the next stabilize
function settle(g, mutate) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('settle timed out')), 15000);
		g.on('stabilize', function once() { g.un('stabilize', once); clearTimeout(timer); resolve(); });
		mutate();
		if (!g._running) g._taskFlow.run();
	});
}

test('getSnapshot + diffRevisions expose added / removed / changed across revisions', async () => {
	const seed = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } }
		],
		segments: [{ _id: 'long', originNode: 'paris', targetNode: 'singapore' }]
	};

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('init timed out')), 15000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'rev', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
		}, { common: tree });
	});

	const revA = g.getCurrentRevision();

	// --- getSnapshot ---
	const snapA = g.getSnapshot(revA);
	assert.ok(snapA && typeof snapA.graph === 'string', 'getSnapshot returns the serialized snapshot');
	assert.equal(g.getSnapshot(999999), null, 'getSnapshot of an uncaptured revision is null');
	assert.ok(g.getRevisions().includes(revA), 'revA is in getRevisions()');

	// --- grow: add tokyo + a Paris->Tokyo segment ---
	await settle(g, () => g.pushMutation([
		{ _id: 'tokyo', Node: true, Position: { lat: 35.6762, lng: 139.6503 } },
		{ _id: 'far', Segment: true, originNode: 'paris', targetNode: 'tokyo' }
	]));
	const revB = g.getCurrentRevision();
	assert.ok(revB > revA, 'revision advanced after growth');

	const d1 = g.diffRevisions(revA, revB);
	assert.deepEqual(Object.keys(d1.added).sort(), ['far', 'tokyo'], 'growth shows new objects as added');
	assert.deepEqual(d1.removed, {}, 'nothing removed by growth');
	assert.ok(!d1.changed.long, 'existing `long` unchanged by growth');
	assert.ok(d1.added.far.LongTravel, 'added object carries its computed facts');

	// --- change an existing object's fact ($$_id targets the existing object) ---
	await settle(g, () => g.pushMutation({ $$_id: 'long', priority: 5 }, 'long'));
	const revC = g.getCurrentRevision();

	const d2 = g.diffRevisions(revB, revC);
	assert.deepEqual(d2.added, {}, 'no objects added by an update');
	assert.deepEqual(d2.removed, {}, 'no objects removed by an update');
	assert.ok(d2.changed.long, '`long` reported as changed');
	assert.deepEqual(d2.changed.long.priority, [undefined, 5], 'changed reports [before, after] for the field');

	// --- symmetric: diff the other way shows removals ---
	const dRev = g.diffRevisions(revB, revA);
	assert.deepEqual(Object.keys(dRev.removed).sort(), ['far', 'tokyo'], 'reverse diff lists the same objects as removed');
	assert.deepEqual(dRev.added, {}, 'reverse diff adds nothing');

	assert.throws(() => g.diffRevisions(revA, 424242), /no snapshot/i, 'diffRevisions validates revisions');
});
