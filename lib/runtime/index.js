'use strict';
/**
 * Parent-side worker runtime — spawn sub-graphs in separate OS workers and
 * dispatch graph parts to them for horizontal scale.
 *
 * Nothing non-serializable crosses the boundary: the worker rehydrates from a
 * conceptMap (JSON) + provider dir path (its own filesystem) + a seed snapshot
 * (JSON). The one effect that can't be shipped — a parent-bound model `ask` — is
 * PROXIED: the worker forwards the (generic, templated) model call back here and
 * the parent's real `ask` answers it.
 *
 *   const { createGraphWorker } = require('skynet-graph/lib/runtime');
 *   const w = createGraphWorker({ conceptMap, geo: true });
 *   const snapshot = await w.dispatch(seed);   // -> graph.serialize()
 *   w.terminate();
 *
 * Transport note: this uses worker_threads (same-machine parallelism). The
 * message protocol is plain-JSON by design, so a cross-instance transport
 * (child_process IPC, TCP/WebSocket to a waiting remote instance) can slot in
 * behind the same {init, dispatch, ask, result} shape later.
 */
const { Worker } = require('worker_threads');
const path = require('path');

/**
 * Create a warm, reusable worker that has loaded a concept set + providers and
 * can serve many independent dispatches.
 *
 * @param {object} opts
 * @param {object}        [opts.conceptMap]  concept map (JSON) — or
 * @param {string}        [opts.concepts]    a concept-set dir the worker can read
 * @param {string}        [opts.providers]   provider dir/file the worker loads locally
 * @param {boolean}       [opts.geo]         register the packaged Geo provider
 * @param {boolean}       [opts.llm]         register the packaged LLM provider, wired to `opts.ask`
 * @param {function}      [opts.ask]         parent model backend — answers proxied calls (prompt,opts)=>Promise
 * @param {object}        [opts.conf]        data-only Graph cfg for dispatched graphs
 * @returns {{ready, dispatch, terminate, worker}}
 */
function createGraphWorker( opts = {} ) {
	const worker = new Worker(path.join(__dirname, 'worker-entry.js'));
	const ask    = opts.ask || (() => Promise.reject(new Error('worker requested a model call but no `ask` backend was wired')));
	const dispatches = {};
	let dispatchCounter = 0;
	let readyResolve;
	const ready = new Promise(( res ) => { readyResolve = res; });

	worker.on('message', async ( msg ) => {
		switch ( msg.type ) {
			case 'ready': readyResolve(); break;
			case 'ask': {
				try { worker.postMessage({ type: 'askReply', callId: msg.callId, result: await ask(msg.prompt, msg.opts) }); }
				catch ( e ) { worker.postMessage({ type: 'askReply', callId: msg.callId, error: e.message }); }
				break;
			}
			case 'result': {
				const d = dispatches[msg.dispatchId];
				if ( d ) { delete dispatches[msg.dispatchId]; d.resolve(msg.snapshot); }
				break;
			}
			case 'error': {
				const d = dispatches[msg.dispatchId];
				if ( d ) { delete dispatches[msg.dispatchId]; d.reject(new Error(msg.message)); }
				break;
			}
		}
	});
	worker.on('error', ( e ) => {
		Object.keys(dispatches).forEach(( id ) => { dispatches[id].reject(e); delete dispatches[id]; });
	});

	worker.postMessage({
		type     : 'init',
		conceptMap: opts.conceptMap,
		concepts : opts.concepts,
		providers: opts.providers,
		geo      : opts.geo,
		llm      : opts.llm,
		conf     : opts.conf
	});

	return {
		ready: () => ready,
		/**
		 * Dispatch a sub-graph seed; resolves with the worker's stabilized snapshot
		 * (graph.serialize()). Independent of other dispatches.
		 */
		dispatch( seed, dopts = {} ) {
			return ready.then(() => new Promise(( resolve, reject ) => {
				const dispatchId = ++dispatchCounter;
				dispatches[dispatchId] = { resolve, reject };
				worker.postMessage({ type: 'dispatch', dispatchId, seed, settleTimeout: dopts.settleTimeout });
			}));
		},
		terminate() { return worker.terminate(); },
		worker
	};
}

/**
 * One-shot convenience: spawn a worker, dispatch a single seed, return the
 * stabilized snapshot, terminate the worker.
 * @param {object} opts  createGraphWorker opts + { seed, settleTimeout }
 * @returns {Promise<object>} snapshot (graph.serialize())
 */
function spawnGraph( opts = {} ) {
	const w = createGraphWorker(opts);
	return w.dispatch(opts.seed, opts).then(
		( snap ) => { w.terminate(); return snap; },
		( err )  => { w.terminate(); throw err; }
	);
}

module.exports = { createGraphWorker, spawnGraph };
