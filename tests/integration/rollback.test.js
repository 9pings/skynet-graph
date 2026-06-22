'use strict';
/**
 * Graph.rollbackTo: stabilize -> mutate (grow the graph) -> re-stabilize ->
 * rollbackTo(earlier revision) -> the mutation is undone and the earlier
 * coherent state is restored. This is the "Git for reasoning" primitive.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Graph = require('../_boot.js');
const { buildConceptTree } = require('../../lib/authoring/concepts.js');
console.log = console.info = console.warn = () => {};

function haversineKm(a, b) {
	const R = 6371, toR = (x) => (x * Math.PI) / 180;
	const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
	const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}

test('rollbackTo undoes a mutation and restores the earlier stabilized revision', async () => {
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
	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });

	const serialized = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } }
		],
		segments: [{ _id: 'long', originNode: 'paris', targetNode: 'singapore' }]
	};

	let phase = 0, revA = null;

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('rollback test timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };

		const graph = new Graph(serialized, {
			label: 'rb', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						revA = g.getCurrentRevision();
						assert.ok(!g._objById['tokyo'], 'tokyo absent at revA');
						assert.equal(g._objById['long']._etty._.LongTravel, true, 'long is LongTravel at revA');
						// grow the graph: add Tokyo + a Paris->Tokyo segment
						g.pushMutation([
							{ _id: 'tokyo', Node: true, Position: { lat: 35.6762, lng: 139.6503 } },
							{ _id: 'long2', Segment: true, originNode: 'paris', targetNode: 'tokyo' }
						]);
						if (!g._running) g._taskFlow.run(); // ensure re-stabilization is scheduled
					} else if (phase === 1) {
						phase = 2;
						const revB = g.getCurrentRevision();
						assert.ok(revB > revA, `revision advanced after mutation (revA=${revA}, revB=${revB})`);
						assert.ok(g._objById['long2'], 'long2 present at revB');
						assert.equal(g._objById['long2']._etty._.LongTravel, true, 'long2 is LongTravel at revB');
						assert.ok(g.getRevisions().includes(revA), 'revA is a captured snapshot');
						g.rollbackTo(revA);
					} else if (phase === 2) {
						clearTimeout(timer);
						assert.ok(!g._objById['long2'], 'long2 removed after rollback');
						assert.ok(!g._objById['tokyo'], 'tokyo removed after rollback');
						assert.equal(g.getCurrentRevision(), revA, 'current revision restored to revA');
						assert.equal(g._objById['long']._etty._.LongTravel, true, 'long still LongTravel after rollback');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, { common: tree });
	});
});
