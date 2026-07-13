'use strict';
/**
 * local-host — the centralized in-process embedded-inference host (GPU/VRAM + prompt cache). Hermetic:
 * the model loader is INJECTED (a fake), so the registry / cache / eviction / serialization logic is tested
 * without a GPU. Proves the design points the naive per-instance makeLocalAsk lacked: N handles of one model
 * share ONE load, several grammars share that load, identical deterministic prompts are cached, VRAM is
 * bounded by LRU eviction (with dispose), and concurrent calls on one model serialize.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLocalModelHost, grammarKey, finalizeGrammarOutput } = require('../../lib/providers/local-host');

// REGRESSION (G-1 rung 2 live-arm finding): the default loader's output finalizer assumed EVERY grammar exposes
// `.parse()`, but only a JSON-SCHEMA grammar does — a RAW GBNF grammar's constrained output is already bare text, so
// `gr.parse(out)` threw "gr.parse is not a function". The fix guards on `typeof gr.parse === 'function'`.
test('finalizeGrammarOutput — raw GBNF (no .parse) returns bare text; JSON-schema (.parse) re-emits JSON; null passes through', () => {
	assert.equal(finalizeGrammarOutput(null, 'high'), 'high', 'no grammar → raw output');
	const gbnf = {};                                             // a compiled GBNF grammar has NO .parse method
	assert.equal(finalizeGrammarOutput(gbnf, 'high'), 'high', 'raw GBNF → bare constrained text (the fix; no throw)');
	const jsonSchema = { parse: ( s ) => ({ ok: s }) };          // a compiled JSON-schema grammar exposes .parse
	assert.equal(finalizeGrammarOutput(jsonSchema, '{"ok":"x"}'), JSON.stringify({ ok: '{"ok":"x"}' }), 'JSON-schema → parsed + re-stringified');
});

// a fake loader: counts loads/disposes, its `complete` returns a deterministic string and asserts NO overlap.
function fakeLoader( log ) {
	return async function load( spec ) {
		log.loads.push(spec.modelPath);
		let active = 0;
		return {
			vramBytes: spec.__vram || 1e9,
			async complete( req ) {
				active++;
				if ( active > 1 ) throw new Error('OVERLAP on ' + spec.modelPath);   // serialization guard
				await new Promise(( r ) => setTimeout(r, 3));
				active--;
				return 'C:' + spec.modelPath + '|' + grammarKey(req.grammar) + '|' + req.user;
			},
			dispose() { log.disposed.push(spec.modelPath); }
		};
	};
}
const mk = ( over ) => Object.assign({ modelPath: '/m/A.gguf', system: 's', user: 'u', maxTokens: 32, temperature: 0, seed: 0 }, over);

test('one model is loaded ONCE and shared across grammars (grammar applied per call)', async () => {
	const log = { loads: [], disposed: [] };
	const host = createLocalModelHost({ loadModel: fakeLoader(log) });
	await host.ask(mk({ grammar: { jsonSchema: { type: 'object' } } }));
	await host.ask(mk({ grammar: { gbnf: 'root ::= "x"' }, user: 'v' }));   // different grammar + prompt, SAME model
	await host.ask(mk({ grammar: null, user: 'w' }));
	assert.equal(host.stats.loads, 1, 'the gguf loaded exactly once for three grammars');
	assert.equal(host._models.size, 1);
});

test('identical deterministic prompts hit the cache (no second inference); temp>0 is NOT cached', async () => {
	const log = { loads: [], disposed: [] };
	const host = createLocalModelHost({ loadModel: fakeLoader(log) });
	const a = await host.ask(mk({ user: 'same' }));
	const b = await host.ask(mk({ user: 'same' }));       // identical → cache hit
	assert.equal(a, b);
	assert.equal(host.stats.cacheHits, 1);
	assert.equal(host.stats.infer, 1, 'only ONE real inference for two identical calls');

	await host.ask(mk({ user: 'hot', temperature: 0.7 }));
	await host.ask(mk({ user: 'hot', temperature: 0.7 }));  // non-deterministic → never cached
	assert.equal(host.stats.cacheHits, 1, 'temp>0 results are not cached (would be unsound)');
});

test('VRAM/LRU eviction: maxModels caps residents, the LRU victim is disposed, re-ask reloads', async () => {
	const log = { loads: [], disposed: [] };
	const host = createLocalModelHost({ loadModel: fakeLoader(log), maxModels: 1 });
	await host.ask(mk({ modelPath: '/m/A.gguf' }));
	await host.ask(mk({ modelPath: '/m/B.gguf' }));       // over the cap → evict A
	assert.deepEqual(log.disposed, ['/m/A.gguf'], 'the LRU model was disposed (VRAM freed)');
	assert.equal(host._models.size, 1);
	// NOTE: a DISTINCT prompt on A (cache miss) forces the reload — an identical prompt would return from the
	// cache WITHOUT reloading (the prompt cache sits ABOVE model residency: a cached answer survives eviction).
	await host.ask(mk({ modelPath: '/m/A.gguf', user: 'reload' }));
	assert.equal(host.stats.loads, 3, 'A reloaded after eviction (on a cache-missing prompt)');
	assert.equal(host.stats.evictions, 2);
});

test('concurrent calls on ONE model serialize (no sequence overlap)', async () => {
	const log = { loads: [], disposed: [] };
	const host = createLocalModelHost({ loadModel: fakeLoader(log) });
	// distinct prompts (so the cache does not short-circuit) fired concurrently
	const rs = await Promise.all([0, 1, 2, 3].map(( i ) => host.ask(mk({ user: 'p' + i }))));
	assert.equal(rs.length, 4);
	assert.equal(host.stats.loads, 1, 'still one shared load');
	assert.equal(host.stats.infer, 4, 'all four ran — serialized, none threw OVERLAP');
});

test('cache is bounded (LRU eviction of oldest prompt)', async () => {
	const log = { loads: [], disposed: [] };
	const host = createLocalModelHost({ loadModel: fakeLoader(log), cacheSize: 2 });
	await host.ask(mk({ user: 'a' }));
	await host.ask(mk({ user: 'b' }));
	await host.ask(mk({ user: 'c' }));   // evicts 'a'
	assert.equal(host._cache.size, 2, 'cache stays bounded at 2');
	const before = host.stats.infer;
	await host.ask(mk({ user: 'a' }));   // 'a' was evicted → a real inference again
	assert.equal(host.stats.infer, before + 1, 'the evicted prompt re-ran');
});

// cont.⁶ — the native thinking control (`budgets.thoughtTokens`, == CLI --reasoningBudget). It reaches the loader AND is
// part of the cache key: two calls differing ONLY in reasoningBudget must NOT share a cache entry (a different budget is a
// different completion). 0 = thinking OFF (the adapted lever for a reasoning model at a one-token typed touchpoint).
test('reasoningBudget reaches the loader AND is part of the cache key (a different budget re-infers)', async () => {
	const seen = [];
	const host = createLocalModelHost({ loadModel: () => Promise.resolve({ vramBytes: 1e9,
		async complete( req ) { seen.push(req.reasoningBudget); return 'C:' + req.reasoningBudget; }, dispose() {} }) });
	await host.ask(mk({ reasoningBudget: 0 }));
	await host.ask(mk({ reasoningBudget: 0 }));       // identical → cache hit (no 2nd inference)
	await host.ask(mk({ reasoningBudget: 128 }));     // different budget → cache MISS → re-infer
	assert.deepEqual(seen, [0, 128], 'the loader saw reasoningBudget; a different budget was NOT served from cache');
	assert.equal(host.stats.cacheHits, 1);
	assert.equal(host.stats.infer, 2);
});

// SINGLE-MODEL (mindsmith --model): one loaded gguf answers BOTH the graph's no-think work (budget 0) AND the
// user-facing answer WITH think (budget N) on ONE VRAM load — because reasoningBudget is a per-CALL parameter,
// NOT part of the load key. This is the "not enough VRAM for two models" case, proven without a GPU.
test('SINGLE-MODEL — one load serves both no-think (budget 0) and with-think (budget N); budget is per-call', async () => {
	const log = { loads: [], budgets: [] };
	const host = createLocalModelHost({ loadModel: async function ( spec ) { log.loads.push(spec.modelPath); return {
		vramBytes: 1e9, async complete( req ) { log.budgets.push(req.reasoningBudget); return 'ok'; }, dispose() {} }; } });
	const base = { modelPath: '/m/A.gguf', system: 's', maxTokens: 8, temperature: 0, seed: 0, contextSize: 4096 };
	await host.ask(Object.assign({}, base, { reasoningBudget: 0, user: 'graph — no think' }));
	await host.ask(Object.assign({}, base, { reasoningBudget: 1024, user: 'answer — with think' }));
	assert.equal(host.stats.loads, 1, 'ONE VRAM load serves both budgets (the single-model, two-budgets case)');
	assert.deepEqual(log.budgets, [0, 1024], 'reasoningBudget flows PER-CALL, not baked into the load');
});

// distinct LOAD options (context size, gpu, gpuLayers, a custom llama.cpp build) change the VRAM footprint →
// distinct loads; identical options SHARE. This is what lets --ctx/--gpu/--gpu-layers/--no-prebuilt be honest.
test('SINGLE-MODEL — distinct load options → separate loads; identical options share one', async () => {
	const log = { loads: 0 };
	const host = createLocalModelHost({ loadModel: async function () { log.loads++; return { vramBytes: 1e9, async complete() { return 'ok'; }, dispose() {} }; } });
	const base = { modelPath: '/m/A.gguf', system: 's', user: 'u', maxTokens: 8, temperature: 0, seed: 0 };
	await host.ask(Object.assign({}, base, { contextSize: 4096 }));
	await host.ask(Object.assign({}, base, { contextSize: 8192 }));                                  // different ctx
	await host.ask(Object.assign({}, base, { contextSize: 4096, gpu: false }));                      // CPU
	await host.ask(Object.assign({}, base, { contextSize: 4096, model: { gpuLayers: 20 } }));        // loadModel opt
	await host.ask(Object.assign({}, base, { contextSize: 4096, llama: { usePrebuiltBinaries: false } })); // custom build
	await host.ask(Object.assign({}, base, { contextSize: 4096 }));                                  // == the first → SHARE
	assert.equal(host.stats.loads, 5, 'five distinct configs load once each; the repeat of the first shares (no 6th load)');
});
