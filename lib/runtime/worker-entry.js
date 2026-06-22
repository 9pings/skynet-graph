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
 * Worker-side bootstrap (runs inside a worker_thread). A warm, stateless worker:
 *  - `init`     loads a concept set + providers ONCE (concepts/providers cross the
 *               boundary as JSON / dir paths, never as closures), wiring any LLM
 *               `ask` to a PROXY that round-trips the model call back to the parent;
 *  - `dispatch` builds a fresh sub-graph from a seed, stabilizes it, ships the
 *               serialized snapshot back. Each dispatch is independent (fork-like),
 *               so one warm worker can serve many dispatched graph parts.
 *
 * Protocol (postMessage):
 *   parent -> worker : {type:'init', conceptMap|concepts, providers, geo, llm, conf}
 *                      {type:'dispatch', dispatchId, seed, settleTimeout}
 *                      {type:'askReply', callId, result|error}
 *                      {type:'terminate'}
 *   worker -> parent : {type:'ready'}
 *                      {type:'ask', callId, prompt, opts}        (proxied model call)
 *                      {type:'result', dispatchId, snapshot}
 *                      {type:'error', dispatchId?, message}
 *                      {type:'log', record}                      (forwarded log record)
 */
const { parentPort } = require('worker_threads');
const Graph     = require('../index.js');
const providers = require('../providers');
const { createLogger } = require('../graph/log.js');

let ctx = null;              // { conceptMap, conf }
let askCounter = 0;
const askPending = {};

// the proxied model backend: forward the prompt to the parent, await its reply
function proxiedAsk( prompt, opts ) {
	return new Promise(( resolve, reject ) => {
		const callId = ++askCounter;
		askPending[callId] = { resolve, reject };
		parentPort.postMessage({ type: 'ask', callId, prompt, opts });
	});
}

function init( msg ) {
	const conceptMap = msg.conceptMap || (msg.concepts ? Graph.loadConceptMap(msg.concepts) : {});
	// local providers loaded from a dir/file the worker can see; factories get the proxied ask
	if ( msg.providers ) providers.register(Graph, Graph.loadProviders(msg.providers, { ask: proxiedAsk, env: process.env }));
	if ( msg.geo )       providers.register(Graph, [{ CommonGeo: providers.CommonGeo }]);
	if ( msg.llm )       providers.register(Graph, [providers.createLLMProvider({ ask: proxiedAsk })]);
	// a logger whose sink ships each record (JSON-safe by construction) to the parent,
	// so logs a dispatched graph's concepts/providers emit surface in the parent's logger.
	const logger = createLogger({ label: 'worker', level: msg.logLevel || 'verbose', console: false });
	logger.addSink(( record ) => parentPort.postMessage({ type: 'log', record }));
	ctx = { conceptMap, conf: msg.conf || {}, logger };
	parentPort.postMessage({ type: 'ready' });
}

function dispatch( msg ) {
	const dispatchId = msg.dispatchId;
	let settled = false;
	const finish = ( graph ) => {
		if ( settled ) return; settled = true;
		parentPort.postMessage({ type: 'result', dispatchId, snapshot: graph.serialize() });
	};
	try {
		const g = Graph.fromDirs({
			conceptMap: ctx.conceptMap,
			seed      : msg.seed,
			conf      : { ...ctx.conf, autoMount: true, logger: ctx.logger, onStabilize: ( graph ) => finish(graph) }
		});
		// settle-hook only fires after a write; bound the no-op/empty-seed case
		const t = setTimeout(() => finish(g), msg.settleTimeout || 10000);
		if ( t.unref ) t.unref();
	} catch ( e ) {
		parentPort.postMessage({ type: 'error', dispatchId, message: e.message });
	}
}

parentPort.on('message', ( msg ) => {
	switch ( msg.type ) {
		case 'init':     init(msg); break;
		case 'dispatch': dispatch(msg); break;
		case 'askReply': {
			const p = askPending[msg.callId];
			if ( p ) { delete askPending[msg.callId]; msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); }
			break;
		}
		case 'terminate': process.exit(0); break;
	}
});
