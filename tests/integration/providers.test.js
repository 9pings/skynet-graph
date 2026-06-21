'use strict';
/**
 * End-to-end: a host registers the PACKAGED CommonGeo provider in one line
 * (no inline haversine glue) and the real `common` Distance concept fires,
 * casting Distance + the distance-dependent Travel concepts. Proves the
 * provider package is wired the way the engine expects (graph.static._providers).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../../_lab/_boot.js');
const { buildConceptTree } = require('../../_lab/concepts.js');
const { register, CommonGeo } = require('../../providers');
console.log = console.info = console.warn = () => {};

test('registered CommonGeo provider drives the real `common` Distance concept', async () => {
	register(Graph, [{ CommonGeo }]);

	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });
	const serialized = {
		lastRev: 0,
		nodes: [
			{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			{ _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } }
		],
		segments: [{ _id: 'long', originNode: 'paris', targetNode: 'singapore' }]
	};

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('providers integration timed out')), 15000);
		let done = false;
		new Graph(serialized, {
			label: 'prov', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				if (done) return; done = true;
				try {
					clearTimeout(timer);
					const seg = g._objById['long']._etty._;
					assert.ok(seg.Distance && seg.Distance.inKm > 10000, `Distance fired via packaged provider (got ${JSON.stringify(seg.Distance)})`);
					assert.equal(seg.LongTravel, true, 'distance-dependent LongTravel concept cast');
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, { common: tree });
	});
});
