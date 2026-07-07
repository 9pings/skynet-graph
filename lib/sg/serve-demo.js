/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * `sg serve` — a MINIMAL OpenAI-compatible proxy DEMO over any chat backend. Point an OpenAI client's
 * `baseURL` at it (official SDKs, LangChain, Open WebUI, curl — zero integration code): a repeated query
 * is answered from an exact-match SESSION cache at 0 backend calls, and every response says where it came
 * from (`x-sg-served-from: cache|backend`, `x-sg-saved`).
 *
 * WHAT IT IS / IS NOT: this is the demo of the GESTURE — an in-memory, per-process cache keyed on the
 * exact query text, gone on restart. It is NOT a knowledge store: no verification, no typed coverage, no
 * persistence, no freshness. The professional appliance replaces the session cache with maintained,
 * verified knowledge served under the same wire contract.
 *
 * THE v1 WIRE CONTRACT (same shape as the appliance):
 *   • POST /v1/chat/completions — the QUERY is the LAST `user` turn (string content or text parts).
 *   • `stream:true` is SIMULATED: the answer is computed in one block, then emitted as standard SSE
 *     chunks (role delta → content delta → finish → [DONE]) so streaming clients work unchanged.
 *   • GET /v1/models — one model row, so SDK bootstraps and model pickers work.
 *   • Token counts are NOT estimated: 0 means "not counted", never a made-up number.
 *
 * THIN split (doctrine): `createServeDemoHandler` is a PURE request handler (stub-testable, no socket),
 * `startServeDemoServer` is the zero-dep node:http wrapper; backend resolution stays in cli.js.
 */

/** The text of an OpenAI message `content` (a string, or an array of {type:'text',text} parts). */
function textOf( content ) {
	if ( typeof content === 'string' ) return content;
	if ( Array.isArray(content) )
		return content.filter(function ( p ) { return p && (p.type === 'text' || typeof p.text === 'string'); })
		              .map(function ( p ) { return p.text; }).join('\n');
	return '';
}

/** The demo QUERY of an OpenAI `messages` array = the LAST user turn's text, or null (no user turn). */
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
 * The PURE request handler (no socket): `(req) -> res` over a chat backend.
 * @param opts.ask    REQUIRED async ({system,user}) -> text — the backend (a gguf, an endpoint, a stub).
 * @param opts.model  the model id advertised on /v1/models and echoed when the client sends none
 *                    (default 'skynet-graph-serve-demo').
 * @param opts.onAnswer optional ({query, answer, source}) => void — a per-answer hook (the CLI logs here).
 * @returns async ({ method, url, body }) => { status, headers, body } — or { status, headers, sse:[frames] }
 *          for a simulated stream (the http wrapper writes each frame as an SSE event).
 */
function createServeDemoHandler( opts ) {
	opts = opts || {};
	var ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('createServeDemoHandler needs opts.ask (async ({system,user}) -> text)');
	var modelId = opts.model || 'skynet-graph-serve-demo';
	var cache = new Map();   // exact query text -> the backend's verbatim answer (session-lifetime)
	var saved = 0;           // backend calls avoided so far
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

			var source, answer;
			if ( cache.has(q) ) { source = 'cache'; answer = cache.get(q); saved++; }
			else {
				try { answer = String(await ask({ user: q })); }
				catch ( e ) { return oaiError(500, String(e && e.message || e), 'server_error'); }
				cache.set(q, answer);
				source = 'backend';
			}
			if ( typeof opts.onAnswer === 'function' ) opts.onAnswer({ query: q, answer: answer, source: source });

			// PROVENANCE — on the wire for every completion (headers + usage.sg_* mirror).
			var prov = { 'x-sg-served-from': source, 'x-sg-saved': String(saved) };
			var usage = {
				prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,   // 0 = not counted (never estimated)
				sg_served_from: source, sg_saved: saved
			};
			var id = 'chatcmpl-sgdemo' + (++nextId) + '-' + Date.now().toString(36);
			var created = Math.floor(Date.now() / 1000);
			var modelOut = (typeof b.model === 'string' && b.model) ? b.model : modelId;

			if ( b.stream === true ) {
				var chunk = function ( delta, finish ) {
					return 'data: ' + JSON.stringify({
						id: id, object: 'chat.completion.chunk', created: created, model: modelOut,
						choices: [{ index: 0, delta: delta, finish_reason: finish || null }]
					});
				};
				return {
					status: 200,
					headers: Object.assign({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }, prov),
					sse: [chunk({ role: 'assistant', content: '' }), chunk({ content: answer }), chunk({}, 'stop'), 'data: [DONE]']
				};
			}
			return {
				status: 200, headers: Object.assign({}, JSON_H, prov),
				body: {
					id: id, object: 'chat.completion', created: created, model: modelOut,
					choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
					usage: usage
				}
			};
		}

		return oaiError(404, 'unknown route ' + method + ' ' + url);
	};
}

/**
 * The zero-dep node:http wrapper around a handler (JSON body in, JSON or SSE out).
 * @param o.handler  the createServeDemoHandler function.
 * @param o.port     default 4747;  o.host default 127.0.0.1 (LOCAL by default, on purpose);
 * @param o.maxBody  request-body cap (default 1 MiB).  o.onReady  optional () => void once listening.
 * @returns the http.Server (close it to stop).
 */
function startServeDemoServer( o ) {
	o = o || {};
	if ( typeof o.handler !== 'function' ) throw new Error('startServeDemoServer needs o.handler (a createServeDemoHandler function)');
	var http = require('http');
	var LIM = o.maxBody || (1 << 20);
	var srv = http.createServer(function ( req, res ) {
		var chunks = [], size = 0, over = false;
		req.on('data', function ( d ) {
			size += d.length;
			if ( size > LIM ) { over = true; req.destroy(); return; }
			chunks.push(d);
		});
		req.on('error', function () { /* destroyed over-limit request */ });
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

module.exports = { createServeDemoHandler: createServeDemoHandler, startServeDemoServer: startServeDemoServer, queryOfMessages: queryOfMessages };
