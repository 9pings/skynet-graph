'use strict';
/**
 * Distributed runtime — spawn a sub-graph in a separate worker_thread and get its
 * stabilized snapshot back. Two boundary cases:
 *   1. a LOCAL provider (packaged Geo) the worker runs itself;
 *   2. a PROXIED effect — the worker's provider calls back to the parent's `ask`
 *      (the model-call-as-generic-request path), proving the only non-serializable
 *      thing (a parent-bound backend) round-trips cleanly across the process boundary.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Graph = require('../../lib/index.js');
console.log = console.info = console.warn = () => {};

test('spawnGraph stabilizes a sub-graph in a worker with a local Geo provider', async () => {
	const conceptMap = Graph.loadConceptMap(path.join(__dirname, '..', '..', 'concepts'));
	const seed = { conceptMaps: [
		{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
		{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },
		{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
	] };
	const snapshot = await Graph.spawnGraph({ conceptMap, geo: true, seed });
	const s = JSON.parse(snapshot.graph).conceptMaps.find(o => o._id === 's');
	assert.ok(s && s.Distance, 'Distance cast in the worker');
	assert.ok(s.Distance.inKm > 10000 && s.Distance.inKm < 11000, 'Paris->Singapore ~10728km, got ' + s.Distance.inKm);
});

test('a worker provider proxies a model call back to the parent ask()', async () => {
	// fixture provider on disk: a factory using the (proxied) ctx.ask
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-worker-'));
	fs.writeFileSync(path.join(dir, 'remote.js'),
		'module.exports = (ctx) => ({ Remote: { work(graph, concept, scope, argz, cb) {\n' +
		'  Promise.resolve(ctx.ask({ q: "work" })).then(r => cb(null, { $_id: "_parent", Remote: true, work: r }), e => cb(e));\n' +
		'} } });\n');

	const conceptMap = { common: { childConcepts: {
		Remote: { _id: 'Remote', _name: 'Remote', require: 'Segment', provider: ['Remote::work'] }
	} } };
	const seed = { nodes: [{ _id: 'n1' }, { _id: 'n2' }], segments: [{ _id: 'sg', originNode: 'n1', targetNode: 'n2' }] };

	let asked = null;
	const ask = ( prompt ) => { asked = prompt; return Promise.resolve(prompt && prompt.q === 'work' ? 99 : 0); };

	const snapshot = await Graph.spawnGraph({ conceptMap, providers: dir, ask, seed });
	fs.rmSync(dir, { recursive: true, force: true });

	assert.deepEqual(asked, { q: 'work' }, 'parent ask received the proxied call');
	const sg = JSON.parse(snapshot.graph).conceptMaps.find(o => o._id === 'sg');
	assert.ok(sg && sg.Remote === true, 'Remote concept cast on the segment');
	assert.equal(sg.work, 99, 'the proxied model result was written back as a fact');
});
