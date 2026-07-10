'use strict';
/*
 * DEMO (P5) — a sub-graph dispatched to a graph runtime in a SEPARATE PROCESS over a unix-domain socket, with the
 * model `ask` proxied back to the dispatching process. The same {init, dispatch, ask, result} protocol as
 * worker_threads (protocol.js), carried by transport-socket.js — proof that the runtime is cross-INSTANCE, not
 * just cross-thread. This one file is both roles: run with no args = the CLIENT (it spawns its own server child).
 *
 *   node examples/runtime-socket.js
 */
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const Graph = require('../lib/index.js');

// ── SERVER ROLE (the "remote instance"): listen, announce, stay up until killed ──────────────────────────────
if (process.argv[2] === '--serve') {
	const sock = process.argv[3];
	Graph.serveGraphWorker({ path: sock }).then(() => {
		process.stdout.write('SERVING ' + sock + '\n');            // the readiness signal the client waits for
		setInterval(() => {}, 1 << 30);                            // hold the process open
	}).catch((e) => { process.stderr.write('server error: ' + e.message + '\n'); process.exit(1); });
	return;
}

// ── CLIENT ROLE: spawn the server child, connect over the socket, dispatch, print, tear down ─────────────────
(async () => {
	const sock = path.join(os.tmpdir(), 'sg-demo-' + process.pid + '.sock');
	const server = spawn(process.execPath, [__filename, '--serve', sock], { stdio: ['ignore', 'pipe', 'inherit'] });
	try {
		await new Promise((resolve, reject) => {                   // wait until the child announces it is listening
			const to = setTimeout(() => reject(new Error('server did not come up in time')), 10000);
			server.stdout.on('data', (d) => { if (String(d).includes('SERVING')) { clearTimeout(to); resolve(); } });
			server.on('error', reject);
		});

		const conceptMap = Graph.loadConceptMap(path.join(__dirname, '..', 'concepts'));
		const seed = { conceptMaps: [
			{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },   // Paris
			{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },   // Singapore
			{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
		] };

		console.log('\nDEMO — dispatching a sub-graph to a runtime in a SEPARATE PROCESS (unix socket ' + sock + ')\n');
		const w = Graph.createGraphWorker({ address: { path: sock }, conceptMap, geo: true });
		const snapshot = await w.dispatch(seed, { settleTimeout: 8000 });
		await w.terminate();

		const s = JSON.parse(snapshot.graph).conceptMaps.find((o) => o._id === 's');
		console.log('  the child process stabilized the graph and cast Distance:');
		console.log('  Paris -> Singapore = ' + s.Distance.inKm.toFixed(0) + ' km  (computed in the server process, shipped back as JSON)');
		console.log('\n  Same protocol as worker_threads — only the transport (socket) differs. ✅\n');
	} finally {
		server.kill('SIGTERM');
	}
})().catch((e) => { console.error(e); process.exit(1); });
