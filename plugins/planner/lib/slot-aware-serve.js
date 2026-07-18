/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * slot-aware-serve — THE ROUTER between a plain leaf and a higher-order (method-slot) leaf (roadmap §5(a), the
 * GENERATION seam; ZERO-CORE). `dag-decompose` now EMITS a typed `slot:{over,body,combinator}` on a part; this serve
 * inspects it and forks:
 *   • NO slot        → `makeMethodServe` (P6): dispatch → mount → gate a concept-method (a leaf IS a mounted method).
 *   • a typed slot   → `makeHigherOrderServe` (§5a): the slot's `body` is DISPATCHED over the items resolved under
 *                      `over`, reduced by `combinator` (map|all|any) — a leaf IS a mounted loop-of-methods.
 * Both forks SHARE one P3 worker-pool (N cases → 1 instance). The items come from the projection's RESOLVED bounded
 * context (`leaf.inputs[over]`, because `over` was auto-added as a need) — so the loop is never vacuous: an UNRESOLVED
 * `over` (or a non-array value) is a typed refusal (→ fallback), NEVER `[].every(Boolean)===true` (the confront break).
 *
 *   const serve = makeSlotAwareServe({ methods, bodies });        // methods = plain library, bodies = slot fillers
 *   const proj  = createContextProjection({ serve });             // plain + higher-order leaves, one projection
 *   const { results } = await proj.run(leavesToRoadmap(await decompose(task)), ctx);
 */
const { makeMethodServe } = require('./serve-leaf.js');
const { makeHigherOrderServe } = require('./higher-order.js');

// read the method-slot off a leaf, from either channel: the projection-reconstructed leaf (`leaf.slot`) or the
// plan-loop-carried leaf (`leaf.request.slot`).
function slotOf( leaf ) { return (leaf && (leaf.slot || (leaf.request && leaf.request.slot))) || null; }

/**
 * makeSlotAwareServe(spec) — a projection `serve(leaf, ctx)` that routes plain vs higher-order leaves.
 * @param spec.methods   { <libraryKey>: <makeMethodServe method spec> }  the PLAIN library (dispatched per leaf).
 * @param spec.bodies    { <bodyKey>:    <makeMethodServe method spec> }  the SLOT FILLERS (dispatched per item).
 * @param spec.keyOf     (leaf) => libraryKey   the plain dispatch (default: leaf.produces || leaf.id).
 * @param spec.pool      a shared P3 worker-pool (default: a fresh own pool — close via serve.close()).
 * @param spec.fallback  (leaf, ctx, info) => value  the §5 last-resort on a dispatch miss / an unresolved slot.
 * @returns serve        async (leaf, ctx) => value  (+ serve.pool, serve.close()).
 */
function makeSlotAwareServe( spec ) {
	spec = spec || {};
	const bodies = spec.bodies || {};
	const pool = spec.pool || require('../../../lib/index.js').createWorkerPool();
	const ownPool = !spec.pool;
	// dispatch key, ROBUST to both leaf shapes: the plan-loop leaf keys on `request.id` (its id is prefixed `n_<key>`),
	// the à-nu projection leaf keys on `produces`. Without this a plan-loop leaf mis-dispatches → provider error →
	// the Step concept re-fires to the apply-cap (1000) → DIVERGENT (the cast-marker GOTCHA). Default covers both.
	const keyOf = spec.keyOf || (( l ) => (l.request && l.request.id) || l.produces || l.id);
	const plain = makeMethodServe({ methods: spec.methods || {}, keyOf: keyOf, pool: pool, fallback: spec.fallback });
	// three generic combinator-keyed loops → the emitted slot maps 1:1 onto `makeHigherOrderServe` (ZERO consumer delta):
	// bodyKeyOf/items are DATA-DRIVEN off the slot, so the same three loops serve every emitted higher-order leaf.
	const mkLoop = ( combinator ) => ({ combinator: combinator,
		bodyKeyOf: ( l ) => slotOf(l).body, items: ( l ) => (l.inputs || {})[slotOf(l).over] });
	// the 3 generic combinator loops + any NAMED nested loops (spec.loops) → a slot whose `body` names a nested loop
	// (map-of-maps) recurses inside makeHigherOrderServe.
	const nested = spec.loops || {};
	const loops = Object.assign({ __slot_map: mkLoop('map'), __slot_all: mkLoop('all'), __slot_any: mkLoop('any') }, nested);
	const ho = makeHigherOrderServe({ bodies: bodies, pool: pool, loops: loops, keyOf: ( l ) => '__slot_' + slotOf(l).combinator });

	function refuse( leaf, ctx, info ) {
		if ( spec.fallback ) return spec.fallback(leaf, ctx, info);
		throw new Error('slot-aware serve: ' + info.reason + ' for slot on leaf ' + (leaf && leaf.id) + (info.over ? ' (over="' + info.over + '")' : ''));
	}

	async function serve( leaf, ctx ) {
		const slot = slotOf(leaf);
		if ( !slot ) return plain(leaf, ctx);                                   // PLAIN → dispatch+mount+gate a method
		if ( !bodies[slot.body] && !nested[slot.body] ) return refuse(leaf, ctx, { reason: 'no-body', body: slot.body });   // dispatch miss (a plain body OR a nested loop)
		const items = (leaf.inputs || {})[slot.over];                           // the items = the RESOLVED bounded input
		if ( !Array.isArray(items) ) return refuse(leaf, ctx, { reason: 'slot-unresolved', over: slot.over });   // never iterate undefined/a string
		return ho(leaf, ctx);                                                   // HIGHER-ORDER → dispatched loop over items
	}
	serve.pool = pool;
	serve.close = () => ownPool ? pool.close() : Promise.resolve();
	return serve;
}

module.exports = { makeSlotAwareServe, slotOf };
