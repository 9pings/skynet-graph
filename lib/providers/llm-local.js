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
 * node-llama-cpp is an OPTIONAL native dep (precedent: the durable layer's `node:sqlite`), loaded via dynamic
 * import (v3 is ESM-only), so a host that never wires a local model never needs it. The `mindsmith` appliance
 * declares it in `optionalDependencies`; a skynet-graph-direct host that wants embedded inference installs it
 * (`npm install node-llama-cpp` — prebuilt binaries, no compile). GPU auto-detected (CUDA/Metal/Vulkan) with a
 * CPU fallback; the no-build/browser sibling is `wllama` (same
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
 * CENTRALIZED (see `local-host.js`): every `makeLocalAsk` is a thin handle over a process-wide shared host that owns
 * the GPU-resident model(s) + an in-memory prompt cache. So N handles / namespaces of the SAME gguf share ONE VRAM
 * load, several constrained grammars share that load (grammar is applied per-call), identical deterministic (temp-0)
 * prompts are served from cache, and VRAM is bounded by LRU eviction (env `SG_LOCAL_VRAM_BUDGET_GB` / `SG_LOCAL_MAX_MODELS`,
 * or pass `opts.host` for a dedicated budget / test isolation).
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
 * @param opts.reasoningBudget  native thinking budget in tokens (node-llama-cpp `budgets.thoughtTokens`): 0 disables
 *                        thinking (the adapted lever for a reasoning model at a one-token typed touchpoint, where CoT only
 *                        truncates the answer); undefined = the model default. Overridable per call.
 * @returns async ask({ system, user, maxTokens, temperature, grammar, reasoningBudget }) -> string   (JSON string when a grammar is set).
 *          A PER-CALL `grammar` ({jsonSchema}|{gbnf}) OVERRIDES the construction-time one — so a caller whose grammar
 *          depends on the call (e.g. the borderline gate's `enumGbnf(spec)`, one grammar per enum) can request it per
 *          call; `local-host.ask` already applies grammar per call, sharing one model load. Omit it → construction default.
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

const { sharedLocalModelHost } = require('./local-host');

function makeLocalAsk( opts ) {
	opts = opts || {};
	const modelPath = resolveModelPath(opts);
	if ( !modelPath ) throw new Error('makeLocalAsk: no model — pass opts.modelPath, set env LOCAL_MODEL, or drop a single .gguf into models/ (npm run local-inference:setup)');
	// Delegate model ownership + the prompt cache to a CENTRALIZED host (local-host.js): so N handles /
	// namespaces of the SAME gguf share ONE VRAM load, several grammars share that load (grammar is applied
	// per-call), identical deterministic prompts are cached, and VRAM is managed under a budget with LRU
	// eviction. `opts.host` overrides the process-wide shared host (test isolation / a dedicated budget).
	const host    = opts.host || sharedLocalModelHost();
	const grammar = opts.jsonSchema ? { jsonSchema: opts.jsonSchema } : opts.gbnf ? { gbnf: opts.gbnf } : null;

	return async function ask( { system, user, maxTokens = 1024, temperature = 0, grammar: callGrammar, reasoningBudget: callRB } ) {
		return host.ask({
			modelPath, contextSize: opts.contextSize, gpu: opts.gpu, lora: opts.lora,
			grammar: callGrammar || grammar, system, user, maxTokens, temperature,
			reasoningBudget: callRB != null ? callRB : opts.reasoningBudget, seed: opts.seed == null ? 0 : opts.seed
		});
	};
}

module.exports = { makeLocalAsk };
