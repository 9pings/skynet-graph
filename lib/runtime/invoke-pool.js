/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * invoke-pool — THE SHARED INSTANCE KEYED BY CONTRACT (roadmap 2026-07-09 P3; the scale point). P2 delegates via the
 * P1 invoke, but `invokeGraph` SPAWNS + TEARS DOWN a worker per cast (the proven fil). P3 keeps workers WARM in a pool
 * keyed by `libraryKey`/contract, so **N cases → 1 instance** (never one sub-graph per concept-method instance) — the
 * conceptMap + providers (+ a load-once model, via local-host, on the worker) are paid ONCE, reused across invokes.
 *
 * STATELESS-PER-INVOKE (the guardrail that keeps the constat): the warm worker is only warm in its CONFIG — each
 * `invoke` builds a FRESH graph from its seed (`Graph.fromDirs({seed})` in protocol.js#invoke) and stabilizes it
 * independently, so a reused worker carries NO cross-invoke graph state. Reuse buys the load cost, not shared mutable
 * state; determinism per invoke is unchanged. The pool is ZERO-CORE host orchestration over `createGraphWorker`.
 *
 *   const pool = createInvokePool();
 *   const r = await pool.invoke('methodKey', { conceptMap, providers, seed, boundedFrom, boundedKeys });
 *   // ... N more invokes of 'methodKey' reuse the SAME warm worker (pool.size() === 1) ...
 *   await pool.close();
 */
/**
 * createInvokePool(opts) — a warm-worker pool keyed by contract.
 * @param opts.workerDefaults  base createGraphWorker opts merged under every keyed worker (logger, conf, …).
 * @param opts.max             optional soft cap on distinct warm instances (LRU-evict the least-recently-used).
 * @returns { invoke(key, iopts), has(key), keys(), size(), stats(), evict(key), close() }
 */
function createInvokePool( opts ) {
	opts = opts || {};
	const workers = new Map();                                         // key -> { worker, uses, last }
	let tick = 0;

	// the method CONFIG the key's worker is built from (conceptMap/providers) — stored so P5 `refine` can swap the BODY
	// behind the fixed key without the caller re-supplying it.
	const configOf = ( iopts ) => ({ conceptMap: iopts.conceptMap, concepts: iopts.concepts, providers: iopts.providers,
		geo: iopts.geo, llm: iopts.llm, ask: iopts.ask, conf: iopts.conf, logger: iopts.logger || opts.logger });

	function keyWorker( key, iopts ) {
		let e = workers.get(key);
		if ( !e ) { e = { worker: null, uses: 0, config: configOf(iopts) }; workers.set(key, e); }   // first use registers the config
		if ( !e.worker ) {                                                     // create (first use) or RE-create (post-refine, body swapped)
			const createGraphWorker = require('./index.js').createGraphWorker; // lazy — avoids the load-order circular
			e.worker = createGraphWorker(Object.assign({}, opts.workerDefaults, e.config));   // the STORED config (refine wins over iopts)
			e.last = ++tick;                                                  // stamp BEFORE the cap check so a fresh worker isn't its own LRU victim
			if ( opts.max && liveCount() > opts.max ) evictLRU(key);
		}
		e.uses++; e.last = ++tick;
		return e.worker;
	}
	const liveCount = () => { let n = 0; for ( const e of workers.values() ) if ( e.worker ) n++; return n; };
	function evictLRU( keep ) {                                              // evict the LRU among LIVE workers (never `keep`)
		let lruKey = null, lruTick = Infinity;
		for ( const [k, e] of workers ) if ( e.worker && k !== keep && e.last < lruTick ) { lruTick = e.last; lruKey = k; }
		if ( lruKey != null ) evict(lruKey);
	}
	function evict( key ) {
		const e = workers.get(key);
		if ( !e ) return Promise.resolve(false);
		workers.delete(key);
		return e.worker ? Promise.resolve(e.worker.terminate()).then(() => true) : Promise.resolve(true);
	}

	return {
		// invoke the method keyed by `key` on its WARM instance (created on first use, reused after). Stateless-per-invoke.
		invoke: function ( key, iopts ) {
			iopts = iopts || {};
			const w = keyWorker(key, iopts);
			return w.invoke({ seed: iopts.seed, boundedFrom: iopts.boundedFrom, boundedKeys: iopts.boundedKeys, settleTimeout: iopts.settleTimeout });
		},
		// P5 — AFFINER sans casser le contrat: swap the BODY behind the fixed key (new conceptMap/providers) and tear
		// down the warm worker; the NEXT invoke re-creates from the refined config. The key/contract/Σ_sep — the
		// interface the caller casts on — is untouched. "Le délégué évolue, l'interface reste."
		refine: function ( key, newConfig ) {
			let e = workers.get(key);
			if ( !e ) { workers.set(key, { worker: null, uses: 0, config: Object.assign({}, newConfig) }); return Promise.resolve(true); }
			const old = e.worker;
			e.config = Object.assign({}, e.config, newConfig);   // the refined body
			e.worker = null;                                     // force re-create on next invoke
			return old ? Promise.resolve(old.terminate()).then(() => true) : Promise.resolve(true);
		},
		has:   ( key ) => workers.has(key),
		keys:  () => [...workers.keys()],
		size:  () => [...workers.values()].filter(( e ) => e.worker ).length,   // LIVE warm instances (a refined-but-not-yet-reinvoked key has no worker)
		stats: () => ({ instances: [...workers.values()].filter(( e ) => e.worker ).length, keys: [...workers.keys()], uses: [...workers.values()].reduce(( a, e ) => a + e.uses, 0) }),
		evict: evict,
		close: function () { return Promise.all([...workers.values()].map(( e ) => Promise.resolve(e.worker.terminate()))).then(() => { workers.clear(); }); }
	};
}

module.exports = { createInvokePool };
