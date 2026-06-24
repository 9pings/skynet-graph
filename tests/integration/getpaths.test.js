'use strict';
/**
 * getPaths(from, to): core path discovery over the directed segment topology
 * (node._outgoing). Returns { maps, paths } where each path is an alternating
 * [node, seg, node, seg, ..., node] list. This is what the Neurosymbolic Reasoning Graph
 * "rank/select alternative branches" use-case is built on.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

// build + stabilize a graph with no concepts (topology only), resolve with it
function run(seed) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('getPaths graph never stabilized')), 10000);
		let done = false;
		const g = new Graph(seed, {
			label: 'paths', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); }
		}, { common: { childConcepts: {} } });
	});
}

test('getPaths finds the single route across a linear chain', async () => {
	const g = await run({
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
		segments: [{ _id: 'ab', originNode: 'a', targetNode: 'b' }, { _id: 'bc', originNode: 'b', targetNode: 'c' }]
	});
	const { paths, maps } = g.getPaths('a', 'c');
	assert.equal(paths.length, 1, 'exactly one route a->c');
	assert.deepEqual(paths[0], ['a', 'ab', 'b', 'bc', 'c'], 'alternating node/seg path');
	for (const id of ['a', 'b', 'c', 'ab', 'bc']) assert.ok(maps[id], `maps includes ${id}`);
});

test('getPaths finds both branches across a diamond, and an empty set when unreachable', async () => {
	const g = await run({
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'd' }],
		segments: [
			{ _id: 'ab', originNode: 'a', targetNode: 'b' },
			{ _id: 'bd', originNode: 'b', targetNode: 'd' },
			{ _id: 'ac', originNode: 'a', targetNode: 'c' },
			{ _id: 'cd', originNode: 'c', targetNode: 'd' }
		]
	});
	const { paths } = g.getPaths('a', 'd');
	assert.equal(paths.length, 2, 'two routes a->d');
	const asStr = paths.map((p) => p.join('>')).sort();
	assert.deepEqual(asStr, ['a>ab>b>bd>d', 'a>ac>c>cd>d'], 'both diamond branches found');

	// d has no outgoing edges -> nothing reachable from d
	assert.deepEqual(g.getPaths('d', 'a').paths, [], 'no path d->a (edges are directed)');
});
