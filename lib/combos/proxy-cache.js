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
	var signature = opts.signature || function ( q ) { return { structure: { q: keyOf(q) }, content: {} }; };   // exact-key = a sound cache
	var normAnswer = function ( r ) { return (r && typeof r === 'object' && r.answer !== undefined) ? r.answer : r; };

	// the FRONTIER forge — the ONLY generator (the local model never fabricates an answer). On a verify reject
	// it THROWS carrying the frontier answer, so answer() returns it to the user UNCACHED (no false neg, no
	// polluted stock) — the master loop would otherwise cache a forge result unconditionally.
	var forge = async function ( query, ctx ) {
		var ans = await opts.frontierAsk(query, ctx);
		if ( opts.verify ) {
			var ok = await opts.verify(query, normAnswer(ans));
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
			var r;
			try { r = await lib.solve(query); }
			catch ( e ) {
				if ( e && e.outcome === 'reject' ) return { answer: e.frontierAnswer, source: 'frontier', enriched: false, cached: false, arm: 'escalate', cost: e.calls != null ? e.calls : 1 };
				throw e;
			}
			// optional local coverage-confirm: a wrong/stale hit is invalidated + escalated (never served wrong).
			if ( isLocal(r.arm) && typeof opts.coverageCheck === 'function' ) {
				var fits = await opts.coverageCheck(query, normAnswer(r.result));
				if ( !fits ) {
					lib.drift(query);
					try { r = await lib.solve(query); }
					catch ( e ) { if ( e && e.outcome === 'reject' ) return { answer: e.frontierAnswer, source: 'frontier', enriched: false, cached: false, arm: 'escalate', cost: 1 }; throw e; }
				}
			}
			var local = isLocal(r.arm);
			return { answer: normAnswer(r.result), source: local ? 'local' : 'frontier', enriched: !local, cached: local, arm: r.arm, cost: r.cost };
		},

		/** a fact drifted → invalidate the stock entry (anti-drift): the next ask re-escalates. */
		drift: function ( query ) { return lib.drift(query); },

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

module.exports = { createProxyCache: createProxyCache };
