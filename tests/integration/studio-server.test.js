'use strict';
/**
 * Studio registry (fork/merge across sessions, corpus discovery) and — later —
 * the ws server round-trip. Driven without a browser.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Graph = require('../../lib/index.js');
const Studio = require('../../lib/studio/studio.js');
console.log = console.info = console.warn = () => {};

const CONCEPTS = path.join(__dirname, '..', '..', 'concepts');
const SEED = { conceptMaps: [
	{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
	{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },
	{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
] };

test('listCorpora finds concept-set dirs under root, skips empties', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-corpora-'));
	fs.mkdirSync(path.join(root, 'good'));
	fs.writeFileSync(path.join(root, 'good', 'Thing.json'), '{}');
	fs.mkdirSync(path.join(root, 'empty'));
	const studio = new Studio({ Graph, root });
	const list = studio.listCorpora();
	fs.rmSync(root, { recursive: true, force: true });
	assert.ok(list.some(c => c.name === 'good'), 'good corpus listed');
	assert.ok(!list.some(c => c.name === 'empty'), 'empty dir excluded');
});

test('fork runs an independent child; merge reintegrates its result', async () => {
	const studio = new Studio({ Graph });
	const root = studio.getSession('root');
	let p = new Promise(( r ) => root.once('stabilize', r));
	studio.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	await p;

	const childSeed = { conceptMaps: [
		{ _id: 'a2', Node: true, Position: { lat: 40.7, lng: -74 } },
		{ _id: 'b2', Node: true, Position: { lat: 34.0, lng: -118 } },
		{ _id: 's2', Segment: true, originNode: 'a2', targetNode: 'b2' }
	] };
	const { childId } = studio.fork('root', { seed: childSeed });
	const child = studio.getSession(childId);
	await new Promise(( r ) => child.once('stabilize', r));
	assert.ok(child.state().objects.find(o => o._id === 's2').Distance, 'child cast Distance independently');

	p = new Promise(( r ) => root.once('stabilize', r));
	studio.merge(childId, 's');
	await p;
	assert.ok(root.state().objects.find(o => o._id === 's').forkResult, 'merge reintegrated forkResult onto root s');
	assert.equal(studio.getSession(childId), undefined, 'child removed after merge');
});
