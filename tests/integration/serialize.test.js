'use strict';
/**
 * Serialization round-trip: serialize() -> new Graph(serialized) -> identical
 * stable state. This is the property rollbackTo() and fork() lean on (both
 * re-mount a serialize() snapshot), so it doubles as a hardening test.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../_boot.js');
const { buildConceptTree } = require('../../lib/authoring/core/concepts.js');
const { register, CommonGeo } = require('../../lib/providers');
console.log = console.info = console.warn = () => {};

register(Graph, [{ CommonGeo }]);
const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });

// stabilize a graph and resolve with it
function run(seed) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('serialize test timed out')), 15000);
		let done = false;
		const g = new Graph(seed, {
			label: 'ser', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); }
		}, { common: tree });
	});
}

// normalized {id -> facts} view of a stabilized graph: drops the volatile _rev
// and any undefined-valued own keys (e.g. `_origin:undefined` on a target-less
// top-level mutation — JSON cannot represent `undefined`, so it can't round-trip
// and isn't a "fact"). We assert that every *defined* fact survives intact.
function factsById(g) {
	const out = {};
	for (const id of Object.keys(g._objById)) {
		const raw = g._objById[id]._etty._, f = {};
		for (const k of Object.keys(raw)) if (k !== '_rev' && raw[k] !== undefined) f[k] = raw[k];
		out[id] = f;
	}
	return out;
}

test('serialize -> new Graph reproduces the exact same stabilized facts', async () => {
	const seed = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } }
		],
		segments: [{ _id: 'long', originNode: 'paris', targetNode: 'singapore' }]
	};
	const g1 = await run(seed);
	const before = factsById(g1);
	assert.equal(before.long.LongTravel, true, 'sanity: long is LongTravel before round-trip');
	assert.ok(before.long.Distance.inKm > 10000, 'sanity: Distance computed');

	const snapshot = g1.serialize();
	assert.ok(typeof snapshot.graph === 'string', 'serialize() yields a JSON string under .graph');

	const g2 = await run(snapshot);
	const after = factsById(g2);

	assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'same set of objects');
	for (const id of Object.keys(before)) assert.deepEqual(after[id], before[id], `facts preserved for ${id}`);
});

test('serialize round-trips a grown graph (mutation result survives)', async () => {
	const seed = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'versailles', Position: { lat: 48.8049, lng: 2.1204 } }
		],
		segments: [{ _id: 'short', originNode: 'paris', targetNode: 'versailles', Theoric: true }]
	};
	const g1 = await run(seed);
	// grow: add Tokyo + a long segment, settle again
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('grow timed out')), 15000);
		g1.on('stabilize', function once() { g1.un('stabilize', once); clearTimeout(timer); resolve(); });
		g1.pushMutation([
			{ _id: 'tokyo', Node: true, Position: { lat: 35.6762, lng: 139.6503 } },
			{ _id: 'far', Segment: true, originNode: 'paris', targetNode: 'tokyo' }
		]);
		if (!g1._running) g1._taskFlow.run();
	});
	const before = factsById(g1);
	assert.ok(before.far && before.far.LongTravel, 'grown segment present + classified');

	const g2 = await run(g1.serialize());
	const after = factsById(g2);
	assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'grown topology preserved');
	for (const id of Object.keys(before)) assert.deepEqual(after[id], before[id], `facts preserved for ${id}`);
});
