'use strict';
/**
 * Tree-decomposition pass (lib/authoring/decompose.js) — DERIVES the interface alphabet
 * (separator facts) + the tiling (forks) from the concept-dependency graph, with treewidth
 * as the cost bound. Promotes experiment E7; the headline numbers are re-asserted here.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
	treeDecomposition, decomposeCliques, conceptCliques, articulationPoints, primalAdj
} = require('../../lib/authoring/decompose');
const { buildConceptTree } = require('../../lib/authoring/concepts');

// --- E7a: synthetic corpus, KNOWN structure. 3 biconnected domains (triangles) joined
// by 2 shared bridge facts {cost, risk}. Ground truth: separators={cost,risk}, 3 tiles. ---
const synthCliques = () => [
	['symptom', 'diagnosis', 'risk'],   // clinical triangle (shares `risk`)
	['distance', 'mode', 'risk'],       // travel ∩ clinical via `risk`
	['distance', 'mode', 'cost'],       // travel ∩ supply via `cost`
	['stock', 'order', 'cost']          // supply triangle (shares `cost`)
];

test('derives the planted bridge facts as the separator interface, and the 3 domains as tiles', () => {
	const r = decomposeCliques(synthCliques());
	assert.deepEqual(r.separators, ['cost', 'risk'], 'separators = the two planted bridges');
	assert.equal(r.nTiles, 3, 'three tiles = the three domains');
	assert.equal(r.treewidth, 2, 'min-fill treewidth of triangles+bridges');
	assert.equal(r.partitionPays, true, 'thin cut + multiple tiles -> partitioning pays');
	// the tiles are the domain interiors (bridges removed)
	const tileSets = r.tiles.map((t) => t.join(',')).sort();
	assert.deepEqual(tileSets, ['diagnosis,symptom', 'distance,mode', 'order,stock']);
});

test('control: the synthetic recovery is non-vacuous — a pairwise CHAIN makes everything a cut vertex', () => {
	// a path of pairwise edges (chains, not biconnected domains) -> almost every internal
	// node is an articulation point, so the pass does NOT report a clean {cost,risk} cut.
	const chain = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']];
	const r = decomposeCliques(chain);
	assert.notDeepEqual(r.separators, ['cost', 'risk']);
	assert.ok(r.separators.length > 2, 'a chain yields many cut vertices, not a thin 2-fact interface');
});

test('full path: extracts cliques from a real concept TREE and recovers the cut', () => {
	// the same planted structure expressed as concepts with require/ensure edges, so the
	// extraction (conceptFacts) + the algorithms run end-to-end like a host would call it.
	const tree = {
		childConcepts: {
			Diagnose: { _id: 'Diagnose', _name: 'Diagnose', require: ['symptom'], ensure: ['$risk != null'], applyMutations: [{ $_id: '_parent', diagnosis: true }] },
			TravelRisk: { _id: 'TravelRisk', _name: 'TravelRisk', require: ['distance'], ensure: ['$risk != null', '$mode != null'] },
			TravelCost: { _id: 'TravelCost', _name: 'TravelCost', require: ['distance'], ensure: ['$cost != null', '$mode != null'] },
			Reorder: { _id: 'Reorder', _name: 'Reorder', require: ['stock'], ensure: ['$cost != null'], applyMutations: [{ $_id: '_parent', order: true }] }
		}
	};
	const cliques = conceptCliques(tree);
	assert.equal(cliques.length, 4, 'one clique per concept');
	const r = treeDecomposition(tree);
	// cost and risk are the shared cut facts here too
	assert.ok(r.separators.includes('cost') && r.separators.includes('risk'), 'recovers cost+risk as separators');
	assert.ok(r.nTiles >= 3, 'tiles for the 3 domains');
});

test('real `common` set: treewidth + separator sanity (characterization)', () => {
	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });
	const r = treeDecomposition(tree);
	assert.equal(r.treewidth, 3, 'common-set treewidth');
	assert.deepEqual(r.separators, ['Distance', 'Stay'], 'the real hub facts are the derived interface');
	assert.equal(r.nTiles, 8, 'derived tiles over the common set');
	assert.equal(r.partitionPays, true);
});

test('negative control: a dense/expander corpus has high treewidth and NO thin separators', () => {
	// every concept touches a shared 5-fact hub -> biconnected, no cut vertex -> 1 tile.
	const hub = ['h0', 'h1', 'h2', 'h3', 'h4'];
	const dense = Array.from({ length: 8 }, (_, i) => [...hub, 'x' + i]);
	const r = decomposeCliques(dense);
	assert.equal(r.separators.length, 0, 'no articulation point in a dense hub');
	assert.equal(r.nTiles, 1, 'a single tile — partition does not pay');
	assert.equal(r.partitionPays, false);
	assert.ok(r.treewidth >= 5, 'dense -> high treewidth (>= the hub size)');
});

test('primalAdj builds an undirected clique per fact-set', () => {
	const adj = primalAdj([['a', 'b', 'c']]);
	assert.deepEqual([...adj.get('a')].sort(), ['b', 'c']);
	assert.equal(articulationPoints(adj).size, 0, 'a single triangle is biconnected');
});
