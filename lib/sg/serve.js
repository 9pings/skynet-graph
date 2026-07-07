/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * `sg serve` — the OpenAI-COMPATIBLE endpoint over the C6 proxy cache (roadmap FINIR, F1). Any client of the
 * OpenAI ecosystem (official SDKs, LangChain, Open WebUI, curl) integrates by pointing `baseURL` at this
 * server — zero integration code. Every completion is `createProxyCache.answer` underneath: a COVERED query is
 * served from the verified local stock at 0 frontier calls, a miss escalates to the frontier and enriches the
 * stock in passing (0 hallucination — verified stock or escalate; a miss always answers, no false neg).
 *
 * THIN assembly (doctrine): `createServeHandler` is a PURE request handler (stub-testable, no socket — the same
 * split as proxy-run.js), `startServeServer` is the zero-dep node:http wrapper, and the GPU-bound model
 * resolution stays in cli.js.
 *
 * THE v1 WIRE CONTRACT:
 *   • POST /v1/chat/completions — the QUERY is the LAST `user` turn (string content or text parts). Multi-turn
 *     history and client system prompts are NOT part of the cache identity: this is a QA proxy-cache, not a
 *     dialog engine (the honest v1 boundary — a context-dependent flow belongs on the frontier directly, and
 *     `coverageCheck` is the backstop that rejects an ill-fitting hit before it is served).
 *   • `stream:true` is SIMULATED (arbitrage F0-3): the answer is computed in one block, then emitted as
 *     standard SSE chunks (role delta → content delta → finish → [DONE]) so streaming clients work unchanged.
 *     A true frontier passthrough stream is a later opt-in — the local stock answers in one block anyway.
 *   • PROVENANCE on every completion (the debug contract): headers `x-sg-served-from: local|frontier`,
 *     `x-sg-arm`, `x-sg-cost`, `x-sg-coverage`, `x-sg-saved`, mirrored as `usage.sg_*` extension fields (an
 *     OpenAI `usage` object tolerates extra keys). Token counts are NOT estimated: 0 means "not counted",
 *     never a made-up number.
 *   • GET /v1/models — one model row (the proxy), so SDK bootstraps and model pickers work.
 */

/** The text of an OpenAI message `content` (a string, or an array of {type:'text',text} parts). */
function textOf( content ) {
	if ( typeof content === 'string' ) return content;
	if ( Array.isArray(content) )
		return content.filter(function ( p ) { return p && (p.type === 'text' || typeof p.text === 'string'); })
		              .map(function ( p ) { return p.text; }).join('\n');
	return '';
}

/** The proxy QUERY of an OpenAI `messages` array = the LAST user turn's text, or null (no user turn). */
function queryOfMessages( messages ) {
	if ( !Array.isArray(messages) ) return null;
	for ( var i = messages.length - 1; i >= 0; i-- ) {
		if ( messages[i] && messages[i].role === 'user' ) {
			var t = textOf(messages[i].content).trim();
			return t.length ? t : null;
		}
	}
	return null;
}

/**
 * The PURE request handler (no socket): `(req) -> res` over a `createProxyCache` instance.
 * @param opts.proxy  REQUIRED — a createProxyCache instance ({ answer, metrics }).
 * @param opts.model  the model id advertised on /v1/models and echoed when the client sends none
 *                    (default 'skynet-graph-proxy').
 * @param opts.onAnswer optional (row) => void — a per-answer hook ({query, answer, source, cached, cost};
 *                    the CLI logs/streams here, same seam as runProxySession).
 * @returns async ({ method, url, body }) => { status, headers, body } — or { status, headers, sse:[frames] }
 *          for a simulated stream (the http wrapper writes each frame as an SSE event).
 */
