/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * local-host — a CENTRALIZED in-process host for embedded inference (node-llama-cpp): ONE place that owns
 * the GPU-resident model(s) + an in-memory prompt cache, so many `makeLocalAsk` handles / per-concept
 * namespaces SHARE a single VRAM load and identical (deterministic) prompts don't re-run.
 *
 * WHY (the design gap the naive per-instance makeLocalAsk had): each `makeLocalAsk({...})` loaded its OWN
 * model → N arms / N namespaces of the SAME gguf = N copies in VRAM (the 2026-07-01 signature-stability run
 * loaded a 3.2GB model 4× per experiment), and nothing cached identical prompts. This host fixes both and
 * manages VRAM under a budget (LRU eviction) — the in-process analogue of a grant-based GPU orchestrator.
 *
 * Reference: rocinante `GPUMaster.js` (a grant-based multi-GPU VRAM orchestrator). We LIFT its ideas — a
 * load-once registry, a VRAM ledger + real-VRAM guard (here `llama.getVramState()` not nvidia-smi), LRU
 * eviction — and DROP the machinery an in-process single-process node-llama-cpp host does not need (HTTP
 * load/unload endpoints, the multi-GPU grant queue, the task DB, exclusive/shared cross-card placement).
 *
 * Grammar is applied PER CALL (cached by schema on the handle), NOT baked per model → several constrained
 * grammars share ONE model load. Only temperature-0 (deterministic) completions are cached.
 *
 * ZERO-CORE, provider layer. The model loader is INJECTABLE (`opts.loadModel`) so the registry / cache /
 * eviction logic is unit-testable without a GPU; the default loader is node-llama-cpp.
 *
 * A loader returns a HANDLE:  { vramBytes?, async complete({system,user,maxTokens,temperature,seed,grammar,reasoningBudget})
 *                               -> string,  dispose() }  — `grammar` is a spec {jsonSchema}|{gbnf}|null;
 *                               `reasoningBudget` is the native thinking budget in tokens (0 = thinking OFF, undefined = default).
 */

function modelKey( spec ) {
	// EVERYTHING that affects the actual VRAM load is in the key (so distinct configs never collide and
	// identical configs SHARE one load — the single-model, two-budgets case). reasoningBudget is NOT here:
	// it is a per-CALL parameter, so one loaded model answers both no-think (budget 0) and with-think calls.
	return [spec.modelPath, 'ctx=' + (spec.contextSize || 4096), 'gpu=' + (spec.gpu === undefined ? 'auto' : spec.gpu),
		'lora=' + (spec.lora ? JSON.stringify(spec.lora) : ''),
		'llama=' + (spec.llama ? stable(spec.llama) : ''), 'model=' + (spec.model ? stable(spec.model) : '')].join('|');
}
function grammarKey( g ) { return g ? (g.jsonSchema ? 'js:' + stable(g.jsonSchema) : g.gbnf ? 'gb:' + g.gbnf : '') : ''; }
// Finalize a completion under an optional COMPILED grammar. A JSON-SCHEMA grammar exposes `.parse()` (re-emit canonical
// JSON); a raw GBNF grammar does NOT — its constrained output is already the bare text (e.g. an enum member). Guarding on
// `typeof gr.parse === 'function'` (not merely `gr`) is the fix for the raw-GBNF path (`gr.parse is not a function`).
function finalizeGrammarOutput( gr, out ) {
	// A JSON-schema grammar guarantees a valid PREFIX, but a completion truncated at maxTokens can end mid-string, and
	// `gr.parse()` (which JSON.parses) then THROWS on the unterminated JSON — crashing the whole run on one long, noisy
	// generation (seen on Gemma-4-31B-Q2 under the intake schema). Degrade to the raw constrained text (fail-closed):
	// the caller's own parse/guard salvages or nulls it, so a verbose model costs a fail-closed episode, not a crash.
	if ( gr && typeof gr.parse === 'function' ) {
		try { return JSON.stringify(gr.parse(out)); } catch ( _e ) { return out; }
	}
	return out;
}
function stable( o ) { return JSON.stringify(o, Object.keys(o || {}).sort()); }   // shallow-stable (schemas are small)
function cacheKey( mk, gk, r ) {
	var US = '\u001f';                                           // unit separator — collision-safe, NOT a NUL byte (the source-NUL gotcha)
	return [mk, gk, r.maxTokens || '', r.temperature || 0, r.seed == null ? 0 : r.seed,
		r.reasoningBudget == null ? '' : 'rb' + r.reasoningBudget, r.system || '', r.user || ''].join(US);
}

