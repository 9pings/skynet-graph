/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * higher-order — THE METHOD-SLOT / higher-order `need` (roadmap 2026-07-09 §5(a); ZERO-CORE). Until now a part
 * declares only DATA-needs (it needs a VALUE). §5(a) adds the BEHAVIOURAL hole: a "loop" method declares
 * *"I need a SUB-METHOD in this slot"* (the loop body, the stop predicate) = a **method-slot** (`kind:'subgraph'`),
 * filled by DISPATCH (P2/serveLeaf) — a slot filled by a dispatched method, not hardcoded. Swapping the dispatched
 * body changes the loop's behaviour: that IS the loop-in-loop. Soundness across the extra hop is KG-PROXY-2 (GO).
 *
 * `makeHigherOrderServe({ loops, bodies, pool })` → a projection `serve(leaf)`:
 *   • DISPATCH the body sub-method for the leaf's method-slot (`loop.bodyKeyOf(leaf)` → a libraryKey);
 *   • APPLY it (map/all/any/fold) over the leaf's items — each application is a MOUNTED, gated invoke (P1/P3/P4)
 *     of the dispatched body → the loop's behavioural hole is filled at runtime by a dispatched method.
 * The body sub-methods reuse `makeMethodServe` (P6), so each body application is itself dispatch + mount + gate.
 *
 * NESTING (map-of-maps): when a body key names ANOTHER loop (not a plain method), the application RECURSES — the
 * inner loop's items are the current item. Bounded by construction (finite items × finite inner items = a finite
 * tree) + a CYCLE guard (a loop that transitively names itself REFUSES, the control-structure analog of G3). The
 * soundness of the stack of nested hops = KG-PROXY-2 (each hop bounded + gated).
 */
const { makeMethodServe } = require('./serve-leaf.js');

/**
 * @param spec.bodies  { <libraryKey>: <makeMethodServe method spec> }  the candidate SLOT FILLERS (dispatched bodies).
 *                     each body's buildSeed receives a leaf carrying `.item` (the current element).
 * @param spec.loops   { <libraryKey>: { bodyKeyOf(leaf)->libraryKey, items(leaf)->[..], combinator?, fold?, init? } }
 *                     the higher-order "loop" methods. combinator: 'map'(default) | 'all' | 'any' | 'fold'.
 * @param spec.keyOf   (leaf) => loop libraryKey (default: leaf.produces || leaf.id).
 * @param spec.pool    a shared P3 invoke-pool (default: own).
 * @returns serve      async (leaf, ctx) => value  (+ serve.pool, serve.close()).
 */
function makeHigherOrderServe( spec ) {
	spec = spec || {};
	const pool = spec.pool || require('../../../lib/index.js').createInvokePool();
	const loops = spec.loops || {};
	const keyOf = spec.keyOf || (( leaf ) => leaf.produces || leaf.id);
	// the SLOT FILLERS are served exactly like any leaf method (P6) — dispatch + mount + gate — keyed by the body key.
	const bodyServe = makeMethodServe({ methods: spec.bodies || {}, keyOf: ( bl ) => bl.__key, pool });

	// apply the body over ONE item: a body key that names a nested LOOP → RECURSE (the inner loop's items = this item);
	// else dispatch+mount+gate a PLAIN method (P6). `chain` carries the loop-key path for the cycle guard.
	async function applyBody( bodyKey, item, id, ctx, chain ) {
		if ( loops[bodyKey] )                                            // NESTED loop → recurse (map-of-maps)
			return runLoop(bodyKey, { id: id, produces: bodyKey, item: item, inputs: {} }, ctx, chain);
		return bodyServe({ __key: bodyKey, id: id, produces: bodyKey, needs: [], inputs: {}, item: item }, ctx);
	}

	async function runLoop( loopKey, leaf, ctx, chain ) {
		chain = chain || [];
		if ( chain.indexOf(loopKey) !== -1 )                            // CYCLE guard: a loop that transitively names itself → REFUSE (control-structure G3)
			throw new Error('higher-order serve: cyclic nested loop "' + loopKey + '" (chain ' + chain.concat(loopKey).join('→') + ')');
		const next = chain.concat(loopKey);
		const loop = loops[loopKey];
		const bodyKey = loop.bodyKeyOf(leaf);                            // DISPATCH the body into the method-slot
		const items = loop.items(leaf);                                  // items = the RESOLVED collection (never coerce undefined→[])
		if ( !Array.isArray(items) )                                     // fail-closed: an UNRESOLVED slot is a refusal, NOT a vacuous empty loop (all([])===true)
			throw new Error('higher-order serve: items(leaf) for "' + loopKey + '" is not an array (unresolved slot?) — leaf ' + leaf.id);
		const results = [];
		for ( let i = 0; i < items.length; i++ )                        // APPLY the body (plain OR nested loop) over the items
			results.push(await applyBody(bodyKey, items[i], leaf.id + ':body' + i, ctx, next));

		switch ( loop.combinator || 'map' ) {
			case 'all':  return results.every(Boolean);
			case 'any':  return results.some(Boolean);
			case 'fold': return results.reduce(loop.fold, loop.init);
			default:     return results;                                // 'map'
		}
	}

	async function serve( leaf, ctx ) {
		const key = keyOf(leaf);
		if ( !loops[key] ) throw new Error('higher-order serve: no loop method for libraryKey "' + key + '" (leaf ' + leaf.id + ')');
		return runLoop(key, leaf, ctx, []);
	}
	serve.pool = pool;
	serve.close = () => spec.pool ? Promise.resolve() : pool.close();
	return serve;
}

module.exports = { makeHigherOrderServe };
