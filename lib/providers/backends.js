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
 * backends — the PRESET / CONFIG layer over the ask-makers (`llm.js`, `llm-local.js`). One thin,
 * data-driven place to answer "given a provider NAME + a key, hand me a chat `ask`". It invents no
 * protocol and no router: every hosted provider worth targeting is OpenAI-compatible except Anthropic
 * (its own `/v1/messages`) and the embedded local model (`node-llama-cpp`) — so the table is small and
 * a new provider is one row (base + flavour + key-env).
 *
 * It is the SHARED foundation the serving surfaces, the Studio backend panel, and the client's N-tier
 * routing all consume: the public preset table here = the free config brick; the client wraps it with a
 * policy (order + `dataPolicy:'no-egress'`); the pro adds per-task routing. The `egress` flag carried on
 * every resolved backend (local=false, remote=true) is the SEED that a no-egress policy reads to decide
 * what a query is allowed to leave the machine for.
 *
 *   const ask = makeBackend({ preset: 'deepseek' });                 // key from $DEEPSEEK_API_KEY
 *   const ask = makeBackend({ preset: 'custom', base: 'http://localhost:8000', key: 'sk-x' });  // any vLLM
 *   const ask = makeBackend({ preset: 'local', modelPath: '/models/qwen.gguf' });               // embedded
 *
 * The returned `ask` is the standard chat seam: `async ({system,user,maxTokens,temperature}) -> text`.
 */
const llm = require('./llm');

// The preset table. `base` is the API ROOT (the OpenAI maker appends `/v1/chat/completions`, the
// Anthropic maker `/v1/messages`) — so bases here carry NO `/v1`. `defaultModel` is only a convenience
// default (always overridable via spec.model or $LLM_MODEL), kept minimal so the table does not rot.
const BACKENDS = {
	local:       { api: 'local',     label: 'Local (embedded GGUF)',       egress: false, needsKey: false },
	openai:      { api: 'openai',    label: 'OpenAI',        base: 'https://api.openai.com',        egress: true, needsKey: true, keyEnv: 'OPENAI_API_KEY',    defaultModel: 'gpt-4o-mini' },
	anthropic:   { api: 'anthropic', label: 'Anthropic (Claude)', base: 'https://api.anthropic.com', egress: true, needsKey: true, keyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-sonnet-latest' },
	huggingface: { api: 'openai',    label: 'Hugging Face',  base: 'https://router.huggingface.co',  egress: true, needsKey: true, keyEnv: 'HF_TOKEN' },
	deepseek:    { api: 'openai',    label: 'DeepSeek',      base: 'https://api.deepseek.com',       egress: true, needsKey: true, keyEnv: 'DEEPSEEK_API_KEY',  defaultModel: 'deepseek-chat' },
	openrouter:  { api: 'openai',    label: 'OpenRouter',    base: 'https://openrouter.ai/api',      egress: true, needsKey: true, keyEnv: 'OPENROUTER_API_KEY' },
	// `custom` = any OpenAI-compatible endpoint you point at (a local vLLM / llama-server / LM Studio, a
	// LAN model, a self-host). No key required by default; set `api:'anthropic'` for a Claude-shaped one.
	custom:      { api: 'openai',    label: 'Custom (bring your own base)', egress: true, needsKey: false }
};

const ALIASES = { claude: 'anthropic', hf: 'huggingface', 'gguf': 'local' };

function err( message, code ) { return Object.assign(new Error(message), { code: code }); }

/**
 * Normalize a backend spec into a descriptor (PURE — no maker call, no secret logged). Precedence per
 * field: `spec > environment > preset default`. Default preset is `custom` (a bare OpenAI-compatible
 * endpoint), so `resolveBackend({ base, key })` just works for a self-hosted model.
 * @param spec { preset?, base?, model?, key?, modelPath?, api?, egress? }
 * @returns { name, api, base, model, key, modelPath, egress, needsKey, keyEnv, label }
 */
function resolveBackend( spec ) {
	spec = spec || {};
	const asked = spec.preset || spec.backend || spec.name || 'custom';
	const name = ALIASES[asked] || asked;
	const preset = BACKENDS[name];
	if ( !preset ) throw err('unknown backend preset "' + asked + '" — known: ' + Object.keys(BACKENDS).join(', '), 'UNKNOWN_BACKEND');

	const api = spec.api || preset.api;
	const base = spec.base || preset.base || process.env.LLM_BASE || null;
	const model = spec.model || process.env.LLM_MODEL || preset.defaultModel || null;
	const key = spec.key || (preset.keyEnv && process.env[preset.keyEnv]) || process.env.LLM_KEY || null;
	const modelPath = api === 'local' ? (spec.modelPath || process.env.LOCAL_MODEL || null) : null;
	const egress = spec.egress != null ? !!spec.egress : !!preset.egress;

	return { name: name, api: api, base: base, model: model, key: key, modelPath: modelPath,
		egress: egress, needsKey: !!preset.needsKey, keyEnv: preset.keyEnv || null, label: preset.label };
}

/**
 * Build a chat `ask` for a backend spec. Dispatches on the resolved flavour; a needs-key preset with no
 * resolvable key is a typed `NO_API_KEY` error UP FRONT (a clear message beats an opaque 401 mid-call).
 * @returns async ({system,user,maxTokens,temperature}) -> text
 */
function makeBackend( spec ) {
	spec = spec || {};
	const d = resolveBackend(spec);
	if ( d.needsKey && !d.key ) throw err('backend "' + d.name + '" needs an API key — set ' + (d.keyEnv || 'a key') + ' or pass { key }', 'NO_API_KEY');

	if ( d.api === 'local' ) {
		// lazy: only a host that actually uses the embedded model pays for the optional native dep.
		const makeLocalAsk = require('./llm-local').makeLocalAsk;
		return makeLocalAsk(Object.assign({}, spec.localOpts, { modelPath: d.modelPath, reasoningBudget: spec.reasoningBudget }));
	}
	const opts = { api: d.api, base: d.base, model: d.model, key: d.key };
	if ( spec.extraBody ) opts.extraBody = spec.extraBody;
	if ( spec.assistantPrefill != null ) opts.assistantPrefill = spec.assistantPrefill;
	return llm.makeAsk(opts);   // dispatches openai/anthropic on opts.api
}

/**
 * The presets as a SECRET-FREE list (for a Studio dropdown / `sg` help): name, label, flavour, whether a
 * key is needed and from which env, and the egress class. Never returns a resolved key.
 */
function listBackends() {
	return Object.keys(BACKENDS).map(function ( name ) {
		const p = BACKENDS[name];
		return { name: name, label: p.label, api: p.api, base: p.base || null,
			egress: !!p.egress, needsKey: !!p.needsKey, keyEnv: p.keyEnv || null };
	});
}

module.exports = { BACKENDS: BACKENDS, ALIASES: ALIASES, resolveBackend: resolveBackend, makeBackend: makeBackend, listBackends: listBackends };
