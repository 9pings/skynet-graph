/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Parent-side sub-graph runtime — dispatch graph parts to a warm worker for horizontal scale. The worker
 * rehydrates from a conceptMap (JSON) + provider dir path + a seed snapshot (JSON); the one effect that can't be
 * shipped — a parent-bound model `ask` — is PROXIED back over the channel and the parent's real `ask` answers it.
 *
 *   const { createGraphWorker } = require('skynet-graph/lib/runtime');
 *   const w = createGraphWorker({ conceptMap, geo: true });        // default: worker_threads (same machine)
 *   const snapshot = await w.dispatch(seed);                       // -> graph.serialize()
 *   w.terminate();
 *
 * TRANSPORT (P5). The {init, dispatch, ask, result, log} protocol is transport-agnostic (see protocol.js). Two
 * transports slot in behind the SAME channel seam:
 *   • worker_threads (default)              — same-machine parallelism, spawns worker-entry.js;
 *   • socket (opts.address / transport)     — a CROSS-INSTANCE runtime: connect to a `serveGraphWorker` on another
 *                                             process or machine. `createGraphWorker({ address:{path|port}, … })`.
 * A host stands up the remote side with `serveGraphWorker({ path } | { port })`.
 *
 * @param {object}   [opts.conceptMap]  concept map (JSON) — or
 * @param {string}   [opts.concepts]    a concept-set dir the worker can read
 * @param {string}   [opts.providers]   provider dir/file the worker loads locally
 * @param {boolean}  [opts.geo]         register the packaged Geo provider
 * @param {boolean}  [opts.llm]         register the packaged LLM provider, wired to `opts.ask`
 * @param {function} [opts.ask]         parent model backend — answers proxied calls (prompt,opts)=>Promise
 * @param {object}   [opts.conf]        data-only Graph cfg for dispatched graphs
 * @param {object}   [opts.logger]      parent logger — worker log records re-emit into it (tagged {worker:true})
 * @param {string}   [opts.logLevel]    threshold for the worker's forwarding logger (default 'verbose')
 * @param {object}   [opts.address]     socket transport: { path } (unix) | { port[, host] } (TCP). Omit = threads.
 * @param {string}   [opts.transport]   'socket' | 'thread' (default). 'socket' requires opts.address.
 * @returns {{ready, dispatch, terminate, worker?}}
 */
var path = require('path');
var protocol = require('./protocol.js');

function threadChannel() {
	var Worker = require('worker_threads').Worker;
	var worker = new Worker(path.join(__dirname, 'worker-entry.js'));
	return {
		worker: worker,
		send: function ( m ) { worker.postMessage(m); },
		onMessage: function ( fn ) { worker.on('message', fn); },
		onError: function ( fn ) { worker.on('error', fn); },
		close: function () { return worker.terminate(); }
	};
}

function createGraphWorker( opts ) {
	opts = opts || {};

	// ── socket transport: connect to a remote serveGraphWorker; the API awaits the connection lazily ──────────
	if ( opts.transport === 'socket' || opts.address ) {
		if ( !opts.address ) throw new Error("createGraphWorker transport 'socket' needs opts.address ({ path } | { port })");
		var connect = require('./transport-socket.js').connect;
		var connected = connect(opts.address).then(function ( channel ) { return protocol.attachClient(channel, opts); });
		return {
			ready:     function () { return connected.then(function ( a ) { return a.ready(); }); },
			dispatch:  function ( seed, dopts ) { return connected.then(function ( a ) { return a.dispatch(seed, dopts); }); },
			terminate: function () { return connected.then(function ( a ) { return a.terminate(); }); }
		};
	}

	// ── default: worker_threads (same-machine) ────────────────────────────────────────────────────────────────
	var channel = threadChannel();
	var api = protocol.attachClient(channel, opts);
	api.worker = channel.worker;                          // back-compat: expose the raw Worker
	return api;
}

/**
 * One-shot convenience: spawn/connect a worker, dispatch a single seed, return the stabilized snapshot, tear down.
 * @param {object} opts  createGraphWorker opts + { seed, settleTimeout }
 * @returns {Promise<object>} snapshot (graph.serialize())
 */
function spawnGraph( opts ) {
	opts = opts || {};
	var w = createGraphWorker(opts);
	return w.dispatch(opts.seed, opts).then(
		function ( snap ) { return Promise.resolve(w.terminate()).then(function () { return snap; }); },
		function ( err )  { return Promise.resolve(w.terminate()).then(function () { throw err; }); }
	);
}

/**
 * serveGraphWorker(opts) → Promise<{ server, address, close }>. Stand up a socket runtime that accepts sub-graph
 * dispatches from remote `createGraphWorker({ address, … })` clients. opts.path (unix) or opts.port[/host] (TCP),
 * or opts.address directly. `close()` stops accepting and resolves when the server is down.
 */
function serveGraphWorker( opts ) {
	opts = opts || {};
	var serve = require('./transport-socket.js').serve;
	var listen = opts.address || (opts.path != null ? { path: opts.path } : { port: opts.port, host: opts.host });
	return serve(listen).then(function ( server ) {
		return {
			server: server,
			address: server.address(),
			close: function () { return new Promise(function ( res ) { server.close(function () { res(); }); }); }
		};
	});
}

module.exports = { createGraphWorker: createGraphWorker, spawnGraph: spawnGraph, serveGraphWorker: serveGraphWorker };
