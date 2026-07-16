/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * DERIVATION CACHE — an ADDITIVE, opt-in way to use the engine that benefits from the rest (it changes
 * NOTHING in the core or in any grammar). It is a content-addressed memo over a PROVIDER: a provider's
 * mutation template is keyed on the CANONICAL JUSTIFICATION of the cast, so a retract→re-derive cycle
 * (finding #22 re-RUNS the provider — a fresh, expensive LLM call) becomes a hash lookup, and the SAME
 * typed sub-problem flowing through the SAME method (a second instance) replays instead of re-calling.
 *
 * Soundness (study `doc/WIP/studies/2026-06-27-method-instance-workflow-cache-control.md` §2): a cached
 * template stored under `(C, d)` may be REPLAYED iff `digest(canonical-justification) = d`; the fixpoint is
 * then identical on all TRACKED facts (prose is untracked, no gate reads it). The cache's trust surface ⊆
 * the engine's EXISTING incrementality contract (the skip-on-already-cast of #22 already assumes tracked
 * facts are a stable function of the justification), so it adds ZERO new unsoundness. It is the "good" dual
 * of the nogood cache (`learn-nogood.js`), and the fast/episodic half of CLS whose slow half is
 * `crystallize.js` — a hot key auto-nominates its chain for crystallization (wire `stats`/`onHot`).
 *
 * Discipline (the blocking points the study flags):
 *  - the KEY must capture everything the provider READS. Only the provider knows that, so the key fn is
 *    supplied per provider (default = the concept's memo-surface projection, sound when the provider reads
 *    only its gate facts). A cross-object provider (reads endpoint states, etc.) supplies a key fn that
 *    digests those reads — see `keyFromScope`.
 *  - a key fn returning `null` (a `CanonMiss`, an unkeyable/exploratory cast) BYPASSES the cache (fail-open
 *    to a fresh call — never a wrong replay).
 *  - the key is namespaced by concept name + an optional method/lib VERSION token (B8): a method edit must
 *    not serve a stale template to a new-version instance. Pass `version()` (e.g. a concept-lib digest).
 */
const { digest } = require('./canonicalize.js');

function clone( x ) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

/**
 * @param opts.store    a Map-like (has/get/set/delete/size) — default a bounded in-memory LRU-ish Map
 * @param opts.max      max entries before oldest-eviction (default 5000)
 * @param opts.version  () => string — a method/concept-lib version token folded into every key (B8)
 * @param opts.onHit    (key, concept) => void   (e.g. bump a crystallization counter)
 * @param opts.onMiss   (key, concept) => void   — a cold (uncached) derivation; symmetric to onHit (hot-spot tally)
 * @param opts.canonMiss (tpl, concept) => bool  — treat a result as un-cacheable (default: a `<name>CanonMiss` flag)
 */
