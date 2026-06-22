'use strict';
/**
 * End-to-end bootstrap: load the real engine (via @babel/register), mount a tiny
 * graph and stabilize it against the shipped `common` concept set. This drives
 * the safe parser through actual concept asserts (Travel `$Distance.inKm!=0`,
 * LongTravel `$Distance.inKm > 300`, ShortTravel `$Distance.inKm < 300`) — proving
 * the `new Function` -> compileExpression migration works through full stabilization.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Graph = require('../_boot.js');            // @babel/register loads App/index.js
const { buildConceptTree } = require('../../lib/authoring/concepts.js');

// The engine logs verbosely on the global console; silence it for clean test output.
console.log = console.info = console.warn = () => {};

function haversineKm(a, b) {
	const R = 6371, toR = (x) => (x * Math.PI) / 180;
	const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
	const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}

test('engine stabilizes the `common` concept set via the safe parser', async () => {
	Graph._providers = {
		CommonGeo: {
			Distance(graph, concept, scope, argz, cb) {
				const p1 = graph.getRef('originNode:Position', scope);
				const p2 = graph.getRef('targetNode:Position', scope);
				if (!p1 || !p2) return cb(null, null);
				cb(null, { $_id: '_parent', Distance: { inKm: Math.round(haversineKm(p1, p2)) } });
			}
		}
	};

	const tree = buildConceptTree(
		path.join(__dirname, '..', '..', 'concepts', 'common'),
		{ exclude: ['targetNode'] } // concept name collides with the segment's targetNode field
	);

	const serialized = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } },
			{ _id: 'versailles', Position: { lat: 48.8049, lng: 2.1204 } }
		],
		segments: [
			{ _id: 'long', originNode: 'paris', targetNode: 'singapore' },
			{ _id: 'short', originNode: 'paris', targetNode: 'versailles', Theoric: true }
		]
	};

	const graph = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('graph did not stabilize in 8s')), 8000);
		let settled = false;
		new Graph(serialized, {
			label: 'int-test', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) { if (settled) return; settled = true; clearTimeout(timer); resolve(g); }
		}, { common: tree });
	});

	const flagsOf = (id) => graph._objById[id]._etty._;

	// Paris -> Singapore (~10700 km): Travel + LongTravel, not ShortTravel
	assert.ok(flagsOf('long').Distance && flagsOf('long').Distance.inKm > 300, 'long has a >300km Distance');
	assert.equal(flagsOf('long').Travel, true);
	assert.equal(flagsOf('long').LongTravel, true);
	assert.ok(!flagsOf('long').ShortTravel);

	// Paris -> Versailles (~18 km): Travel + ShortTravel, not LongTravel
	assert.ok(flagsOf('short').Distance && flagsOf('short').Distance.inKm < 300, 'short has a <300km Distance');
	assert.equal(flagsOf('short').Travel, true);
	assert.equal(flagsOf('short').ShortTravel, true);
	assert.ok(!flagsOf('short').LongTravel);
});
