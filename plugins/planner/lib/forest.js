/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * forest — THE MULTI-PATH GENERALIZATION (roadmap 2026-07-09 §5(c); ZERO-CORE). The concept-method as a LIBRARY of
 * alternative sub-paths (the derivation forest): "au moins un chemin complète, un seul reste actif". Re-opened now
 * that the single-path P1-P6 + the transitivity (KG-PROXY-2) hold — the single-path is the degenerate forest.
 *
 * `makeForestServe({ forests, candidates, pool, forge? })` → a projection `serve(leaf)`: for a leaf, try its candidate
 * sub-paths IN PREFERENCE ORDER; the FIRST that dispatches + mounts + GATES sound (P1/P3/P4) is SELECTED — the rest are
 * never activated. That selection IS the confluence guarantee that dodges G3 (`footprintCycles`): we SELECT one path,
 * we never COMPOSE mutually-retractable coupled methods, so there is no JTMS oscillation to the apply-cap. If every
 * candidate fails, fall to the §5(b) forge (last-resort learning) or refuse.
 */
const { makeMethodServe } = require('./serve-leaf.js');

/**
 * @param spec.candidates { <candidateKey>: <makeMethodServe method spec> }  the alternative sub-paths (each a method).
 * @param spec.forests    { <leafKey>: [candidateKey, ...] }  the forest per leaf, in PREFERENCE order.
 * @param spec.keyOf      (leaf) => leafKey   (default: leaf.produces || leaf.id).
 * @param spec.pool       a shared P3 invoke-pool (default: own).
 * @param spec.forge      async (args) => value   the §5(b) fallback when the forest is EXHAUSTED (optional).
 * @returns serve         async (leaf, ctx) => { value, selected, tried }  (+ serve.pool, serve.close()).
 */
function makeForestServe( spec ) {
	spec = spec || {};
	const pool = spec.pool || require('../../../lib/index.js').createInvokePool();
	const forests = spec.forests || {};
	const keyOf = spec.keyOf || (( leaf ) => leaf.produces || leaf.id);
	const serveOne = makeMethodServe({ methods: spec.candidates || {}, keyOf: ( l ) => l.__cand, pool });

	async function serve( leaf, ctx ) {
		const key = keyOf(leaf);
		const candidates = forests[key] || [];
		const tried = [];
		for ( const c of candidates ) {
			try {
				const value = await serveOne(Object.assign({}, leaf, { __cand: c, id: leaf.id + ':' + c }), ctx);   // dispatch + mount + GATE
				return { value, selected: c, tried: tried.concat(c) };                                             // FIRST sound → SELECTED (one stays active)
			} catch ( e ) { tried.push(c); }                                                                       // this path didn't complete → try the next (no coupling → no G3)
		}
		if ( typeof spec.forge === 'function' )                                                                    // forest EXHAUSTED → §5(b) last-resort learning
			return { value: await spec.forge({ leaf, stack: (ctx && ctx.stack) || [], contract: (ctx && ctx.contract) || {}, reason: 'forest-exhausted', tried }), selected: 'forged', tried };
		return { value: undefined, selected: null, tried, refusal: 'forest-exhausted' };
	}
	serve.pool = pool;
	serve.close = () => spec.pool ? Promise.resolve() : pool.close();
	return serve;
}

module.exports = { makeForestServe };
