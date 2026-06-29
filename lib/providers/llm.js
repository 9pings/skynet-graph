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
 *   - `facts:{<key>:<spec>}` -> the CANONICALIZATION BARRIER (doc/MODELISATION.md §4.2):
 *     write ONLY those discrete keys (enum-snapped / grain-rounded / typed) as *tracked*
 *     facts, the free reply text under an *untracked* `prose` key, and a stable
 *     `<name>FactsDigest` memo key. This is what keeps downstream `require`/`ensure`
 *     edges keyed on stable discrete facts instead of fragmenting on prose (K1).
 *   - on backend error the concept is still flagged + `llmError` recorded, so the graph
 *     can settle instead of hanging.
 */

var canonicalize = require('./canonicalize');

// ---- backend clients (Node global fetch). Configurable via env / opts. `makeAsk` dispatches on
// the API flavour (opts.api / env LLM_API): 'anthropic' (default, /v1/messages) or 'openai'
// (/v1/chat/completions). A host can always inject its own `ask` instead. ----
function makeAnthropicAsk( opts ) {
	opts = opts || {};
	var BASE  = opts.base  || process.env.LLM_BASE  || 'http://localhost:3000';
	var MODEL = opts.model || process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
	var KEY   = opts.key   || process.env.LLM_KEY   || 'sk-local';
	return async function ask( { system, user, maxTokens = 1024, temperature } ) {
		// `temperature` (undefined unless a host drives it, e.g. from the plasticity ledger) is dropped
		// by JSON.stringify when undefined, so the request body is unchanged for callers that don't set it.
		var res = await fetch(BASE.replace(/\/$/, '') + '/v1/messages', {
			method : 'POST',
			headers: {
				'content-type'     : 'application/json',
				'x-api-key'        : KEY,
				'authorization'    : 'Bearer ' + KEY,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: system, temperature: temperature, messages: [{ role: 'user', content: user }] })
		});
		if ( !res.ok ) throw new Error('LLM HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
		var j = await res.json();
		if ( j.error ) throw new Error('LLM error: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 200));
		return (j.content || []).map(function ( b ) { return b.text || ''; }).join('');
	};
}

// OpenAI-compatible chat-completions client (vLLM / llama.cpp / LM Studio / a local OpenAI shim).
// Reads `choices[0].message.content`; for REASONING models that spend the token budget on a separate
// `reasoning_content` and return empty `content`, it falls back to that text (cleaner than the
// Anthropic shim, which mixes the thinking into the text and relies on JSON salvage).
function makeOpenAIAsk( opts ) {
	opts = opts || {};
	var BASE  = opts.base  || process.env.LLM_BASE  || 'http://localhost:5000';
	var MODEL = opts.model || process.env.LLM_MODEL || 'default';
	var KEY   = opts.key   || process.env.LLM_KEY   || 'sk-local';
	// extra request-body fields merged into every call — e.g. disable a reasoning model's "thinking":
	//   extraBody: { chat_template_kwargs: { enable_thinking: false } }   (Qwen3 on vLLM/SGLang)
	var EXTRA = opts.extraBody || (process.env.LLM_NO_THINK ? { chat_template_kwargs: { enable_thinking: false } } : null);
	// ASSISTANT PREFILL (no-think for reasoning models that IGNORE chat_template_kwargs — e.g. Qwen3.x in LM
	// Studio): seed a trailing assistant turn with CLOSED think tags so the model skips reasoning and emits the
	// answer directly (the server returns only the continuation, not the prefill). Verified the kwargs path is a
	// no-op there while this yields a clean one-word reply. Opt-in: opts.assistantPrefill, or LLM_NO_THINK env
	// (which also sends the kwargs above — harmless if ignored). Set opts.assistantPrefill='' to disable.
	var PREFILL = opts.assistantPrefill != null ? opts.assistantPrefill
		: (process.env.LLM_NO_THINK ? '<think>\n\n</think>\n\n' : null);
	return async function ask( { system, user, maxTokens = 1024, temperature } ) {
		var messages = [];
		if ( system ) messages.push({ role: 'system', content: system });
		messages.push({ role: 'user', content: user });
		if ( PREFILL ) messages.push({ role: 'assistant', content: PREFILL });   // continuation seed → skips thinking
		var res = await fetch(BASE.replace(/\/$/, '') + '/v1/chat/completions', {
			method : 'POST',
			headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + KEY },
			body   : JSON.stringify(Object.assign({ model: MODEL, max_tokens: maxTokens, temperature: temperature, messages: messages }, EXTRA))
		});
		if ( !res.ok ) throw new Error('LLM HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
		var j = await res.json();
		if ( j.error ) throw new Error('LLM error: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 200));
		var m = (j.choices && j.choices[0] && j.choices[0].message) || {};
		var content = m.content || '';
		if ( !String(content).trim() && m.reasoning_content ) content = m.reasoning_content;
		return content;
	};
}

function makeAsk( opts ) {
	opts = opts || {};
	var api = opts.api || process.env.LLM_API;
	return api === 'openai' ? makeOpenAIAsk(opts) : makeAnthropicAsk(opts);
}

// ---- Robust against "thinking" models: returns the LAST balanced {...}/[...] that JSON.parses. ----
function parseJSON( text ) {
	// strict first: if the WHOLE reply is valid JSON, use it verbatim — this preserves a nested
	// wrapper like `{"steps":[{…}]}` that the salvage heuristic below would mis-grab (it returns the
	// LAST balanced object = an inner element, dropping the wrapper key). Common with no-think replies.
	try { return JSON.parse(String(text).trim()); } catch ( _e ) { /* fall through to salvage */ }
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
 * @param opts.plasticity (conceptName)->p∈[0,1]  the UNIFIED plasticity knob (e.g. a
 *        `lifecycle.plasticity` accessor). When wired, it drives the call temperature:
 *        p=1 plastic → full temperature (explore/learn), p=0 frozen → temperature 0
 *        (deterministic, memo-perfect). DISCIPLINE: this only modulates the call — it
 *        never gates applicability (K1). Unwired → temperature is left unset (no API change).
 * @param opts.temperature (p)->number  optional mapping from plasticity to temperature
 *        (default identity, since p and the common temperature range are both [0,1]).
 * @param opts.base/model/key  config for the default client (ignored if `ask` is given).
 */
function createLLMProvider( opts ) {
	opts          = opts || {};
	var ask        = opts.ask || makeAsk(opts),
	    _parseJSON = opts.parseJSON || parseJSON,
	    namespace  = opts.namespace || 'LLM',
	    plasticity = opts.plasticity,
	    tempFn     = typeof opts.temperature === 'function' ? opts.temperature : null;

	var ns = {};
	ns[namespace] = {
		complete: function ( graph, concept, scope, argz, cb ) {
			var cfg  = Object.assign({}, concept._schema && concept._schema.prompt, argz && argz[0]),
			    name = concept._name,
			    sys  = interpolate(cfg.system, graph, scope),
			    usr  = interpolate(cfg.user, graph, scope),
			    // plasticity (if wired) drives the temperature; else a static cfg.temperature; else unset
			    temp = plasticity ? (tempFn ? tempFn(plasticity(name)) : plasticity(name)) : cfg.temperature,
			    askArgs = { system: sys, user: usr, maxTokens: cfg.maxTokens };
			if ( temp != null ) askArgs.temperature = temp;
			Promise.resolve()
				.then(function () {
					return ask(askArgs);
				})
				.then(function ( txt ) {
					// report prompt+reply to the trace (no-op if no sink configured)
					graph.traceProvider && graph.traceProvider(concept, scope, { prompt: { system: sys, user: usr }, temperature: temp, reply: txt });
					var facts = { $_id: '_parent' };
					facts[name] = true;

					// --- canonicalization barrier: discrete facts tracked, prose untracked ---
					if ( cfg.facts ) {
						var raw  = _parseJSON(txt),                       // strict structured extraction
						    cf   = canonicalize.canonFacts(raw, cfg.facts);
						Object.assign(facts, cf.facts);                   // ONLY declared discrete keys, snapped -> TRACKED
						if ( cf.misses.length ) facts[name + 'CanonMiss'] = cf.misses;  // visible, fail-closed (untracked)
						var proseKey = cfg.prose || (name + 'Prose'),     // the terminal, UNTRACKED free text
						    proseVal = cfg.proseFrom != null ? raw[cfg.proseFrom]
						             : (raw && raw.prose != null ? raw.prose : txt);
						facts[proseKey] = proseVal;
						if ( cfg.digest !== false ) facts[name + 'FactsDigest'] = canonicalize.digest(cf.facts);
						return cb(null, facts);
					}

					// --- legacy path (no facts schema): merge object / `as` / `<name>Result` ---
					var result = cfg.json ? _parseJSON(txt) : txt;
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

module.exports = {
	createLLMProvider: createLLMProvider, makeAsk: makeAsk, parseJSON: parseJSON,
	makeOpenAIAsk: makeOpenAIAsk, makeAnthropicAsk: makeAnthropicAsk
};