/**
 * @param opts.loadModel     async (spec) -> handle. Default: node-llama-cpp.
 * @param opts.vramBudgetGB  soft VRAM budget; when the ledger (Σ handle.vramBytes) would exceed it, LRU-evict.
 * @param opts.maxModels     hard cap on resident models (LRU-evict beyond it). Default: unbounded.
 * @param opts.cacheSize     bounded prompt-cache entries (LRU). Default 512; 0 disables.
 */
function createLocalModelHost( opts ) {
	opts = opts || {};
	const loadModel  = opts.loadModel || defaultLoader(opts);
	const vramBudget = opts.vramBudgetGB != null ? opts.vramBudgetGB * 1e9 : null;
	const maxModels  = opts.maxModels || null;
	const cacheMax   = opts.cacheSize == null ? 512 : opts.cacheSize;

	const models = new Map();          // key -> { spec, handle, loading, vramBytes, lastUsed, chain }
	const cache  = new Map();          // LRU (insertion-ordered) prompt cache
	const stats  = { loads: 0, evictions: 0, cacheHits: 0, cacheMisses: 0, infer: 0 };
	let tick = 0;

	function totalVram() { let s = 0; for ( const e of models.values() ) s += e.vramBytes || 0; return s; }

	async function evictIfNeeded( keepKey ) {
		// evict LRU residents (never the one just requested) while over the count cap or the vram budget.
		function over() { return (maxModels && models.size > maxModels) || (vramBudget && totalVram() > vramBudget); }
		while ( over() ) {
			let victim = null, oldest = Infinity;
			for ( const [k, e] of models ) if ( k !== keepKey && !e.loading && e.lastUsed < oldest ) { oldest = e.lastUsed; victim = k; }
			if ( !victim ) break;
			const e = models.get(victim);
			models.delete(victim);
			stats.evictions++;
			try { e.handle && e.handle.dispose && e.handle.dispose(); } catch ( _e ) { /* best-effort */ }
		}
	}

	async function getModel( spec ) {
		const key = modelKey(spec);
		let e = models.get(key);
		if ( e ) { e.lastUsed = ++tick; return e.loading ? e.loading : e.handle; }
		e = { spec, handle: null, loading: null, vramBytes: 0, lastUsed: ++tick, chain: Promise.resolve() };
		e.loading = Promise.resolve()
			.then(() => loadModel(spec))
			.then(( h ) => { e.handle = h; e.vramBytes = h && h.vramBytes || 0; e.loading = null; stats.loads++; return h; });
		models.set(key, e);
		const h = await e.loading;
		await evictIfNeeded(key);          // make room AFTER we know this one's footprint (never evict `key`)
		return h;
	}

	/** The one entry point: resolve/share the model, check the prompt cache, serialize the GPU call. */
	async function ask( req ) {
		const spec = { modelPath: req.modelPath, contextSize: req.contextSize, gpu: req.gpu, lora: req.lora, llama: req.llama, model: req.model };
		const mk = modelKey(spec), gk = grammarKey(req.grammar);
		const ck = cacheKey(mk, gk, req);
		if ( cacheMax && cache.has(ck) ) { stats.cacheHits++; const v = cache.get(ck); cache.delete(ck); cache.set(ck, v); return v; }
		stats.cacheMisses++;
		await getModel(spec);
		const e = models.get(mk);
		// per-model serialization: chain calls so concurrent asks queue (don't exhaust sequences).
		const run = e.chain.then(() => e.handle.complete({
			system: req.system, user: req.user, maxTokens: req.maxTokens, temperature: req.temperature,
			seed: req.seed, grammar: req.grammar, reasoningBudget: req.reasoningBudget
		}));
		e.chain = run.catch(() => {});    // keep the chain alive past a failure
		const out = await run;
		stats.infer++;
		if ( cacheMax && (req.temperature || 0) === 0 ) {   // cache ONLY deterministic results
			cache.set(ck, out);
			if ( cache.size > cacheMax ) cache.delete(cache.keys().next().value);   // evict oldest
		}
		return out;
	}

	function dispose() {
		for ( const e of models.values() ) { try { e.handle && e.handle.dispose && e.handle.dispose(); } catch ( _e ) {} }
		models.clear(); cache.clear();
	}

	return { ask, getModel, dispose, stats, _models: models, _cache: cache };
}

