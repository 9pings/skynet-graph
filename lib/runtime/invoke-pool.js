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

	function keyWorker( key, iopts ) {
		let e = workers.get(key);
		if ( !e ) {
			const createGraphWorker = require('./index.js').createGraphWorker;   // lazy — avoids the load-order circular
			// bind a persistent worker to THIS key's method config (conceptMap/providers loaded once at init).
			const w = createGraphWorker(Object.assign({}, opts.workerDefaults, {
				conceptMap: iopts.conceptMap, concepts: iopts.concepts, providers: iopts.providers,
				geo: iopts.geo, llm: iopts.llm, ask: iopts.ask, conf: iopts.conf, logger: iopts.logger || opts.logger
			}));
			e = { worker: w, uses: 0 };
			workers.set(key, e);
			if ( opts.max && workers.size > opts.max ) evictLRU();
		}
		e.uses++; e.last = ++tick;
		return e.worker;
	}
	function evictLRU() {
		let lruKey = null, lruTick = Infinity;
		for ( const [k, e] of workers ) if ( e.last < lruTick ) { lruTick = e.last; lruKey = k; }
		if ( lruKey != null ) evict(lruKey);
	}
	function evict( key ) {
		const e = workers.get(key);
		if ( !e ) return Promise.resolve(false);
		workers.delete(key);
		return Promise.resolve(e.worker.terminate()).then(() => true);
	}

	return {
		// invoke the method keyed by `key` on its WARM instance (created on first use, reused after). Stateless-per-invoke.
		invoke: function ( key, iopts ) {
			iopts = iopts || {};
			const w = keyWorker(key, iopts);
			return w.invoke({ seed: iopts.seed, boundedFrom: iopts.boundedFrom, boundedKeys: iopts.boundedKeys, settleTimeout: iopts.settleTimeout });
		},
		has:   ( key ) => workers.has(key),
		keys:  () => [...workers.keys()],
		size:  () => workers.size,
		stats: () => ({ instances: workers.size, keys: [...workers.keys()], uses: [...workers.values()].reduce(( a, e ) => a + e.uses, 0) }),
		evict: evict,
		close: function () { return Promise.all([...workers.values()].map(( e ) => Promise.resolve(e.worker.terminate()))).then(() => { workers.clear(); }); }
	};
}

module.exports = { createInvokePool };
