/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Socket transport (roadmap P5) — the cross-INSTANCE channel: the same {init, dispatch, ask, …} protocol as
 * worker_threads, carried over a TCP or unix-domain socket, so a sub-graph can be dispatched to a graph runtime
 * on ANOTHER process or machine. Framing = NDJSON (one `JSON.stringify(msg)` per line; JSON never emits a raw
 * newline, so a line is a whole message). The parent-bound model `ask` round-trips back over the SAME socket,
 * exactly as in-thread.
 *
 *   // server (the remote runtime instance):
 *   const { serve } = require('skynet-graph/lib/runtime/transport-socket');
 *   const server = await serve({ path: '/tmp/sg.sock' });      // each connection = one attachWorker
 *   // client (elsewhere): createGraphWorker({ address: { path: '/tmp/sg.sock' }, conceptMap, geo:true })
 */
var net = require('net');

/**
 * socketChannel(socket) — wrap a connected duplex socket as a protocol channel { send, onMessage, close, onError }.
 * NDJSON: buffer incoming bytes, split on '\n', JSON.parse each complete line → the message handler.
 */
function socketChannel( socket ) {
	socket.setEncoding('utf8');
	var buf = '';
	var handlers = [];
	socket.on('data', function ( chunk ) {
		buf += chunk;
		var i;
		while ( (i = buf.indexOf('\n')) >= 0 ) {
			var line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			if ( !line ) continue;
			var msg;
			try { msg = JSON.parse(line); } catch ( e ) { continue; }   // skip a corrupt frame rather than crash the peer
			for ( var h = 0; h < handlers.length; h++ ) handlers[h](msg);
		}
	});
	return {
		socket: socket,
		send: function ( m ) { try { socket.write(JSON.stringify(m) + '\n'); } catch ( e ) { /* peer gone */ } },
		onMessage: function ( fn ) { handlers.push(fn); },
		onError: function ( fn ) { socket.on('error', fn); },
		close: function () { try { socket.end(); } catch ( e ) {} }
	};
}

/**
 * connect(address) → Promise<channel>. address = { port[, host] } (TCP) | { path } (unix socket) — anything
 * net.connect accepts. Resolves once the connection is open; rejects on a connect error.
 */
function connect( address ) {
	return new Promise(function ( resolve, reject ) {
		var socket = net.connect(address, function () { socket.removeListener('error', reject); resolve(socketChannel(socket)); });
		socket.once('error', reject);
	});
}

/**
 * serve(listenOpts, workerOpts?) → Promise<server>. Listens (TCP { port } or unix { path }); for EACH connection,
 * runs a worker-side protocol handler (attachWorker) over that connection's channel — the connecting client drives
 * `init`/`dispatch` and answers the proxied `ask`. `server.close()` stops accepting. (One config per process, like
 * the thread worker — engine providers are process-global.)
 */
function serve( listenOpts, workerOpts ) {
	var attachWorker = require('./protocol.js').attachWorker;
	var server = net.createServer(function ( conn ) { attachWorker(socketChannel(conn), workerOpts || {}); });
	return new Promise(function ( resolve, reject ) {
		server.once('error', reject);
		server.listen(listenOpts, function () { server.removeListener('error', reject); resolve(server); });
	});
}

module.exports = { socketChannel: socketChannel, connect: connect, serve: serve };
