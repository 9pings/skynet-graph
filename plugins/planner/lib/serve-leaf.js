/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * serve-leaf — THE UNIFICATION (roadmap 2026-07-09 P6; ZERO-CORE). `context-project`'s projection serves each leaf
 * with an injected `serve(leaf)` — until now an opaque stub. P6 makes **`serveLeaf` = DISPATCH (libraryKey) + MOUNT
 * (a concept-method invoked on a shared instance)**: a leaf is no longer an opaque value, it IS a mounted method. This
 * folds projection + runtime (P1 invoke) + library (dispatch) + method (the contract gate) into ONE structure — "le
 * reste s'adapte à la structure centrale", by the constat.
 *
 *   const serve = makeMethodServe({ methods, pool });          // pool = a P3 invoke-pool (N cases → 1 instance)
 *   const proj  = createContextProjection({ serve });          // a leaf IS a dispatched, mounted, gated method
 *   const { order, results } = await proj.run(roadmap, ctx);
 *
 * Per leaf: (1) DISPATCH — `keyOf(leaf)` → a libraryKey (default: leaf.produces; library.js#byKey in production);
 * (2) MOUNT + INVOKE — the method runs on its shared warm instance (P3) with the leaf's bounded inputs as the seed
 * (the slot bindings); (3) GATE — assertPost (P4) admits the bounded summary or refuses (blame → the §5 forge fallback);
 * the leaf's VALUE is the method's bounded output, which flows to downstream leaves through the projection's pool.
 */
const { assertPost } = require('../../../lib/authoring/contract.js');

/**
 * makeMethodServe(spec) — a projection `serve(leaf, ctx)` that dispatches+mounts a concept-method per leaf.
 * @param spec.methods  { <libraryKey>: { conceptMap, providers?, contract, boundedFrom, boundedKeys?, buildSeed(leaf,ctx), value?(summary), oracle? } }
 * @param spec.keyOf    (leaf) => libraryKey        the dispatch (default: leaf.produces || leaf.id).
 * @param spec.pool     a P3 invoke-pool (default: a fresh own pool — close via serve.close()).
 * @param spec.fallback (leaf, ctx, info) => value  the §5 last-resort on a dispatch miss / a gate refusal.
 * @returns serve       async (leaf, ctx) => value  (+ serve.pool, serve.close()).
 */
function makeMethodServe( spec ) {
	spec = spec || {};
	const methods = spec.methods || {};
	const keyOf = spec.keyOf || (( leaf ) => leaf.produces || leaf.id);
	const pool = spec.pool || require('../../../lib/index.js').createInvokePool();
	const ownPool = !spec.pool;

	async function serve( leaf, ctx ) {
		const key = keyOf(leaf);                                          // (1) DISPATCH
		const m = methods[key];
		if ( !m ) {
			if ( spec.fallback ) return spec.fallback(leaf, ctx, { reason: 'no-method', key });
			throw new Error('serveLeaf: no method for libraryKey "' + key + '" (leaf ' + leaf.id + ')');
		}
		const boundedKeys = m.boundedKeys || (m.contract && m.contract.write) || [];
		const seed = m.buildSeed(leaf, ctx);                             // the leaf's bounded inputs = the slot bindings
		const result = await pool.invoke(key, { conceptMap: m.conceptMap, providers: m.providers,   // (2) MOUNT + INVOKE (P1/P3)
			seed, boundedFrom: m.boundedFrom, boundedKeys, settleTimeout: m.settleTimeout });
		const post = assertPost(m.contract || {}, result.summary || {}, result.writeFootprint || [], { oracle: m.oracle });   // (3) GATE (P4)
		if ( !post.ok ) {
			if ( spec.fallback ) return spec.fallback(leaf, ctx, { reason: 'gate-refused', blame: post.blame });
			throw new Error('serveLeaf: gate refused for "' + key + '": ' + post.violations.map(( v ) => v.kind).join(','));
		}
		return m.value ? m.value(result.summary, leaf) : result.summary;   // the leaf's VALUE = the mounted method's bounded output
	}
	serve.pool = pool;
	serve.close = () => ownPool ? pool.close() : Promise.resolve();
	return serve;
}

module.exports = { makeMethodServe };
