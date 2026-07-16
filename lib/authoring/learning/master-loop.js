/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * master-loop — the ALWAYS-ON MASTER LOOP (host-side controller, ZERO-CORE). M1 of the productization
 * campaign; the standing controller that wires the master-graph supervisor ARMS into ONE cost-ordered loop
 * (master-graph study §2.2 — the value-of-computation ladder). Per incoming problem it climbs the ladder
 * and takes the FIRST arm that resolves at acceptable cost:
 *
 *   MATCH    — exact cache hit on the K1 signature                       → 0 model calls (the warm library).
 *   RETRIEVE — fuzzy recall (U5) → typed VERIFY: full → replay (0);       → 0 (full) or partial cost
 *              partial → mount the shared skeleton + RE-FORGE only the diff.
 *   FORGE    — the expensive path (fork + LLM + crystallize into the      → full cost; warms the library.
 *              library); the mount policy (U2) picks the regime.
 *   ESCALATE — a method pinned to the K1 floor (deopted K times) always   → full cost, never cached.
 *              re-forges / stays in the LLM.
 *
 * DRIFT: when a premise changes, `drift(problem)` invalidates the method's cache entry and records a deopt
 * (U2 mount-rank descends toward the ESCALATE floor → the adapt loop terminates). Re-aggregation of a
 * derived summary is the caller's `reaggregate` arm (U3). The controller is DOMAIN-AGNOSTIC: the caller
 * injects `signature`, `forge`, and (optionally) `reForge`; everything else is the built library machinery.
 *
 *   const loop = createMasterLoop({ signature, forge, reForge, mount: createMountController() });
 *   const r = await loop.solve(problem);   // { result, arm, regime, cost }
 *   loop.drift(problem);                    // a premise changed → invalidate + deopt
 */
const { digest } = require('../../providers/canonicalize.js');
const { createRecallIndex, recallAndVerify } = require('../learning/recall.js');
const { createMountController } = require('../core/mount.js');

function canon( x ) {
	if ( x === undefined ) return 'null';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(canon).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

/**
 * @param opts.signature  (problem) => { structure, content }   the typed K1 signature (required).
 *                        STRUCTURE defines the method class (mount/deopt key); CONTENT is what's derived.
 * @param opts.forge      async (problem, ctx) => { result, cost, signals? }   the expensive path (required).
 * @param opts.reForge    async (problem, candidate, reForgeKeys, ctx) => { result, cost }   partial re-forge
 *                        of only the differing content on a recalled skeleton (default: falls back to forge).
 * @param opts.cache      a Map-like { has,get,set,delete } (default: in-memory Map). Pass a disk-backed
 *                        store (M2) to make the library survive restarts.
 * @param opts.index      a recall index (default: createRecallIndex()).
 * @param opts.mount      a mount controller (default: createMountController()).
 * @param opts.recallK    how many candidates recall proposes (default 3).
 * @param opts.signals    (problem, methodId) => mount signals (reliability/hitRate/depth/readOnlyFrontier).
 */
function createMasterLoop( opts ) {
	opts = opts || {};
	const signature = opts.signature || (( p ) => ({ structure: p, content: {} }));
	const forge = opts.forge;
	const reForge = opts.reForge || ((( p, c, ks, ctx ) => forge(p, ctx)));   // no partial path → forge fully
	const cache = opts.cache || new Map();
	const index = opts.index || createRecallIndex();
	const mount = opts.mount || createMountController();
	const recallK = opts.recallK || 3;
	const signalsOf = opts.signals || (() => ({}));
	if ( typeof forge !== 'function' ) throw new Error('master-loop: opts.forge is required');

	const stats = { match: 0, recallFull: 0, recallPartial: 0, forge: 0, escalate: 0, cost: 0, calls: 0 };
	const keyOf = ( sig ) => digest({ s: canon(sig.structure), c: canon(sig.content) });
	const idOf = ( sig ) => digest({ s: canon(sig.structure) });   // method CLASS id (mount/deopt key)
	const hits = {};   // idOf -> {hit, total}  (a cheap hit-rate signal for the mount policy)

	function bump( id, hit ) { const h = hits[id] || (hits[id] = { hit: 0, total: 0 }); h.total++; if ( hit ) h.hit++; }
	function sig2signals( problem, id ) { const h = hits[id] || { hit: 0, total: 0 }; return Object.assign({ hitRate: h.total ? h.hit / h.total : 0 }, signalsOf(problem, id)); }

	async function solve( problem ) {
		stats.calls++;
		const sig = signature(problem), key = keyOf(sig), id = idOf(sig);

		// ── ESCALATE floor: a method deopted to the floor never replays — always re-forge / stay in the LLM.
		if ( mount.regimeOf(id) === 'escalate' ) {
			stats.escalate++; bump(id, false);
			const r = await forge(problem, { id, sig, regime: 'escalate' });
			stats.cost += (r.cost || 0);
			return { result: r.result, arm: 'escalate', regime: 'escalate', cost: r.cost || 0 };
		}

		// ── MATCH: exact cache hit on the K1 signature → 0 model calls.
		if ( cache.has(key) ) {
			stats.match++; bump(id, true);
			const regime = mount.decide(id, sig2signals(problem, id)).regime;
			return { result: cache.get(key), arm: 'match', regime, cost: 0 };
		}

		// ── RETRIEVE: fuzzy recall → typed verify.
		const cand = recallAndVerify(index, sig, recallK);
		if ( cand && cand.verdict.mode === 'full' ) {
			stats.recallFull++; bump(id, true); cache.set(key, cand.method);
			const regime = mount.decide(id, sig2signals(problem, id)).regime;
			return { result: cand.method, arm: 'recall-full', regime, cost: 0 };
		}
		if ( cand && cand.verdict.mode === 'partial' ) {
			stats.recallPartial++; bump(id, false);
			const r = await reForge(problem, cand, cand.verdict.reForge, { id, sig });
			stats.cost += (r.cost || 0);
			cache.set(key, r.result); index.add(sig, r.result);
			const regime = mount.decide(id, sig2signals(problem, id)).regime;
			return { result: r.result, arm: 'recall-partial', regime, cost: r.cost || 0, reForged: cand.verdict.reForge };
		}

		// ── FORGE: the expensive path; warms the library + the recall index.
		stats.forge++; bump(id, false);
		const r = await forge(problem, { id, sig, regime: 'instance' });
		stats.cost += (r.cost || 0);
		cache.set(key, r.result); index.add(sig, r.result);
		const regime = mount.decide(id, Object.assign(sig2signals(problem, id), r.signals)).regime;
		return { result: r.result, arm: 'forge', regime, cost: r.cost || 0 };
	}

	/** a premise drifted → invalidate this method (cache AND recall index) + record a deopt (U2 mount-rank
	 *  descends toward the floor). The next solve RE-DERIVES — it must never recall the stale method. */
	function drift( problem ) {
		const sig = signature(problem), key = keyOf(sig), id = idOf(sig);
		cache.delete(key);
		if ( index.remove ) index.remove(sig);   // a drifted premise → re-derive, never replay the invalidated method
		const deopts = mount.recordDeopt(id);
		return { id, deopts, regime: mount.regimeOf(id) };
	}

	return { solve, drift, stats, cache, index, mount, keyOf, idOf };
}

module.exports = { createMasterLoop };