// ── default node-llama-cpp loader (lazy; only required when the default host actually loads a model) ──
function defaultLoader( hostOpts ) {
	return async function load( spec ) {
		let nlc;
		try { nlc = await import('node-llama-cpp'); }
		catch ( e ) { throw new Error('node-llama-cpp is not installed — the embedded gguf backend needs it. Run:  npm install node-llama-cpp  (prebuilt binaries, no compile). Cause: ' + e.message); }
		const { getLlama, LlamaChatSession } = nlc;
		// getLlama options (gpu · build:"auto"|"forceRebuild"|"never" · usePrebuiltBinaries:false = build from source ·
		// cmakeOptions · maxThreads …) = the CUSTOM-BUILD surface; loadModel options (gpuLayers · useMmap · useMlock …).
		const llamaOpts = Object.assign({}, spec.llama, spec.gpu === undefined ? {} : { gpu: spec.gpu });
		const llama   = await getLlama(Object.keys(llamaOpts).length ? llamaOpts : undefined);
		const before  = tryVram(llama);
		const model   = await llama.loadModel(Object.assign({ modelPath: spec.modelPath }, spec.model));
		const context = await model.createContext(Object.assign({ contextSize: spec.contextSize || 4096 }, spec.lora ? { lora: spec.lora } : {}));
		const after   = tryVram(llama);
		const vramBytes = (before != null && after != null) ? Math.max(0, after - before) : 0;
		const grammars = new Map();                                   // schema -> compiled grammar (per model)
		async function grammarFor( g ) {
			if ( !g ) return null;
			const k = grammarKey(g);
			if ( grammars.has(k) ) return grammars.get(k);
			const compiled = g.jsonSchema ? await llama.createGrammarForJsonSchema(g.jsonSchema) : await llama.createGrammar({ grammar: g.gbnf });
			grammars.set(k, compiled);
			return compiled;
		}
		// ONE persistent sequence per model, REUSED across calls (`clearHistory` resets the KV for a clean single-turn).
		// A VRAM-tight context allocates only 1 sequence; getSequence()/dispose() per call then throws "No sequences left"
		// on the 2nd call (dispose does not return a slot to a 1-sequence pool). Reuse is also the right shape given the
		// host serializes calls per model. (Live-verified on Qwen3.6-27B-Q2, which loads a 1-sequence context.)
		const seq = context.getSequence();
		return {
			vramBytes,
			async complete( { system, user, maxTokens = 1024, temperature = 0, seed, grammar, reasoningBudget } ) {
				const gr = await grammarFor(grammar);
				try { await seq.clearHistory(); } catch ( _e ) {}     // reset the reused sequence's KV for a fresh single-turn
				const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: system || undefined, autoDisposeSequence: false });
				try {
					const popts = Object.assign({ maxTokens, temperature, seed: seed == null ? 0 : seed }, gr ? { grammar: gr } : {});
					// native thinking control (node-llama-cpp `budgets.thoughtTokens`; == CLI --reasoningBudget). 0 = thinking OFF —
					// the adapted lever for a reasoning model at a one-token TYPED touchpoint (CoT there just truncates the answer).
					if ( reasoningBudget != null ) popts.budgets = { thoughtTokens: reasoningBudget };
					const out = await session.prompt(user, popts);
					return finalizeGrammarOutput(gr, out);
				} finally { try { session.dispose({ disposeSequence: false }); } catch ( _e ) {} }   // keep the sequence for the next call
			},
			dispose() { try { model.dispose(); } catch ( _e ) {} }
		};
	};
	function tryVram( llama ) { try { const s = llama.getVramState && llama.getVramState(); return s ? s.used : null; } catch ( _e ) { return null; } }
}

// a process-wide shared host (so independent makeLocalAsk handles share loads + the prompt cache).
let _shared = null;
function sharedLocalModelHost() {
	if ( !_shared ) _shared = createLocalModelHost({
		vramBudgetGB: process.env.SG_LOCAL_VRAM_BUDGET_GB ? Number(process.env.SG_LOCAL_VRAM_BUDGET_GB) : undefined,
		maxModels   : process.env.SG_LOCAL_MAX_MODELS ? Number(process.env.SG_LOCAL_MAX_MODELS) : undefined,
	});
	return _shared;
}

module.exports = { createLocalModelHost, sharedLocalModelHost, modelKey, grammarKey, finalizeGrammarOutput };
