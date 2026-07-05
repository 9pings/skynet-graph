/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * C6 — the LOCAL-FIRST PROXY CACHE / DISTILLER (the owner's main use case, 2026-07-05). A cache-distiller in
 * front of a FRONTIER model: a query is served from a minimal LOCAL operational stock when it is COVERED, and
 * escalated to the frontier when it is not — enriching the stock in passing. Anti-drift + hallucination-null:
 *   • the local side NEVER fabricates an answer from its own weights — it serves only VERIFIED stock (distilled
 *     from the frontier = trusted) or ESCALATES → 0 hallucination;
 *   • a miss escalates to the frontier (no false negative — the user always gets an answer);
 *   • an optional local COVERAGE-CONFIRM (opts.coverageCheck) lets the local model reject a WRONG hit before
 *     it is served (a stale/ill-fitting cache entry → invalidate + escalate, never serve a wrong answer);
 *   • anti-drift: `drift(query)` invalidates the stock entry so the next ask re-escalates;
 *   • `.sgc` ON DEMAND: `pack()`/`load()` ship the minimal operational stock; the store is a bounded local file.
 *
 * THIN assembly over `createLearningLibrary` (the doctrine — no new logic): the always-on cost ladder already
 * IS "MATCH/RETRIEVE (local, 0 cost) → FORGE/ESCALATE (the expensive path)". Here the expensive path is the
 * FRONTIER model, and the cached result is the distilled answer — so `solve` = local-first-then-escalate.
 *
 * @param opts.frontierAsk  REQUIRED async (query, ctx) => answer (string | {answer,…}) — the ground-truth escalation.
 * @param opts.keyOf        (query) => string cache key (default: the string query, or `digest` of an object).
 * @param opts.signature    (query) => {structure,content} — the coverage class (default: EXACT-key = a sound
 *                          cache). A TYPED signature makes one frontier answer cover a CLASS (opt-in distillation).
 * @param opts.coverageCheck optional async (query, cachedAnswer) => bool — the local model confirms a hit fits;
 *                          a `false` invalidates the entry and escalates (the "does my stock answer this?" gate).
 * @param opts.verify       optional async (query, frontierAnswer) => bool — gate the DISTILLATION: a `false`
 *                          returns the frontier answer to the user but does NOT pollute the stock (no false neg).
 * @param opts.store        a file PATH (durable, cross-restart) or a Map-like (default in-memory, minimal/local).
 * @param opts.*            the §4 product knobs via resolveComboDefaults (fail-closed, durable memo, …).
 * @returns {{ answer, drift, pack, load, stats, library }}
 */

var learning = require('./learning-library.js');
var canon = require('../providers/canonicalize.js');
var storeMod = require('../authoring/store.js');
var retention = require('../authoring/retention.js');

function createProxyCache( opts ) {
	opts = opts || {};
	if ( typeof opts.frontierAsk !== 'function' ) throw new Error('createProxyCache needs opts.frontierAsk (async (query) -> answer) — the ground-truth escalation');
	var keyOf = opts.keyOf || function ( q ) { return typeof q === 'string' ? q : canon.digest(q); };
	var normAnswer = function ( r ) { return (r && typeof r === 'object' && r.answer !== undefined) ? r.answer : r; };

	// SEMANTIC COVERAGE (opt-in): the local model maps a query → a stable canonical KEY, so PARAPHRASES snap to
	// the same key and HIT the stock (a coverage far above exact-repeat). `signature` is sync (the master loop
	// calls it inline), so the async key is computed in answer() and carried on a wrapped problem {__q,__k}.
	var semanticKey = (typeof opts.semanticKey === 'function') ? opts.semanticKey : null;
	var wrapped = function ( p ) { return !!(p && typeof p === 'object' && p.__proxy === true); };
	var qOf = function ( p ) { return wrapped(p) ? p.__q : p; };                                   // the original query (→ the frontier)
	var kOf = function ( p ) { return wrapped(p) ? p.__k : keyOf(p); };                            // the dispatch key (exact or semantic)
	var signature = opts.signature || function ( p ) { return { structure: { q: kOf(p) }, content: {} }; };   // exact/semantic-key = a sound cache

	// the FRONTIER forge — the ONLY generator (the local model never fabricates an answer). On a verify reject
	// it THROWS carrying the frontier answer, so answer() returns it to the user UNCACHED (no false neg, no
	// polluted stock) — the master loop would otherwise cache a forge result unconditionally.
	var forge = async function ( problem, ctx ) {
		var ans = await opts.frontierAsk(qOf(problem), ctx);
		if ( opts.verify ) {
			var ok = await opts.verify(qOf(problem), normAnswer(ans));
			if ( !ok ) { var e = new Error('distillation rejected by verify'); e.outcome = 'reject'; e.frontierAnswer = normAnswer(ans); throw e; }
		}
		return { result: (ans && typeof ans === 'object' && ans.answer !== undefined) ? ans : { answer: ans }, cost: 1 };
	};

	// the local operational stock — optionally a self-managing RETENTION store (usage-tracked + auto-evicting):
	// the owner's compass "supprime ce qui n'est jamais utilisé" + a MINIMAL bounded stock. Opt-in via
	// maxStock/evictGrace; absent ⇒ a plain store (measures nothing, evicts nothing).
	var inner = (typeof opts.store === 'string') ? storeMod.createFileStore(opts.store) : (opts.store || new Map());
	var retentionOn = opts.maxStock != null || opts.evictGrace != null || opts.retention === true;
	var stock = retentionOn ? retention.createRetentionStore(inner, { maxStock: opts.maxStock, evictGrace: opts.evictGrace }) : inner;

	var lib = learning.createLearningLibrary(Object.assign({}, opts, { forge: forge, signature: signature, store: stock }));
	var isLocal = function ( arm ) { return arm === 'match' || arm === 'recall-full' || arm === 'recall-partial'; };

	return {
		library: lib,

		/** answer a query — served LOCAL when covered (0 frontier call), else ESCALATED to the frontier and the
		 *  stock enriched in passing. Never fabricates locally (0 hallucination); a miss escalates (no false neg). */
		answer: async function ( query ) {
			// SEMANTIC key: the local model canonicalizes the query → paraphrases snap to one key (a cheap local
			// call to save an expensive frontier call). Carried on a wrapped problem so the frontier still sees
			// the ORIGINAL query. A key failure degrades safely to exact-key (never blocks the answer).
			var problem = query;
			if ( semanticKey ) {
				try { var k = await semanticKey(query); if ( k != null && String(k).length ) problem = { __proxy: true, __q: query, __k: String(k) }; }
				catch ( e ) { problem = query; }
			}
			var r;
			try { r = await lib.solve(problem); }
			catch ( e ) {
				if ( e && e.outcome === 'reject' ) return { answer: e.frontierAnswer, source: 'frontier', enriched: false, cached: false, arm: 'escalate', cost: e.calls != null ? e.calls : 1 };
				throw e;
			}
			// optional local coverage-confirm: a wrong/stale hit is invalidated + escalated (never served wrong).
			if ( isLocal(r.arm) && typeof opts.coverageCheck === 'function' ) {
				var fits = await opts.coverageCheck(qOf(problem), normAnswer(r.result));
				if ( !fits ) {
					lib.drift(problem);
					try { r = await lib.solve(problem); }
					catch ( e ) { if ( e && e.outcome === 'reject' ) return { answer: e.frontierAnswer, source: 'frontier', enriched: false, cached: false, arm: 'escalate', cost: 1 }; throw e; }
				}
			}
			var local = isLocal(r.arm);
			return { answer: normAnswer(r.result), source: local ? 'local' : 'frontier', enriched: !local, cached: local, arm: r.arm, cost: r.cost };
		},

		/** a fact drifted → invalidate the stock entry (anti-drift): the next ask re-escalates. Async because a
		 *  semantic key must be recomputed to hit the same entry. */
		drift: async function ( query ) {
			if ( semanticKey ) { try { var k = await semanticKey(query); if ( k != null && String(k).length ) return lib.drift({ __proxy: true, __q: query, __k: String(k) }); } catch ( e ) {} }
			return lib.drift(query);
		},

		/** ship / reload the minimal operational stock as a portable `.sgc` (on demand). */
		pack: function ( o ) { return lib.pack(o); },
		load: function ( b, o ) { return lib.load(b, o); },

		/** the ladder counters {match, recallFull, recallPartial, forge, escalate, cost, calls}. */
		stats: function () { return lib.stats(); },

		/** THE COMPASS — convergence + lifecycle readout. Ladder coverage (queries served local vs escalated)
		 *  + the RETENTION stock (size, reuse rate, dead weight, eviction tally). Drives "does it stabilize, at
		 *  what level, and does it drop what's never used". */
		metrics: function () {
			var s = lib.stats() || {};
			var local = (s.match || 0) + (s.recallFull || 0) + (s.recallPartial || 0);
			var frontier = (s.forge || 0) + (s.escalate || 0);
			var served = local + frontier;
			var u = (stock && typeof stock.usage === 'function') ? stock.usage() : null;
			return {
				served: served, local: local, frontier: frontier,
				coverage: served ? local / served : 0,             // cache coverage = queries served locally
				stock: u ? { size: u.size, reused: u.reused, deadWeight: u.deadWeight, reuseRate: u.reuseRate, evicted: u.evicted } : { size: (stock && stock.size) || null }
			};
		},

		/** run stock eviction on demand → { evicted:[keys] } (no-op without a retention store). */
		evict: function () { return (stock && typeof stock.evict === 'function') ? stock.evict() : { evicted: [] }; },
		/** the retention usage readout, or null (no retention store). */
		usage: function () { return (stock && typeof stock.usage === 'function') ? stock.usage() : null; }
	};
}

/**
 * The FRONTIER adapter (à nu). `createProxyCache` wants `frontierAsk(query, ctx) -> answer`; a chat backend
 * (`makeLocalAsk`, an HTTP endpoint, an API SDK) speaks `({system,user,maxTokens,temperature}) -> text`. This
 * turns the latter into the former with a neutral answer-directly system prompt — symmetric to
 * `makeLocalCoverage`, so a host wires real models with two one-liners:
 *   const frontierAsk = makeFrontierAsk(makeLocalAsk({ modelPath: BIG_GGUF, reasoningBudget: 0 }));
 *   const { semanticKey, coverageCheck } = makeLocalCoverage({ localAsk: makeLocalAsk({ modelPath: SMALL_GGUF }) });
 *   const px = createProxyCache({ frontierAsk, semanticKey, coverageCheck, store: './.sg-proxy.json' });
 * @param ask         async ({system,user,maxTokens,temperature}) => text — the chat backend (the ground truth).
 * @param opts.system override the answer-directly system prompt (a domain host tightens it).
 * @param opts.maxTokens  answer budget (default 512).
 */
function makeFrontierAsk( ask, opts ) {
	opts = opts || {};
	if ( typeof ask !== 'function' ) throw new Error('makeFrontierAsk needs a chat ask (async ({system,user}) -> text)');
	var system = opts.system || 'You are a precise, factual assistant. Answer the question directly and correctly. If you are not sure, say so.';
	var maxTokens = opts.maxTokens || 512;
	return async function frontierAsk( query /*, ctx */ ) {
		return await ask({ system: system, user: String(query), maxTokens: maxTokens, temperature: opts.temperature || 0 });
	};
}

/**
 * A ready-made SEMANTIC coverage pair from a local model: `semanticKey` (canonicalize a query → a short stable
 * normal form so paraphrases collide onto ONE cache key) + `coverageCheck` (confirm a stocked answer fits the
 * query). Both are CHEAP local calls that save an expensive frontier call — the local model's "do I cover
 * this?" judge. Pass the pair into createProxyCache.
 *
 * The default `semanticKey` prompt is the KEYWORD-SLOT form (subject + attribute, question-words dropped) — a
 * LIVE probe (2026-07-05, Qwen3-8B-Q4) measured it at 4/6 paraphrase collisions vs 0/6 for a loose
 * "canonical normal form" prompt: a small model keeps a variable amount of the question stem, so the strict
 * slot form is what forces string-identity. The residual misses are SYNONYMS (point↔temperature, ww2↔WWII) —
 * a lattice/synonym-ring concern, not canonicalization. A domain host tightens further via `opts.keyPrompt`.
 * @param opts.localAsk   async ({system,user,maxTokens}) => text — the small local model.
 * @param opts.keyPrompt  override the canonicalization system prompt (default: the keyword-slot form).
 * @param opts.fitPrompt  override the coverage-confirm system prompt (default: a strict yes/no fit check).
 */
function makeLocalCoverage( opts ) {
	opts = opts || {};
	var ask = opts.localAsk;
	if ( typeof ask !== 'function' ) throw new Error('makeLocalCoverage needs opts.localAsk (async ({system,user}) -> text)');
	var norm = function ( s ) { return String(s).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim(); };
	var keyPrompt = opts.keyPrompt || 'Reduce the question to its ESSENTIAL keywords ONLY: the main subject then the attribute asked about, as 2 to 4 lowercase words. DROP all question words (what/who/when/how/which/is/are/does) and articles. Examples: "What is the capital of France?" -> "france capital". "Who wrote Hamlet?" -> "hamlet author". "How tall is K2?" -> "k2 height". Reply ONLY the keywords.';
	var fitPrompt = opts.fitPrompt || 'Does the ANSWER correctly and fully answer the QUESTION? Reply ONLY "yes" or "no".';
	return {
		semanticKey: async function ( query ) {
			var t = await ask({ system: keyPrompt, user: String(query), maxTokens: 24 });
			return norm(t) || norm(query);
		},
		coverageCheck: async function ( query, cachedAnswer ) {
			var t = await ask({ system: fitPrompt, user: 'QUESTION: ' + String(query) + '\nANSWER: ' + String(cachedAnswer), maxTokens: 4 });
			return /\byes\b/i.test(String(t));
		}
	};
}

module.exports = { createProxyCache: createProxyCache, makeLocalCoverage: makeLocalCoverage, makeFrontierAsk: makeFrontierAsk };
