'use strict';
/**
 * Standalone boot from directories — the industrialization entry point. Graph.fromDirs
 * loads a concept set + providers from plain folders (no host wiring) and stabilizes:
 * here the shipped `common` set + the packaged Geo provider cast Distance on a segment.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../../lib/index.js');
const { CommonGeo } = require('../../lib/providers');
console.log = console.info = console.warn = () => {};

const CONCEPTS = path.join(__dirname, '..', '..', 'concepts');

test('loadConceptMap auto-detects the set root and builds { common: tree }', () => {
	const map = Graph.loadConceptMap(CONCEPTS);
	assert.ok(map.common, 'common set loaded');
	assert.ok(map.common.childConcepts, 'root has childConcepts');
	// top-level *.json become children keyed by their _id (= file basename)
	assert.ok(map.common.childConcepts.Vertice || map.common.childConcepts.Edge, 'has Vertice/Edge');
});

test('fromDirs boots from ./concepts + Geo provider and casts Distance on a segment', async () => {
	const seed = { conceptMaps: [
		{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },   // Paris
		{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },   // Singapore
		{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
	] };
	const distance = await new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('fromDirs timed out')), 15000);
		Graph.fromDirs({
			concepts : CONCEPTS,
			providers: [{ CommonGeo }],
			seed,
			conf: { onStabilize( g ) {
				const s = JSON.parse(g.serialize().graph).conceptMaps.find(o => o._id === 's');
				if ( s && s.Distance ) { clearTimeout(timer); resolve(s.Distance); }
			} }
		});
	});
	assert.ok(distance.inKm > 10000 && distance.inKm < 11000, 'Paris->Singapore ~10728km, got ' + distance.inKm);
});
