/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * retention — a USAGE-TRACKING, self-EVICTING store wrapper (host-side, ZERO-CORE, fs-free). The RETENTION
 * axis of a concept's life-cycle, sibling of `lifecycle.js` (the PLASTICITY/consolidation axis): lifecycle
 * answers "is it reliable?" (proven → freeze); retention answers "is it USED?" (reused → keep, never used →
 * evict). The owner's compass (2026-07-05): a stock must EARN its keep — track per-entry reuse and REMOVE the
 * dead weight, so the local operational stock stays MINIMAL and converges. Wraps any Map-like store the
 * master-loop cache uses (`has`/`get`/`set`/`delete`); a served `get` on a present key counts a reuse.
 *
 * Two eviction rules (opt-in — with neither, the wrapper only MEASURES, never drops):
 *   • DEAD WEIGHT — an entry set but never re-served (`uses == 0`) past `evictGrace` operations is removed
 *     ("supprime ce qui n'est jamais utilisé"); a re-used entry (`uses > 0`) is NEVER dropped by this rule.
 *   • BOUNDED — beyond `maxStock` entries, evict the LEAST-RECENTLY-served (LRU) until back under the cap.
 *
 * The clock is a LOGICAL operation counter (deterministic, no wall-clock) → eviction + `usage()` replay
 * identically in a test. `usage()` is the compass readout: size, reused/dead split, per-entry reuse, the
 * running reuse rate, and the eviction tally (dead-weight vs LRU).
 *
 *   const store = createRetentionStore(new Map(), { maxStock: 500, evictGrace: 50 });
 *   const px = createProxyCache({ frontierAsk, store });   // the proxy's stock now self-manages
 *   store.usage();   // { size, reused, deadWeight, reuseRate, evicted:{deadWeight,lru}, byKey:[…] }
 *
 * @param inner  a Map-like store ({ has, get, set, delete }); default a fresh Map.
 * @param opts   { maxStock, evictGrace, autoEvict } — autoEvict (default true iff a rule is set) runs evict on set.
 */
function createRetentionStore( inner, opts ) {
	opts = opts || {};
	inner = inner || new Map();
	const meta = new Map();                  // key → { uses, addedAt, lastUsed }
	let clock = 0;
	const evicted = { count: 0, deadWeight: 0, lru: 0 };
	const hasRule = opts.maxStock != null || (opts.evictGrace != null && isFinite(opts.evictGrace));
	const autoEvict = opts.autoEvict != null ? opts.autoEvict : hasRule;

	function drop( k ) { meta.delete(k); return inner.delete(k); }

	function evict() {
		const out = [];
		if ( opts.evictGrace != null && isFinite(opts.evictGrace) ) {           // (a) dead weight — never re-served past the grace window
			for ( const [k, m] of meta ) if ( m.uses === 0 && (clock - m.addedAt) > opts.evictGrace ) { drop(k); out.push(k); evicted.deadWeight++; }
		}
		if ( opts.maxStock != null ) {                                          // (b) bounded — evict the LEAST VALUABLE
			while ( meta.size > opts.maxStock ) {                               // least-frequently-used first, then least-recently (keep what's reused)
				let victimK = null, vUses = Infinity, vLast = Infinity;
				for ( const [k, m] of meta ) if ( m.uses < vUses || (m.uses === vUses && m.lastUsed < vLast) ) { vUses = m.uses; vLast = m.lastUsed; victimK = k; }
				if ( victimK == null ) break;
				drop(victimK); out.push(victimK); evicted.lru++;
			}
		}
		evicted.count += out.length;
		return { evicted: out };
	}

	const store = {
		has( k ) { return inner.has(k); },                                     // a probe — NOT a reuse
		get( k ) { if ( inner.has(k) ) { const m = meta.get(k); if ( m ) { m.uses++; m.lastUsed = clock++; } } return inner.get(k); },   // a served get = a reuse
		set( k, v ) {
			if ( !meta.has(k) ) meta.set(k, { uses: 0, addedAt: clock, lastUsed: clock });
			clock++;
			inner.set(k, v);
			if ( autoEvict ) evict();
			return store;
		},
		delete( k ) { meta.delete(k); return inner.delete(k); },
		get size() { return meta.size; },

		/** run eviction on demand → { evicted:[keys] }. */
		evict,
		/** the compass readout — size, reuse split, running reuse rate, eviction tally, per-entry usage. */
		usage() {
			let reused = 0, dead = 0;
			const byKey = [];
			for ( const [k, m] of meta ) { if ( m.uses > 0 ) reused++; else dead++; byKey.push({ key: k, uses: m.uses, idle: clock - m.lastUsed, age: clock - m.addedAt }); }
			byKey.sort(( a, b ) => b.uses - a.uses );
			return { size: meta.size, reused, deadWeight: dead, reuseRate: meta.size ? reused / meta.size : 0, evicted: Object.assign({}, evicted), byKey };
		},
		/** the underlying meta (advanced hosts / debugging). */
		meta
	};
	return store;
}

module.exports = { createRetentionStore };
