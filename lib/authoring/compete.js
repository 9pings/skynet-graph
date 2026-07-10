/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * compete — §6.1 MULTI-PATH `Construct` → the dominance-gated competitive crystallizer (host-side, ZERO-CORE; spec
 * §6.1, refined by the 2026-06-30 Laurie residency confront).
 *
 * A `Construct` is the abstract, multi-hypothesis stage of the Construct→Method gradient: an LLM response is a SET of
 * candidate decompositions that expand. This provider runs that competition — propose N candidates, SELECT the survivor
 * by the `pareto` semiring (`semiring.js#paretoSelect`, the realized multi-criteria outcome, not a static heuristic) —
 * and EMITS the winner's decomposition as a bounded STRUCTURAL sub-graph so the existing trace→mine→crystallize pipeline
 * (the kill-gate's) turns a recurrent winner into a re-mountable `Method`. The next same-class problem then DISPATCHES
 * the winner at 0 model calls, eliding the WHOLE N-way rollout.
 *
 * RESIDENCY = isolated forks / per-instance competition (ZERO-CORE). True co-residency of contradictory branches = an
 * ATMS multi-context (de Kleer 1986) over a single-context JTMS engine — FILED (its only justifying case, a non-local
 * frontier, is what `contract.js` G1 already forbids). The candidate ELABORATION is the host's `propose` (a real
 * `graph.fork` rollout live, like `examples/poc/problem-compete.js`; a deterministic scorer in tests).
 *
 * THE LOAD-BEARING SOUNDNESS GATE (Laurie pt2 — else the survivor is a SILENT MIS-DISPATCHER): crystallizing the
 * survivor with `pre:[]` is candidate elimination (Mitchell 1982) with the NEGATIVES (the losing siblings) discarded.
 * The fix reifies the SELECTION CRITERION, not the siblings:
 *   • emit the winner's STRUCTURAL decomposition ONLY on a CLEAN DOMINANCE (`front.length===1`, one strict Pareto
 *     dominator); a Pareto TIE (`front.length>1`, a trade-off / equally-good sibling) → a FLAT head marker only, which
 *     the structural miner SKIPS (the existing flat-patch-skip IS the tie-gate — an arbitrary pick is unsound);
 *   • a winner that FLIPS for the same typed premise → two winner templates for one signature → the crystalliser's
 *     `signatureDetermined` (K1) REFUSES — winner-determinacy lifted from content-determinacy, no false crystallization.
 *
 * Engine landmines respected: a flat length-1 fact patch is skipped by the miner (so the WINNING cast emits a
 * multi-object sub-graph); a wired provider does NOT auto-flag its cast, so the head sets BOTH the cast marker
 * `{ Compete:true }` and a DISTINCT durable re-fire guard `{ Competed:true }`.
 *
 * @param opts.propose         (scope) -> [{ id, ...criteria, decomp }] | Promise<...>   the candidate decompositions;
 *                             each carries its pareto-criteria values + a `decomp(base, originNode, targetNode) ->
 *                             [obj,...]` builder for its structural sub-graph. Injectable: a fork rollout live, a stub in tests.
 * @param opts.criteria        {name: bandList|{dir}} the pareto comparison criteria (REQUIRED to discriminate).
 * @param opts.lex             criterion-priority order for the deterministic tie-break (default: criteria key order).
 * @param opts.discriminantKey the typed premise fact that should determine the winner (default 'taskClass') — echoed
 *                             onto the head only if NOT a require key (avoids the echoed-require crystallise hazard).
 * @returns { Compete: { compete } }  a provider-map fragment (concept provider ref `Compete::compete`).
 */
const { paretoSelect } = require('../providers/semiring.js');

function makeCompeteProvider( opts ) {
	opts = opts || {};
	const propose  = opts.propose;
	const criteria = opts.criteria || {};
	const discKey  = opts.discriminantKey || 'taskClass';

	return { Compete: {
		compete: function ( graph, concept, scope, argz, cb ) {
			Promise.resolve(propose(scope)).then(function ( cands ) {
				cands = cands || [];
				const sel  = paretoSelect(cands, criteria, { idKey: 'id', lex: opts.lex });
				const base = scope._._id, o = scope._.originNode, t = scope._.targetNode;
				// the head: the cast marker + the DISTINCT durable re-fire guard + the dominance discriminant (frontSize).
				const head = { $_id: '_parent', Compete: true, Competed: true, frontSize: sel.front.length };
				graph.traceProvider && graph.traceProvider(concept, scope, { compete: { frontIds: sel.frontIds, selectedId: sel.selectedId } });
				const winner = cands.filter(function ( c ) { return c.id === sel.selectedId; })[0];

				// TIE-GATE: a Pareto trade-off (no single dominator) → emit ONLY the flat head marker → the structural
				// miner skips it (an arbitrary pick among equally-good siblings is unsound to crystallise).
				if ( sel.front.length !== 1 || !winner || typeof winner.decomp !== 'function' ) return cb(null, head);

				// CLEAN DOMINANCE → emit the winner's structural decomposition (minable → crystallisable iff winner = f(premise)).
				cb(null, [head].concat(winner.decomp(base, o, t)));
			}).catch(function ( e ) { cb(null, { $_id: '_parent', Compete: true, Competed: true, llmError: e.message }); });
		},
	} };
}

module.exports = { makeCompeteProvider };
