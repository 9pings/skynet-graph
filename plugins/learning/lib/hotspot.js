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
 * hotspot — the distill go/no-go DETECTOR (the §4.2-B / Proxy-KD plan-B pre-test). The cheap,
 * standing question that GATES the entire distilled-NN-concept build (which otherwise stays filed).
 *
 * Why a pre-test at all: the fidelity-gated cache (`cache.js`) ALREADY serves an exact-key hot
 * slice at 0 calls. So a parametric net buys NOTHING on an exactly-recurrent slice — it only
 * earns its place where the exact-key memo keeps MISSING yet the mapping is learnable. That is a
 * THREE-WAY condition, and proving/refuting it cheaply IS the deliverable:
 *   (1) FREQUENT          — enough volume to be worth distilling          (calls ≥ minCalls)
 *   (2) CACHE-MISSING     — many distinct-but-related keys the exact-key  (hitRate ≤ maxHitRate
 *                           memo can't cover (high cardinality)            ⇔ high key cardinality)
 *   (3) K1-SUFFICIENT     — the typed surface predicts the verdict; if    (fidMean ≥ minFidelity)
 *                           even the repeated keys don't reproduce, the
 *                           LLM reads something off-surface → unlearnable
 * Only all-three ⇒ `distill-candidate` (a Phase-1 generalization measurement then confirms it).
 * The honest, expected outcome on today's workloads is NO qualifying slice ⇒ the net stays filed —
 * proven cheaply rather than on faith.
 *
 *   const t = trackCache();
 *   const cache = createProviderCache({ ..., onHit: t.onHit, onMiss: t.onMiss, fidelity: {...} });
 *   // ...run the workload through the cache...
 *   const report = hotspots(t, cache.fid, { minCalls: 20, maxHitRate: 0.5, minFidelity: 0.8 });
 */

/**
 * A per-concept tally you wire into a provider cache's `onHit`/`onMiss`. `onHit` = a served
 * cache hit (0 model calls); `onMiss` = a cold (uncached) derivation (a model call). Each
 * distinct key cold-misses exactly once (its first sight, before it is stored), so the cold-miss
 * key set is the cardinality estimate; the served hits are the amortization.
 */
function trackCache() {
	const perConcept = {};   // name -> { hits, misses, hitKeys:Set, missKeys:Set }
	function slot( concept ) {
		const n = (concept && concept._name) || String(concept);
		return perConcept[n] || (perConcept[n] = { hits: 0, misses: 0, hitKeys: new Set(), missKeys: new Set() });
	}
	return {
		perConcept,
		onHit:  function ( key, concept ) { const s = slot(concept); s.hits++;   if ( key != null ) s.hitKeys.add(key); },
		onMiss: function ( key, concept ) { const s = slot(concept); s.misses++; if ( key != null ) s.missKeys.add(key); },
		reset:  function () { for ( const k of Object.keys(perConcept) ) delete perConcept[k]; },
	};
}

// the mean exact-key reproduce rate over a concept's fidStore entries (the keys it actually
// touched). null when no key has fidelity data yet (e.g. a pure-singleton high-cardinality
// slice — repeats are what populate `fid`, so K1-sufficiency is then UNCONFIRMED, not refuted).
function fidelityFor( keys, fidStore ) {
	if ( !fidStore || !keys || !keys.size ) return { mean: null, n: 0 };
	let sum = 0, n = 0;
	for ( const k of keys ) {
		const fs = fidStore.get(k);
		if ( fs && fs.total > 0 ) { sum += fs.ok / fs.total; n++; }
	}
	return { mean: n ? sum / n : null, n: n };
}

/**
 * Classify every tracked concept into the four buckets. Pure (no boot, no model calls).
 * @param tracker   a `trackCache()` collector (or `{ perConcept }`)
 * @param fidStore  the cache's `fid` Map (key -> { ok, total }); omit → fidelity unconfirmed
 * @param opts.minCalls     volume floor (default 20)
 * @param opts.maxHitRate   above this the exact-key cache already wins (default 0.5)
 * @param opts.minFidelity  K1-sufficiency threshold on the reproduce rate (default 0.8)
 * @returns [{ concept, calls, hits, misses, distinctKeys, hitRate, keyCardinality, fidMean, fidN, verdict, reason }]
 *          sorted distill-candidates first, then by volume. verdict ∈
 *          { 'distill-candidate', 'cache-already-wins', 'unlearnable', 'too-rare' }.
 */
function hotspots( tracker, fidStore, opts ) {
	opts = opts || {};
	const minCalls    = opts.minCalls    != null ? opts.minCalls    : 20;
	const maxHitRate  = opts.maxHitRate  != null ? opts.maxHitRate  : 0.5;
	const minFidelity = opts.minFidelity != null ? opts.minFidelity : 0.8;
	const per = (tracker && tracker.perConcept) || tracker || {};

	const rows = Object.keys(per).map(function ( name ) {
		const s = per[name];
		const hits = s.hits || 0, misses = s.misses || 0;
		const calls = hits + misses;                                  // served + cold (verify/escalate uncounted — a floor)
		const keys = new Set([...(s.missKeys || []), ...(s.hitKeys || [])]);
		const distinctKeys = keys.size;
		const hitRate = calls ? hits / calls : 0;
		const keyCardinality = calls ? distinctKeys / calls : 0;       // ~1 = every call a new key (cache can't cover)
		const fid = fidelityFor(keys, fidStore);

		let verdict, reason;
		if ( calls < minCalls ) {
			verdict = 'too-rare'; reason = 'calls ' + calls + ' < minCalls ' + minCalls;
		} else if ( hitRate > maxHitRate ) {
			verdict = 'cache-already-wins'; reason = 'hitRate ' + hitRate.toFixed(2) + ' > ' + maxHitRate + ' — the exact-key memo already serves it';
		} else if ( fid.mean != null && fid.mean < minFidelity ) {
			verdict = 'unlearnable'; reason = 'fidMean ' + fid.mean.toFixed(2) + ' < ' + minFidelity + ' — the verdict is not a function of the typed key';
		} else {
			verdict = 'distill-candidate';
			reason = fid.mean != null
				? 'frequent ∧ cache-missing ∧ K1-sufficient (fidMean ' + fid.mean.toFixed(2) + ') — Phase-1 generalization check next'
				: 'frequent ∧ cache-missing; fidelity UNCONFIRMED (no repeats yet) — Phase-1 must confirm K1-sufficiency';
		}
		return {
			concept: name, calls: calls, hits: hits, misses: misses, distinctKeys: distinctKeys,
			hitRate: hitRate, keyCardinality: keyCardinality, fidMean: fid.mean, fidN: fid.n,
			verdict: verdict, reason: reason,
		};
	});

	const rank = { 'distill-candidate': 0, 'unlearnable': 1, 'cache-already-wins': 2, 'too-rare': 3 };
	rows.sort(function ( a, b ) { return (rank[a.verdict] - rank[b.verdict]) || (b.calls - a.calls); });
	return rows;
}

// convenience: are there any distill-candidates? (the go/no-go boolean).
function anyCandidate( rows ) { return (rows || []).some(function ( r ) { return r.verdict === 'distill-candidate'; }); }

module.exports = { trackCache: trackCache, hotspots: hotspots, fidelityFor: fidelityFor, anyCandidate: anyCandidate };