function createProviderCache( opts ) {
	opts = opts || {};
	const store = opts.store || new Map();
	const max = opts.max || 5000;
	const version = opts.version || (() => '');
	const canonMiss = opts.canonMiss || defaultCanonMiss;
	// FIDELITY-GATED REPLAY (opt-in; default = exact-key hit/miss, regression-clean). Per-key the cache learns how
	// reliably the canonical key predicts the provider's verdict: a few WARMUP hits are VERIFIED (re-derive + compare
	// to the cached template) to build a reproduce-rate; thereafter a high-rate key REPLAYS (0 calls) but a low-rate
	// key — a LOSSY canonicalization that drops a decision-relevant fact — ESCALATES (always re-derives, never serves
	// a stale entry). This is the continuous form of the K1 cliff (the "cost gradient, not cliff" / micro-task floor),
	// borrowed from Proxy-KD's per-sample fidelity weight w(x,y) (arXiv:2401.07013 v2, principle 4 of the 2026-06-28 study).
	//   opts.fidelity = { threshold=0.8, warmup=3, equals?(a,b) }   (omit → fidelity gating OFF)
	const fidelity = opts.fidelity || null;
	const fidThreshold = fidelity && fidelity.threshold != null ? fidelity.threshold : 0.8;
	const fidWarmup = fidelity && fidelity.warmup != null ? fidelity.warmup : 3;
	const tplEquals = ( fidelity && fidelity.equals ) || (( a, b ) => digest(a) === digest(b));
	const fidStore = new Map();   // key -> { ok, total }
	// SINGLE-FLIGHT (in-flight dedup) — default ON, opt-out via opts.singleflight === false. The engine casts
	// unstable objects as a CONCURRENT pool (taskflow async pool in `lib/graph/tasks/`), so N same-key derivations
	// can be in flight at once. The cache only `set`s AFTER a provider resolves, so without coalescing each of the
	// N fires the provider (a race → redundant work, NO amortization; correctness is unaffected — same key, same
	// answer). Coalescing concurrent same-key misses onto ONE provider run makes amortization robust to the
	// engine's native concurrency, not just to a serialized/streaming execution model. (Transparent to SYNC
	// providers: the first call resolves + stores before the second starts, so there is never an in-flight window.)
	const singleflight = opts.singleflight !== false;
	const inflight = new Map();    // key -> [ wake-thunk ]   (waiters re-run the lookup once the originator resolves)
	const stats = { hits: 0, misses: 0, bypass: 0, stores: 0, calls: 0, verified: 0, escalated: 0, coalesced: 0 };

	function fullKey( concept, sub ) { return concept._name + '' + version() + '' + sub; }

	function evict() { if ( store.size > max ) { const k = store.keys().next().value; store.delete(k); } }

	/**
	 * Wrap a provider fn `(graph, concept, scope, argz, cb)` with content-addressed caching.
	 * @param fn     the provider to memoize
	 * @param keyFn  (graph, concept, scope, argz) => canonical-input (object|string) | null
	 *               returns null to BYPASS (CanonMiss / exploratory / unkeyable). Default = memo-surface.
	 * @param transform optional `{ onStore(tpl, info), onReplay(tpl, info) }` — a GENERIC store/replay
	 *               rewrite (info = {graph,concept,scope,argz}). The cache itself stays grammar-agnostic;
	 *               the F6 abstractivation (`authoring/core/abstract.js#methodTransform`) supplies these to
	 *               PARAMETERIZE a structural template on store and BIND it to the new call site on replay,
	 *               so a structural decision transfers across related-but-different problems (finding #30).
	 *               onStore returning null = DON'T store (not transfer-safe); onReplay returning null =
	 *               BYPASS to a fresh call (a frontier ref couldn't be re-bound) — never a wrong replay.
	 */
	function wrap( fn, keyFn, transform ) {
		keyFn = keyFn || defaultKeyFn;
		const onStore = transform && transform.onStore, onReplay = transform && transform.onReplay;
		const wrapped = function ( graph, concept, scope, argz, cb ) {
			stats.calls++;
			// an explicitly-exploratory cast (wants a fresh draw) bypasses.
			if ( scope && scope._ && scope._.explore ) { stats.bypass++; return fn(graph, concept, scope, argz, cb); }
			let sub;
			try { sub = keyFn(graph, concept, scope, argz); } catch ( e ) { sub = null; }
			if ( sub == null ) { stats.bypass++; return fn(graph, concept, scope, argz, cb); }
			const key = fullKey(concept, typeof sub === 'string' ? sub : digest(sub));
			const info = { graph: graph, concept: concept, scope: scope, argz: argz };
			if ( store.has(key) ) {
				let hit = clone(store.get(key));
				if ( onReplay ) { hit = onReplay(hit, info); if ( hit == null ) { stats.bypass++; return fn(graph, concept, scope, argz, cb); } }
				if ( fidelity ) {
					const fs = fidStore.get(key) || { ok: 0, total: 0 };
					const established = fs.total >= fidWarmup;
					const rate = fs.total ? fs.ok / fs.total : 1;
					if ( established && rate < fidThreshold ) {                 // LOSSY key → escalate (never serve stale)
						stats.escalated++; return fn(graph, concept, scope, argz, cb);
					}
					if ( !established ) {                                      // WARMUP/VERIFY → re-derive, compare, serve fresh
						stats.verified++;
						return fn(graph, concept, scope, argz, function ( err, tpl ) {
							if ( !err && tpl != null ) { fs.total++; if ( tplEquals(tpl, store.get(key)) ) fs.ok++; fidStore.set(key, fs); }
							cb(err, tpl);
						});
					}
				}
				stats.hits++; opts.onHit && opts.onHit(key, concept); return cb(null, hit);
			}
			// SINGLE-FLIGHT: coalesce concurrent same-key MISSES onto ONE provider run. A waiter re-runs the
			// lookup once the originator resolves — a cacheable result → it then HITS the store/replay (with its
			// OWN onReplay+fidelity, so a transform-wrap waiter still rebinds to its call site); an uncacheable
			// CanonMiss (not stored) → it re-derives, exactly as without single-flight (no new unsoundness).
			if ( singleflight ) {
				if ( inflight.has(key) ) { stats.coalesced++; inflight.get(key).push(function () { wrapped(graph, concept, scope, argz, cb); }); return; }
				inflight.set(key, []);
			}
			stats.misses++;
			opts.onMiss && opts.onMiss(key, concept);   // symmetric to onHit: a cold (uncached) derivation — the per-concept hot-spot tally reads this + onHit + `fid`
			fn(graph, concept, scope, argz, function ( err, tpl ) {
				if ( !err && tpl != null && !canonMiss(tpl, concept) ) {
					let toStore = tpl;
					if ( onStore ) toStore = onStore(tpl, info);   // null = not transfer-safe → skip storing
					if ( toStore != null ) { store.set(key, clone(toStore)); stats.stores++; evict(); }
				}
				cb(err, tpl);                                       // the COLD call returns its own ground template, unperturbed
				if ( singleflight ) {
					const waiters = inflight.get(key) || [];
					inflight.delete(key);
					for ( let i = 0 ; i < waiters.length ; i++ ) waiters[i]();   // wake waiters: each re-runs the lookup
				}
			});
		};
		return wrapped;
	}

	/**
	 * Wrap a whole provider FRAGMENT `{Ns: {fn,...}}` — apply a per-fn key map (or the default to all).
	 * @param fragment  { Ns: { fn: providerFn } }
	 * @param keyMap    { "Ns::fn": keyFn }     (a fn absent from the map uses the default memo-surface key)
	 * @param transformMap { "Ns::fn": {onStore,onReplay} }  (optional per-fn store/replay transform; see `wrap`)
	 */
	function wrapFragment( fragment, keyMap, transformMap ) {
		keyMap = keyMap || {}; transformMap = transformMap || {};
		const out = {};
		for ( const ns in fragment ) {
			out[ns] = {};
			for ( const fn in fragment[ns] ) {
				const k = keyMap[ns + '::' + fn];
				out[ns][fn] = (k === false) ? fragment[ns][fn] : wrap(fragment[ns][fn], k || undefined, transformMap[ns + '::' + fn]);
			}
		}
		return out;
	}

	// default key: the concept's MEMO SURFACE projected off the cast object (sound when the provider reads
	// only its own gate facts). Falls back to bypass if the surface is empty/unknowable.
	function defaultKeyFn( graph, concept, scope ) {
		let keys = [];
		try { keys = require('../authoring/core/memo-stability.js').memoSurfaceKeys(graph, concept._name) || []; } catch ( e ) { keys = []; }
		const flat = keys.filter(( k ) => k.indexOf(':') < 0);   // skip cross-object walks (the provider may read further — bypass unless a custom key is given)
		if ( !flat.length || flat.length !== keys.length ) return null;
		const f = scope._, proj = {};
		for ( const k of flat ) proj[k] = f[k];
		return proj;
	}

	return { wrap, wrapFragment, stats, store, clear: () => store.clear(), size: () => store.size, key: fullKey, fid: fidStore };
}