function createServeHandler( opts ) {
	opts = opts || {};
	var proxy = opts.proxy;
	if ( !proxy || typeof proxy.answer !== 'function' ) throw new Error('createServeHandler needs opts.proxy (a createProxyCache instance)');
	var modelId = opts.model || 'skynet-graph-proxy';
	var nextId = 0;

	var JSON_H = { 'content-type': 'application/json' };
	var oaiError = function ( status, message, type ) {
		return { status: status, headers: JSON_H, body: { error: { message: message, type: type || 'invalid_request_error' } } };
	};

	return async function handle( req ) {
		req = req || {};
		var method = String(req.method || 'GET').toUpperCase();
		var url = String(req.url || '/').split('?')[0];

		if ( url === '/v1/models' ) {
			if ( method !== 'GET' ) return oaiError(405, 'method ' + method + ' not allowed on /v1/models');
			return {
				status: 200, headers: JSON_H,
				body: { object: 'list', data: [{ id: modelId, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'skynet-graph' }] }
			};
		}

		if ( url === '/v1/chat/completions' ) {
			if ( method !== 'POST' ) return oaiError(405, 'method ' + method + ' not allowed on /v1/chat/completions');
			var b = req.body;
			if ( !b || typeof b !== 'object' ) return oaiError(400, 'request body must be a JSON object');
			var q = queryOfMessages(b.messages);
			if ( q == null ) return oaiError(400, 'messages must contain at least one non-empty user turn');

			var r;
			try { r = await proxy.answer(q); }
			catch ( e ) { return oaiError(500, String(e && e.message || e), 'server_error'); }
			var m = (typeof proxy.metrics === 'function') ? proxy.metrics() : null;
			if ( typeof opts.onAnswer === 'function' )
				opts.onAnswer({ query: q, answer: r.answer, source: r.source, cached: !!r.cached, cost: r.cost });

			// PROVENANCE — on the wire for every completion (headers + usage.sg_* mirror).
			var prov = {
				'x-sg-served-from': String(r.source || ''),
				'x-sg-arm'        : String(r.arm || ''),
				'x-sg-cost'       : String(r.cost != null ? r.cost : '')
			};
			if ( m ) {
				prov['x-sg-coverage'] = String(Math.round((m.coverage || 0) * 100) / 100);
				prov['x-sg-saved']    = String(m.local);   // frontier calls avoided so far = local hits
			}
			var usage = {
				prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,   // 0 = not counted (never estimated)
				sg_served_from: r.source, sg_cached: !!r.cached,
				sg_saved: m ? m.local : undefined, sg_frontier_calls: m ? m.frontier : undefined,
				sg_coverage: m ? m.coverage : undefined
			};
			var id = 'chatcmpl-sg' + (++nextId) + '-' + Date.now().toString(36);
			var created = Math.floor(Date.now() / 1000);
			var modelOut = (typeof b.model === 'string' && b.model) ? b.model : modelId;

			if ( b.stream === true ) {
				// SIMULATED stream: the standard SSE chunk sequence over the already-computed answer.
				var chunk = function ( delta, finish ) {
					return 'data: ' + JSON.stringify({
						id: id, object: 'chat.completion.chunk', created: created, model: modelOut,
						choices: [{ index: 0, delta: delta, finish_reason: finish || null }]
					});
				};
				return {
					status: 200,
					headers: Object.assign({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }, prov),
					sse: [chunk({ role: 'assistant', content: '' }), chunk({ content: String(r.answer) }), chunk({}, 'stop'), 'data: [DONE]']
				};
			}
			return {
				status: 200, headers: Object.assign({}, JSON_H, prov),
				body: {
					id: id, object: 'chat.completion', created: created, model: modelOut,
					choices: [{ index: 0, message: { role: 'assistant', content: String(r.answer) }, finish_reason: 'stop' }],
					usage: usage
				}
			};
		}

		return oaiError(404, 'unknown route ' + method + ' ' + url);
	};
}

/**
 * The zero-dep node:http wrapper around a handler (JSON body in, JSON or SSE out).
 * @param o.handler  the createServeHandler function.
 * @param o.port     default 4747;  o.host default 127.0.0.1;  o.maxBody request-body cap (default 1 MiB).
 * @param o.onReady  optional () => void once listening.
 * @returns the http.Server (close it to stop).
 */
function startServeServer( o ) {
	o = o || {};
	if ( typeof o.handler !== 'function' ) throw new Error('startServeServer needs o.handler (a createServeHandler function)');
	var http = require('http');
	var LIM = o.maxBody || (1 << 20);
	var srv = http.createServer(function ( req, res ) {
		var chunks = [], size = 0, over = false;
		req.on('data', function ( d ) {
			size += d.length;
			if ( size > LIM ) { over = true; req.destroy(); return; }
			chunks.push(d);
		});
		req.on('error', function () { /* destroyed over-limit request — response below or dropped */ });
		req.on('end', function () {
			if ( over ) { try { res.writeHead(413, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'request body over ' + LIM + ' bytes', type: 'invalid_request_error' } })); } catch ( e ) {} return; }
			var body = null, raw = Buffer.concat(chunks).toString('utf8');
			if ( raw.length ) { try { body = JSON.parse(raw); } catch ( e ) { body = undefined; } }   // undefined = present but invalid JSON → 400 in the handler
			Promise.resolve(o.handler({ method: req.method, url: req.url, headers: req.headers, body: body }))
				.catch(function ( e ) { return { status: 500, headers: { 'content-type': 'application/json' }, body: { error: { message: String(e && e.message || e), type: 'server_error' } } }; })
				.then(function ( out ) {
					out = out || { status: 500, headers: {}, body: { error: { message: 'empty handler result', type: 'server_error' } } };
					if ( out.sse ) {
						res.writeHead(out.status || 200, out.headers || {});
						(out.sse || []).forEach(function ( f ) { res.write(f + '\n\n'); });
						res.end();
						return;
					}
					var txt = JSON.stringify(out.body != null ? out.body : {});
					res.writeHead(out.status || 200, Object.assign({ 'content-length': Buffer.byteLength(txt) }, out.headers || {}));
					res.end(txt);
				});
		});
	});
	srv.listen(o.port != null ? o.port : 4747, o.host || '127.0.0.1', o.onReady);
	return srv;
}

module.exports = { createServeHandler: createServeHandler, startServeServer: startServeServer, queryOfMessages: queryOfMessages };
