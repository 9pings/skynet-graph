/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * llm-local — an IN-PROCESS `ask` backend (node-llama-cpp / GGUF) for the LLM provider seam, so the library runs its
 * small functional model(s) itself — a self-contained reasoning appliance, no external HTTP endpoint (2026-07-01
 * embedded-inference study). ZERO-CORE: the ONLY model coupling is `ask({system,user,maxTokens,temperature}) -> string`
 * (mirrors `llm.js#makeOpenAIAsk`); this is a drop-in `ask` for `createLLMProvider({ ask })`.
 *
 * node-llama-cpp is an OPTIONAL native dep (precedent: the durable layer's `node:sqlite`) — declared in
 * `optionalDependencies`, loaded via dynamic import (v3 is ESM-only), so a host that never wires a local model never
 * needs it. GPU auto-detected (CUDA/Metal/Vulkan) with a CPU fallback; the no-build/browser sibling is `wllama` (same
 * GGUF, WASM) — a future `makeWasmAsk`.
 *
 * THE CROWN JEWEL — CONSTRAINED DECODING. `opts.jsonSchema` (or `opts.gbnf`) forces the model to emit a grammar-valid
 * token at every step: a small (noisy) model then CANNOT produce a malformed typed fact → the canonicalization barrier
 * (`prompt.facts`) is enforced at the DECODE level, so the K1 memo keys stay stable (the signature-stability lever).
 * Grammar guarantees valid FORMAT, not correct CONTENT — keep the C-contract / verify pass as the content check.
 *
 * Per-concept MULTI-MODEL: register several namespaces, each its own `makeLocalAsk` (a specialist GGUF, or one base
 * model + a per-context LoRA adapter) — `createLLMProvider({ namespace:'CLASSIFY', ask: makeLocalAsk({...}) })`. Small
 * local models at the leaves; reserve a bigger/remote model for the META/supervisor tier (its judgment is weak at 3B).
 *
 *   const { createLLMProvider } = require('skynet-graph/lib/providers/llm');
 *   const { makeLocalAsk } = require('skynet-graph/lib/providers/llm-local');
 *   register(Graph, [ createLLMProvider({ ask: makeLocalAsk({ modelPath: '/models/small.gguf' }) }) ]);
 *
 * @param opts.modelPath   path to a GGUF file (or env LOCAL_MODEL).
 * @param opts.gpu         'auto'(default) | 'cuda' | 'metal' | 'vulkan' | false (CPU).
 * @param opts.contextSize context window (default 4096).
 * @param opts.lora        a LoRA adapter path | { adapters:[{ filePath, scale }] } (per-specialist, one base in VRAM).
 * @param opts.jsonSchema  a JSON Schema → grammar-constrained decoding (the typed-fact enforcer).
 * @param opts.gbnf        a raw GBNF grammar string (alternative to jsonSchema).
 * @param opts.seed        decode seed (default 0 → deterministic with temperature 0).
 * @returns async ask({ system, user, maxTokens, temperature }) -> string   (JSON string when a grammar is set).
 */
// resolve the GGUF path: explicit opt → env → the single .gguf in the gitignored models/ dir (a DX convenience).
function resolveModelPath( opts ) {
	if ( opts.modelPath ) return opts.modelPath;
	if ( process.env.LOCAL_MODEL ) return process.env.LOCAL_MODEL;
	try {
		const fs = require('fs'), path = require('path');
		const dir = opts.modelsDir || path.join(process.cwd(), 'models');
		const ggufs = fs.readdirSync(dir).filter(( f ) => f.endsWith('.gguf'));
		if ( ggufs.length === 1 ) return path.join(dir, ggufs[0]);
	} catch ( _e ) { /* no models/ dir → fall through to the guidance error */ }
	return null;
}

function makeLocalAsk( opts ) {
	opts = opts || {};
	const modelPath = resolveModelPath(opts);
	if ( !modelPath ) throw new Error('makeLocalAsk: no model — pass opts.modelPath, set env LOCAL_MODEL, or drop a single .gguf into models/ (npm run local-inference:setup)');
	let _ready = null;                                            // memoized init promise (load model ONCE)

	async function init() {
		let nlc;
		try { nlc = await import('node-llama-cpp'); }             // v3 is ESM-only → dynamic import from CJS
		catch ( e ) { throw new Error('node-llama-cpp is not installed. Run `npm run local-inference:setup` (it is an OPTIONAL native dep, not committed). Cause: ' + e.message); }
		const { getLlama, LlamaChatSession } = nlc;
		const llama   = await getLlama(opts.gpu === undefined ? undefined : { gpu: opts.gpu });
		const model   = await llama.loadModel({ modelPath });
		const context = await model.createContext(Object.assign({ contextSize: opts.contextSize || 4096 }, opts.lora ? { lora: opts.lora } : {}));
		let grammar = null;
		if ( opts.jsonSchema )   grammar = await llama.createGrammarForJsonSchema(opts.jsonSchema);
		else if ( opts.gbnf )    grammar = await llama.createGrammar({ grammar: opts.gbnf });
		return { llama, model, context, grammar, LlamaChatSession };
	}

	return async function ask( { system, user, maxTokens = 1024, temperature = 0 } ) {
		_ready = _ready || init();
		const R = await _ready;
		// a FRESH sequence per call → stateless like the HTTP shim (no chat-history bleed); dispose to avoid leaking
		// sequences. The taskflow SEQUENCES provider calls, so a single-sequence-at-a-time model is a natural fit.
		const seq = R.context.getSequence();
		try {
			const session = new R.LlamaChatSession({ contextSequence: seq, systemPrompt: system || undefined });
			const out = await session.prompt(user, Object.assign({ maxTokens, temperature, seed: opts.seed == null ? 0 : opts.seed }, R.grammar ? { grammar: R.grammar } : {}));
			return R.grammar ? JSON.stringify(R.grammar.parse(out)) : out;   // grammar → guaranteed-valid JSON for the facts path
		} finally {
			try { seq.dispose(); } catch ( _e ) { /* older API: no-op */ }
		}
	};
}

module.exports = { makeLocalAsk };