// a result is un-cacheable if it carries a CanonMiss signal (the K1 fail-closed marker).
function defaultCanonMiss( tpl, concept ) {
	const arr = Array.isArray(tpl) ? tpl : [tpl];
	return arr.some(( t ) => t && typeof t === 'object' && Object.keys(t).some(( k ) => /CanonMiss$/.test(k) && t[k]));
}

/**
 * Build a key fn that digests a SCOPE projection (the facts the provider reads on the cast object),
 * optionally following cross-object refs the provider consumes. Use this for a cross-object provider.
 * @param spec.facts  string[] of fact keys read off the cast object (scope._)
 * @param spec.refs   { name: "ref:path" } resolved via scope.getRef (e.g. endpoint states)
 *                    — returns null (bypass) if any required ref is unresolved.
 * @param spec.require optional: keys/refs that MUST be present (else bypass)
 */
function keyFromScope( spec ) {
	spec = spec || {};
	const facts = spec.facts || [], refs = spec.refs || {}, req = spec.require || [];
	return function ( graph, concept, scope ) {
		const f = scope._, key = {};
		for ( const k of facts ) key[k] = f[k];
		for ( const name in refs ) {
			let v;
			try { v = scope.getRef ? scope.getRef(refs[name]) : undefined; } catch ( e ) { v = undefined; }
			key[name] = (v && v._ !== undefined) ? v._ : v;   // an entity-ref → its facts; a value-ref → the value
		}
		for ( const r of req ) if ( key[r] === undefined || key[r] === null ) return null;   // missing input → bypass
		// Return a STABLE STRING (not the object): a ref can resolve to an OBJECT (entity facts or a whole
		// bagRef record), and `digest` uses the TOP-LEVEL keys as a JSON.stringify allowlist — it would strip
		// nested fields, collapsing every record to the same key (a false hit). stableStringify is recursive +
		// key-sorted, so a different record snapshot yields a different key (C1/B2). wrap() uses a string sub as-is.
		return stableStringify(key);
	};
}

// deterministic, key-sorted, fully-recursive stringify (digest-safe for nested refs).
function stableStringify( x ) {
	if ( x === undefined ) return 'null';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(stableStringify).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + stableStringify(x[k])).join(',') + '}';
}

module.exports = { createProviderCache, keyFromScope, defaultCanonMiss, stableStringify };
