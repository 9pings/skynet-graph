/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * reaggregate — DEFEASIBLE RE-AGGREGATION (host-side, ZERO-CORE). U3 / the study's A6-A7 point; closes
 * finding #31 (the E4 defeasance wedge worked at the BELIEF level — a retracted premise dropped its concept
 * — but the `{__push}`-aggregated SUMMARY did NOT auto-update, because push is monotonic and a cast rollup
 * does not re-fire on a value change, #22). So a derived summary stayed STALE after a part retracted.
 *
 * THE MECHANISM (proven on the real engine). A part contributes via `{__push}` (race-free fan-in, the
 * accumulation discipline). On RETRACT, the part's `cleaner` runs a SEQUENCED mutation that (a) filters its
 * own contribution out of the anchor's list AND (b) re-folds the summary from what remains — in ONE
 * mutation, so the summary is always consistent with the LIVE cast set without fighting #22. The summary
 * concept folds on cast (after the parts push, fold-after-quiescence). Net: belief AND summary are both
 * defeasible → the E4 wedge is end-to-end.
 *
 *   const agg = defeasibleAggregate({ anchor: s => s._.partOf, valueKey: 'val', fold: xs => xs.reduce((a,x)=>a+x.val,0) });
 *   Graph._providers = { A: { part: agg.contribute, unpart: agg.uncontribute, summary: agg.summarize } };
 *   // Part concept:    { require:[…], ensure:['$srcOk'], provider:['A::part'], cleaner:['A::unpart'] }
 *   // Summary concept: { require:['Anchor','contributions'], provider:['A::summary'] }
 */

/**
 * @param spec.anchor        (scope) => anchorId           where the aggregate lives (required)
 * @param spec.fold          (contributions[]) => value    the aggregate (required)
 * @param spec.contribution  (scope) => contributionObj    default { id: scope._._id, val: scope._[valueKey] }
 * @param spec.same          (contrib, scope) => bool       identify THIS part's contribution; default by `id`
 * @param spec.valueKey      fact key for the default contribution value (default 'val')
 * @param spec.contribKey    the anchor list fact (default 'contributions')
 * @param spec.summaryKey    the anchor summary fact (default 'summary')
 */
function defeasibleAggregate( spec ) {
	spec = spec || {};
	const anchorOf = spec.anchor || (( s ) => s._.partOf);
	const fold = spec.fold || (( xs ) => (xs || []).length);
	const valueKey = spec.valueKey || 'val';
	const contribKey = spec.contribKey || 'contributions';
	const summaryKey = spec.summaryKey || 'summary';
	const contribution = spec.contribution || (( s ) => ({ id: s._._id, val: s._[valueKey] }));
	const same = spec.same || (( x, s ) => x && x.id === s._._id);

	return {
		// PART cast: mark cast + push this part's contribution to the anchor (race-free fan-in via {__push}).
		// If the summary was ALREADY folded once (a later re-add after a drift-recovery — a sequenced,
		// single-part event, not the initial concurrent fan-in), re-fold inline too, since a cast Summary
		// concept won't re-fire on the value change (#22). Initial concurrent fan-in (no summary yet) just
		// pushes; the Summary concept folds the authoritative value after quiescence.
		contribute: function ( graph, concept, scope, argz, cb ) {
			const anchorId = anchorOf(scope), anc = graph.getEtty(anchorId);
			const cur = (anc && anc._[contribKey]) || [];
			const mine = contribution(scope);
			const upd = { $$_id: anchorId, [contribKey]: { __push: mine } };
			if ( anc && anc._[summaryKey] !== undefined ) upd[summaryKey] = fold(cur.concat([mine]));   // re-add → re-fold inline
			cb(null, [{ $_id: '_parent', [concept._name]: true }, upd]);
		},
		// PART cleaner (runs on RETRACT): filter this part's contribution out AND re-fold — one sequenced
		// mutation, so the summary tracks the live cast set (the defeasible re-aggregation).
		uncontribute: function ( graph, concept, scope, argz, cb ) {
			const anchorId = anchorOf(scope);
			const anc = graph.getEtty(anchorId);
			const kept = ((anc && anc._[contribKey]) || []).filter(( x ) => !same(x, scope));
			cb(null, { $$_id: anchorId, [contribKey]: kept, [summaryKey]: fold(kept) });
		},
		// SUMMARY cast: fold the live contributions (after the parts have pushed — fold-after-quiescence).
		summarize: function ( graph, concept, scope, argz, cb ) {
			cb(null, { $_id: '_parent', [concept._name]: true, [summaryKey]: fold(scope._[contribKey] || []) });
		}
	};
}

module.exports = { defeasibleAggregate };
