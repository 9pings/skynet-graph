'use strict';
/**
 * P5 — the SOCKET transport carries the SAME distributed-runtime protocol as worker_threads. These are the exact
 * three boundary scenarios of worker.test.js — (1) a local Geo provider the remote runs itself, (2) a PROXIED
 * model `ask` that round-trips the parent-bound backend across the connection, (3) forwarded worker logs — run
 * over a unix-domain socket via serveGraphWorker + createGraphWorker({ address }). Same assertions, so the two
 * transports are proven interchangeable behind the one channel seam (protocol.js). The server runs in-process on
 * a loopback unix socket (the codec + full protocol are exercised); the genuine two-process case is the demo
 * examples/runtime-socket.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Graph = require('../../lib/index.js');
console.log = console.info = console.warn = () => {};

// a short unix-socket path under the temp dir (stay well under the ~108-char sun_path limit).
function sockDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sgsk-')); }

test('socket transport — a local Geo provider casts Distance in the remote runtime', async () => {
	const dir = sockDir();
	const sock = path.join(dir, 's');
	const server = await Graph.serveGraphWorker({ path: sock });
	try {
		const conceptMap = Graph.loadConceptMap(path.join(__dirname, '..', '..', 'concepts'));
		const seed = { conceptMaps: [
			{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
			{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },
			{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
		] };
		const w = Graph.createGraphWorker({ address: { path: sock }, conceptMap, geo: true });
		const snapshot = await w.dispatch(seed, { settleTimeout: 8000 });
		await w.terminate();
		const s = JSON.parse(snapshot.graph).conceptMaps.find(o => o._id === 's');
		assert.ok(s && s.Distance, 'Distance cast over the socket transport');
		assert.ok(s.Distance.inKm > 10000 && s.Distance.inKm < 11000, 'Paris->Singapore ~10728km, got ' + s.Distance.inKm);
	} finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('socket transport — a remote provider proxies a model call back to the client ask()', async () => {
	const dir = sockDir();
	const sock = path.join(dir, 's');
	const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgsk-p-'));
	fs.writeFileSync(path.join(pdir, 'remote.js'),
		'module.exports = (ctx) => ({ Remote: { work(graph, concept, scope, argz, cb) {\n' +
		'  Promise.resolve(ctx.ask({ q: "work" })).then(r => cb(null, { $_id: "_parent", Remote: true, work: r }), e => cb(e));\n' +
		'} } });\n');
	const conceptMap = { common: { childConcepts: {
		Remote: { _id: 'Remote', _name: 'Remote', require: 'Segment', provider: ['Remote::work'] }
	} } };
	const seed = { nodes: [{ _id: 'n1' }, { _id: 'n2' }], segments: [{ _id: 'sg', originNode: 'n1', targetNode: 'n2' }] };
	const server = await Graph.serveGraphWorker({ path: sock });
	try {
		let asked = null;
		const ask = ( prompt ) => { asked = prompt; return Promise.resolve(prompt && prompt.q === 'work' ? 99 : 0); };
		const w = Graph.createGraphWorker({ address: { path: sock }, conceptMap, providers: pdir, ask });
		const snapshot = await w.dispatch(seed, { settleTimeout: 8000 });
		await w.terminate();
		assert.deepEqual(asked, { q: 'work' }, 'the client ask() received the proxied call over the socket');
		const sg = JSON.parse(snapshot.graph).conceptMaps.find(o => o._id === 'sg');
		assert.ok(sg && sg.Remote === true, 'Remote cast on the segment');
		assert.equal(sg.work, 99, 'the proxied model result round-tripped back as a fact');
	} finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(pdir, { recursive: true, force: true }); }
});

test('socket transport — remote provider logs surface in the client logger (tagged {worker})', async () => {
	const { createLogger } = require('../../lib/graph/log.js');
	const dir = sockDir();
	const sock = path.join(dir, 's');
	const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgsk-l-'));
	fs.writeFileSync(path.join(pdir, 'note.js'),
		'module.exports = () => ({ Note: { work(graph, concept, scope, argz, cb) {\n' +
		'  scope.log.warn("remote note on " + scope._._id);\n' +
		'  concept.log(scope).info("remote detail");\n' +
		'  cb(null, { $_id: "_parent", Noted: true });\n' +
		'} } });\n');
	const conceptMap = { common: { childConcepts: {
		Noted: { _id: 'Noted', _name: 'Noted', require: 'Segment', provider: ['Note::work'] }
	} } };
	const seed = { nodes: [{ _id: 'n1' }, { _id: 'n2' }], segments: [{ _id: 'sg', originNode: 'n1', targetNode: 'n2' }] };
	const server = await Graph.serveGraphWorker({ path: sock });
	try {
		const logger = createLogger({ label: 'client', level: 'verbose', console: false });
		const w = Graph.createGraphWorker({ address: { path: sock }, conceptMap, providers: pdir, logger });
		const snapshot = await w.dispatch(seed, { settleTimeout: 8000 });
		await w.terminate();
		const fromWorker = logger.records.filter(r => r.ctx && r.ctx.worker);
		assert.ok(fromWorker.length >= 1, 'remote provider logs surfaced in the client logger over the socket');
		const noted = JSON.parse(snapshot.graph).conceptMaps.find(o => o._id === 'sg');
		assert.ok(noted && noted.Noted === true, 'Noted cast (remote provider ran)');
		assert.ok(fromWorker.some(r => r.ctx.concept === 'Noted'), 'a forwarded record carries the concept context');
	} finally { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(pdir, { recursive: true, force: true }); }
});

test('socket transport — a bad address rejects (no silent hang)', async () => {
	const w = Graph.createGraphWorker({ address: { path: path.join(os.tmpdir(), 'sgsk-nonexistent-' + process.pid) }, conceptMap: {} });
	await assert.rejects(w.dispatch({ nodes: [], segments: [] }, { settleTimeout: 2000 }), /ENOENT|ECONNREFUSED|connect/);
});
