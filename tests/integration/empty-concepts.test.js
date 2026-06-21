'use strict';
/**
 * Robustness: a concept set with no childConcepts (`{ childConcepts: {} }`, or a
 * root with none) must mount + stabilize cleanly — a graph with zero capabilities
 * is a degenerate-but-valid state (e.g. before any expert is registered). Before
 * the guard this crashed Entity.init with `Object.keys(undefined)` on the root
 * concept's absent `_openConcepts`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
console.log = console.info = console.warn = () => {};

test('a concept set with no childConcepts mounts and stabilizes instead of crashing', async () => {
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b' }] };

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('empty-concepts graph never stabilized')), 10000);
		let done = false, graph;
		try {
			graph = new Graph(seed, {
				label: 'empty', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
				onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
			}, { common: { childConcepts: {} } });
		} catch (e) { clearTimeout(timer); reject(e); }
	});

	// objects exist and are stable, just with no concepts cast
	assert.ok(g._objById['s'], 'segment mounted');
	assert.deepEqual(g._objById['s']._etty._mapOpenConcepts, [], 'no open concepts on a childless root');
	// the engine is still usable: a later mutation settles too
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('post-mutation stabilize timed out')), 10000);
		g.on('stabilize', function once() { g.un('stabilize', once); clearTimeout(timer); resolve(); });
		g.pushMutation({ $$_id: 's', note: 'hi' }, 's');
		if (!g._running) g._taskFlow.run();
	});
	assert.equal(g._objById['s']._etty._.note, 'hi', 'mutation applied on the childless-concept graph');
});
