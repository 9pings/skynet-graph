'use strict';
/**
 * LLM provider — backend-agnostic.
 *
 * `createLLMProvider({ ask })` returns a provider-map fragment `{ LLM: { complete } }`
 * where `complete` is a generic concept<->prompt runner: it builds a prompt from the
 * concept's `_schema.prompt` (or argz[0]), calls the injected `ask`, optionally salvages
 * JSON, and writes the result back as typed facts. A host plugs ANY backend by passing
 * its own `ask` — the bundled Anthropic-style `ask` is only the default.
 *
 * Concept wiring:
 *   { "provider": ["LLM::complete"],
 *     "prompt": { "system": "...", "user": "Step: ${label}", "maxTokens": 500,
 *                 "json": true, "as": "Classification" } }
 *   - `user`/`system` strings interpolate `${ref}` tokens, resolved against the scope
 *     via graph.getRef (objects are JSON-stringified).
 *   - `json:true` -> parse the reply; if it's a plain object (and no `as`), merge its
 *     keys as facts; with `as`, store the parsed/raw reply under that key.
 *   - on backend error the concept is still flagged + `llmError` recorded, so the graph
 *     can settle instead of hanging.
 */

// ---- default Anthropic-style client (Node global fetch). Configurable via env / opts. ----
function makeAsk( opts ) {
	opts = opts || {};
	var BASE  = opts.base  || process.env.LLM_BASE  || 'http://localhost:3000';
	var MODEL = opts.model || process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
	var KEY   = opts.key   || process.env.LLM_KEY   || 'sk-local';
	return async function ask( { system, user, maxTokens = 1024 } ) {
		var res = await fetch(BASE.replace(/\/$/, '') + '/v1/messages', {
			method : 'POST',
			headers: {
				'content-type'     : 'application/json',
				'x-api-key'        : KEY,
				'authorization'    : 'Bearer ' + KEY,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: user }] })
		});
		if ( !res.ok ) throw new Error('LLM HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
		var j = await res.json();
		return (j.content || []).map(function ( b ) { return b.text || ''; }).join('');
	};
}

// ---- Robust against "thinking" models: returns the LAST balanced {...}/[...] that JSON.parses. ----
function parseJSON( text ) {
	var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if ( fence ) { try { return JSON.parse(fence[1]); } catch ( e ) { /* fall through */ } }
	var candidates = [];
	for ( var i = 0; i < text.length; i++ ) {
		var open = text[i];
		if ( open !== '{' && open !== '[' ) continue;
		var close = open === '{' ? '}' : ']';
		var depth = 0, inStr = false, esc = false;
		for ( var j = i; j < text.length; j++ ) {
			var ch = text[j];
			if ( inStr ) { if ( esc ) esc = false; else if ( ch === '\\' ) esc = true; else if ( ch === '"' ) inStr = false; continue; }
			if ( ch === '"' ) inStr = true;
			else if ( ch === open ) depth++;
			else if ( ch === close ) { depth--; if ( depth === 0 ) { candidates.push(text.slice(i, j + 1)); break; } }
		}
	}
	for ( var k = candidates.length - 1; k >= 0; k-- ) {
		try { return JSON.parse(candidates[k]); } catch ( e ) { /* try previous */ }
	}
	throw new Error('no parseable JSON in: ' + text.slice(0, 120));
}

function interpolate( str, graph, scope ) {
	if ( typeof str !== 'string' ) return str;
	return str.replace(/\$\{\s*([^}]+?)\s*\}/g, function ( _, ref ) {
		var v = graph.getRef(ref, scope);
		return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
	});
}

/**
 * Build the LLM provider-map fragment.
 * @param opts.ask        async ({system,user,maxTokens}) -> string. Defaults to the bundled client.
 * @param opts.parseJSON  JSON-salvage fn. Defaults to the bundled one.
 * @param opts.namespace  provider namespace key. Default 'LLM'.
 * @param opts.base/model/key  config for the default client (ignored if `ask` is given).
 */
function createLLMProvider( opts ) {
	opts          = opts || {};
	var ask        = opts.ask || makeAsk(opts),
	    _parseJSON = opts.parseJSON || parseJSON,
	    namespace  = opts.namespace || 'LLM';

	var ns = {};
	ns[namespace] = {
		complete: function ( graph, concept, scope, argz, cb ) {
			var cfg  = Object.assign({}, concept._schema && concept._schema.prompt, argz && argz[0]),
			    name = concept._name,
			    sys  = interpolate(cfg.system, graph, scope),
			    usr  = interpolate(cfg.user, graph, scope);
			Promise.resolve()
				.then(function () {
					return ask({ system: sys, user: usr, maxTokens: cfg.maxTokens });
				})
				.then(function ( txt ) {
					// report prompt+reply to the trace (no-op if no sink configured)
					graph.traceProvider && graph.traceProvider(concept, scope, { prompt: { system: sys, user: usr }, reply: txt });
					var result = cfg.json ? _parseJSON(txt) : txt;
					var facts  = { $_id: '_parent' };
					facts[name] = true;
					if ( cfg.as ) facts[cfg.as] = result;
					else if ( cfg.json && result && typeof result === 'object' && !Array.isArray(result) ) Object.assign(facts, result);
					else facts[name + 'Result'] = result;
					cb(null, facts);
				})
				.catch(function ( e ) {
					var facts = { $_id: '_parent', llmError: e.message };
					facts[name] = true;
					cb(null, facts);// flag + record error so the graph can still settle
				});
		}
	};
	return ns;
}

module.exports = { createLLMProvider: createLLMProvider, makeAsk: makeAsk, parseJSON: parseJSON };
