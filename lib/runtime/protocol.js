/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Runtime PROTOCOL — the transport-agnostic halves of the distributed sub-graph runtime (roadmap P5).
 *
 * The message shape {init, dispatch, ask, askReply, result, error, log, ready, terminate} was plain-JSON by
 * design; this module lifts the worker- and client-side handling OFF worker_threads so the SAME logic runs over
 * ANY duplex `channel` — a worker_threads port (transport-thread) OR a TCP/unix socket (transport-socket). A
 * channel is the minimal duplex seam:
 *     { send(msg), onMessage(fn), close(), onError?(fn) }
 * `send`/`onMessage` carry already-parsed JSON objects (a socket transport frames them; a thread transport passes
 * them through structured-clone). Behaviour is byte-for-byte the worker_threads original — only the seam changed.
 */

/**
 * attachWorker(channel) — the WORKER/SERVER side. Loads a concept set + providers on `init` (wiring any LLM `ask`
 * to a proxy that round-trips the model call back over the channel), builds+stabilizes a fresh sub-graph per
 * `dispatch`, and ships the serialized snapshot back. One config per process (engine providers are process-global),
 * exactly like the worker_thread model.
 */
function attachWorker( channel ) {
	var Graph     = require('../index.js');
	var providers = require('../providers');
	var createLogger = require('../graph/log.js').createLogger;

	var ctx = null, askCounter = 0;
	var askPending = {};

	// the proxied model backend: forward the prompt over the channel, await the peer's reply.
	function proxiedAsk( prompt, opts ) {
		return new Promise(function ( resolve, reject ) {
			var callId = ++askCounter;
			askPending[callId] = { resolve: resolve, reject: reject };
			channel.send({ type: 'ask', callId: callId, prompt: prompt, opts: opts });
		});
	}

	function init( msg ) {
		var conceptMap = msg.conceptMap || (msg.concepts ? Graph.loadConceptMap(msg.concepts) : {});
		if ( msg.providers ) providers.register(Graph, Graph.loadProviders(msg.providers, { ask: proxiedAsk, env: process.env }));
		if ( msg.geo )       providers.register(Graph, [{ CommonGeo: providers.CommonGeo }]);
		if ( msg.llm )       providers.register(Graph, [providers.createLLMProvider({ ask: proxiedAsk })]);
		var logger = createLogger({ label: 'worker', level: msg.logLevel || 'verbose', console: false });
		logger.addSink(function ( record ) { channel.send({ type: 'log', record: record }); });
		ctx = { conceptMap: conceptMap, conf: msg.conf || {}, logger: logger };
		channel.send({ type: 'ready' });
	}

	function dispatch( msg ) {
		var dispatchId = msg.dispatchId, settled = false;
		var finish = function ( graph ) {
			if ( settled ) return; settled = true;
			channel.send({ type: 'result', dispatchId: dispatchId, snapshot: graph.serialize() });
		};
		try {
			var g = Graph.fromDirs({
				conceptMap: ctx.conceptMap,
				seed      : msg.seed,
				conf      : Object.assign({}, ctx.conf, { autoMount: true, logger: ctx.logger, onStabilize: function ( graph ) { finish(graph); } })
			});
			var t = setTimeout(function () { finish(g); }, msg.settleTimeout || 10000);   // bound the empty-seed / no-write case
			if ( t.unref ) t.unref();
		} catch ( e ) {
			channel.send({ type: 'error', dispatchId: dispatchId, message: e.message });
		}
	}

	channel.onMessage(function ( msg ) {
		switch ( msg.type ) {
			case 'init':     init(msg); break;
			case 'dispatch': dispatch(msg); break;
			case 'askReply': {
				var p = askPending[msg.callId];
				if ( p ) { delete askPending[msg.callId]; msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); }
				break;
			}
			case 'terminate': channel.close(); break;
		}
	});
}

/**
 * attachClient(channel, opts) — the PARENT/CLIENT side. Sends `init`, answers proxied `ask` calls with the
 * parent-bound `opts.ask`, re-emits forwarded `log` records into `opts.logger` (tagged {worker:true}), and
 * resolves each `dispatch` with the peer's stabilized snapshot. Returns { ready, dispatch, terminate }.
 */
function attachClient( channel, opts ) {
	opts = opts || {};
	var ask = opts.ask || function () { return Promise.reject(new Error('worker requested a model call but no `ask` backend was wired')); };
	var dispatches = {}, dispatchCounter = 0, readyResolve;
	var ready = new Promise(function ( res ) { readyResolve = res; });

	channel.onMessage(async function ( msg ) {
		switch ( msg.type ) {
			case 'ready': readyResolve(); break;
			case 'ask': {
				try { channel.send({ type: 'askReply', callId: msg.callId, result: await ask(msg.prompt, msg.opts) }); }
				catch ( e ) { channel.send({ type: 'askReply', callId: msg.callId, error: e.message }); }
				break;
			}
			case 'result': {
				var dr = dispatches[msg.dispatchId];
				if ( dr ) { delete dispatches[msg.dispatchId]; dr.resolve(msg.snapshot); }
				break;
			}
			case 'error': {
				var de = dispatches[msg.dispatchId];
				if ( de ) { delete dispatches[msg.dispatchId]; de.reject(new Error(msg.message)); }
				break;
			}
			case 'log': {
				var r = msg.record;
				if ( opts.logger && r && typeof opts.logger[r.level] === 'function' ) {
					var child = opts.logger.child(Object.assign({ worker: true }, r.ctx || {}));
					child[r.level].apply(child, [r.msg].concat(r.args || []));
				}
				break;
			}
		}
	});
	if ( channel.onError ) channel.onError(function ( e ) {
		Object.keys(dispatches).forEach(function ( id ) { dispatches[id].reject(e); delete dispatches[id]; });
	});

	channel.send({
		type: 'init', conceptMap: opts.conceptMap, concepts: opts.concepts, providers: opts.providers,
		geo: opts.geo, llm: opts.llm, logLevel: opts.logLevel, conf: opts.conf
	});

	return {
		ready: function () { return ready; },
		dispatch: function ( seed, dopts ) {
			dopts = dopts || {};
			return ready.then(function () {
				return new Promise(function ( resolve, reject ) {
					var dispatchId = ++dispatchCounter;
					dispatches[dispatchId] = { resolve: resolve, reject: reject };
					channel.send({ type: 'dispatch', dispatchId: dispatchId, seed: seed, settleTimeout: dopts.settleTimeout });
				});
			});
		},
		terminate: function () { return channel.close(); }
	};
}

module.exports = { attachWorker: attachWorker, attachClient: attachClient };
