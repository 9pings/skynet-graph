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

function waitFor( pred, ms ) {
	return new Promise(( resolve, reject ) => {
		const t0 = Date.now();
		const iv = setInterval(() => {
			if ( pred() ) { clearInterval(iv); resolve(); }
			else if ( Date.now() - t0 > ms ) { clearInterval(iv); reject(new Error('waitFor timeout')); }
		}, 20);
	});
}

test('ws server: connect, loadCorpus + mutate stream conceptApply + state events', async () => {
	const { createServer } = require('../../lib/studio/server.js');
	const WebSocket = require('ws');
	const srv = createServer({ Graph });
	await new Promise(( r ) => srv.listen(0, r));
	const port = srv.httpServer.address().port;
	const ws = new WebSocket('ws://127.0.0.1:' + port);
	const msgs = [];
	await new Promise(( r ) => ws.on('open', r));
	ws.on('message', ( d ) => msgs.push(JSON.parse(d.toString())));

	let _id = 0;
	function call( op, args ) {
		const id = 'c' + (++_id);
		return new Promise(( resolve, reject ) => {
			const onMsg = ( d ) => {
				const m = JSON.parse(d.toString());
				if ( m.id === id ) { ws.off('message', onMsg); m.ok ? resolve(m.result) : reject(new Error(m.error)); }
			};
			ws.on('message', onMsg);
			ws.send(JSON.stringify({ id, op, args }));
		});
	}

	const initial = await call('loadCorpus', { conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	assert.equal(initial.objects.length, 3, 'loadCorpus response returns initial state');

	await waitFor(() => msgs.some(m => m.type === 'state'), 5000);
	ws.close();
	await new Promise(( r ) => srv.close(r));

	assert.ok(msgs.some(m => m.type === 'conceptApply' && m.payload.conceptName === 'Distance'), 'conceptApply streamed');
	assert.ok(msgs.some(m => m.type === 'state' && m.payload.currentRev > 0), 'state streamed on settle');
});
