'use strict';
/**
 * BRICK 3 — CASE-PARAMETERIZED SELECTION in the concept layer (design doc §4A; the user's "la bonne boucle
 * est définie par les conditions initiales"). Selection of WHICH method applies to a problem is NOT a blind
 * getPaths enumeration — it is driven STEP BY STEP by the CASE's structural (typed) facts, via mutually-
 * exclusive concept gates. `selectCluster(rules, opts)` generates that cluster + a fallback (= the micro-LLM
 * cost-gradient when no typed rule matches). The selected method then MOUNTS its body (composes Brick 1).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { relativize } = require('../../lib/authoring/core/abstract.js');
const { selectCluster, mapTemplate } = require('../../lib/authoring/core/method.js');

// the body the Map method mounts (Brick 1): convert(elem) → Place.
const bodyParam = relativize(
	[ { _id: 'B_out', Node: true, kind: 'Place', from: 'ELEM' },
	  { _id: 'B_seg', Segment: true, originNode: 'ELEM', targetNode: 'B_out', label: 'convert' } ],
	{ base: 'B', refs: { elem: 'ELEM' } }
);

// the selection rules: which method, gated on the case's typed structural fact `outShape`.
const tree = { common: { childConcepts: selectCluster(
	[ { name: 'SelectMap',  when: "$outShape=='collection'", provider: 'S::mountMap' },
	  { name: 'SelectFold', when: "$outShape=='scalar'",     provider: 'S::mountFold' } ],
	{ on: ['outShape'], fallback: 'Unselected', fallbackProvider: 'S::fallback' }
) } };

function bootProviders() {
	const n = { map: 0, fold: 0, fallback: 0 };
	Graph._providers = { S: {
		mountMap: function ( g, c, scope, argz, cb ) {                // selection DRIVES mounting (Brick 1)
			n.map++; const seg = scope._;
			cb(null, [ { $_id: '_parent', SelectMap: true, selected: 'map' } ].concat(mapTemplate({ elements: seg.coll, body: bodyParam })));
		},
		mountFold: function ( g, c, scope, argz, cb ) {               // a DIFFERENT route for a different case
			n.fold++; cb(null, [ { $_id: '_parent', SelectFold: true, selected: 'fold' } ]);
		},
		fallback: function ( g, c, scope, argz, cb ) {                // no typed rule matched → micro-LLM territory
			n.fallback++; cb(null, [ { $_id: '_parent', Unselected: true, selected: 'fallback' } ]);
		}
	} };
	return n;
}

function mkProblem( outShape ) {
	bootProviders();
	return new Graph({ lastRev: 0,
		nodes: [ { _id: 'e0', Node: true, kind: 'POI' }, { _id: 'e1', Node: true, kind: 'POI' }, { _id: 'So', Node: true }, { _id: 'St', Node: true } ],
		segments: [ { _id: 'P', Segment: true, originNode: 'So', targetNode: 'St', toSelect: true, outShape: outShape, coll: ['e0', 'e1'] } ] },
		{ label: 'sel', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
}

const castMarkers = ( g ) => ['SelectMap', 'SelectFold', 'Unselected'].filter(( k ) => g.getEtty('P')._[k] === true);

// 1 + 5 — a 'collection' case selects Map AND mounts its body (selection drives mounting, Brick 1).
test('a collection case selects Map and MOUNTS its body (selection drives mounting)', async () => {
	const g = mkProblem('collection');
	await nextStable(g);
	assert.equal(g.getEtty('P')._.selected, 'map', 'Map was selected by the typed case fact');
	assert.ok(g.getEtty('map0_out') && g.getEtty('map1_out'), 'the selected method actually mounted its body');
	assert.deepEqual([g.getEtty('map0_out')._.from, g.getEtty('map1_out')._.from], ['e0', 'e1']);
});

// 2 — a different case selects a different route.
test('a scalar case selects Fold — a DIFFERENT route, same grammar', async () => {
	const g = mkProblem('scalar');
	await nextStable(g);
	assert.equal(g.getEtty('P')._.selected, 'fold');
	assert.ok(!g.getEtty('map0_out'), 'the Map body was NOT mounted for a scalar case');
});

// 3 — EXCLUSIVITY (the confluence guarantee): exactly one selector casts per segment, never two/zero.
test('exactly ONE selector casts per segment (mutual exclusion = confluence)', async () => {
	for ( const shape of ['collection', 'scalar', 'weird'] ) {
		const g = mkProblem(shape);
		await nextStable(g);
		assert.equal(castMarkers(g).length, 1, `exactly one selector cast for "${shape}" (got ${castMarkers(g)})`);
	}
});

// 4 — NO typed rule matches → the fallback fires (the cost gradient → a runtime micro-LLM), not a crash.
test('an unknown case falls back to Unselected (cost gradient, not a hard fail)', async () => {
	const g = mkProblem('weird');
	await nextStable(g);
	assert.equal(g.getEtty('P')._.selected, 'fallback');
	assert.equal(castMarkers(g)[0], 'Unselected');
});
