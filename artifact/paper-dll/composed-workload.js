'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the COMPOSED workload for the composition-under-drift head-to-head. It extends the
 * single-link approval workload (workload.js) with a SECOND learned link, so the chain is:
 *
 *     decide(record) -> {approve|reject}          (link 1, = the published workload)
 *     disburse(decision) -> {disbursed|held}      (link 2, reads link 1's OUTCOME fact)
 *
 * The method (the learnable 2-link rule):
 *     decision     = approve    iff  score=='high' AND compliant(region,kind)
 *     disbursement = disbursed  iff  decision=='approve'   (else held)
 *
 * THE DRIFT is the SAME exogenous compliance audit (workload.js): a mid-stream audit marks a
 * (region,kind) class non-compliant. Its previously-approved (score=high) cases must flip
 * decision approve->reject AND — because link 2 reads the decision — disbursement disbursed->held.
 * That is the point of the composed measure: the drift CASCADES through the chain.
 *
 *   - A defeasible engine (STRUCT) re-asserts the upstream post, un-casts approve, casts reject, and
 *     the change CASCADES to link 2 (Disburse un-casts, Hold casts) — both links recovered, selectively,
 *     at ZERO extra model call (the cascade is in-engine).
 *   - A surface/coarse memory serves the STALE approve at link 1 AND the STALE disbursed at link 2:
 *     the staleness COMPOUNDS. Or it recovers link 1 but pays its mechanism tax AGAIN at link 2.
 *
 * Ground truth is KNOWN for BOTH links (a pure function of the record + the audit state at its index).
 * The link-2 truth is a pure function of the link-1 truth, so isFlipped is the SAME set for both links
 * (a record whose decision flips has its disbursement flip too) — but a stale arm can be wrong at
 * link 2 EVEN WHEN it happened to be right at link 1, which is what `compounded-staleness` measures.
 */

const { makeWorkload: makeBase } = require('./workload.js');

/**
 * Build the composed (2-link) workload on top of the single-link generator.
 *  opts: same as workload.js#makeWorkload ({ kinds, regions, scores, heldOutRegion, audited, preCycles, postCycles }).
 *  returns the base workload PLUS:
 *   - truth1(r)/truth2(r)   = the correct action at link 1 / link 2 given the record's index (audit-aware)
 *   - isFlipped1(r)/isFlipped2(r) = true iff this post-audit record's correct answer DIFFERS from pre-audit, per link
 *   - truth(r)              = truth1 (kept so harness.score / harness.selfTest work unchanged on the link-1 view)
 *   - meta.links = 2, meta.driftCases1 / meta.driftCases2
 */
function makeComposedWorkload( opts = {} ) {
	const base = makeBase(opts);
	const truth1 = base.truth;                                   // link 1 = the published decision rule
	const truth2 = ( r ) => truth1(r) === 'approve' ? 'disbursed' : 'held';   // link 2 = a pure fn of link 1
	const isFlipped1 = base.isFlipped;                           // decision flips on an audited high-score post-audit case
	const isFlipped2 = isFlipped1;                               // disbursement flips exactly when the decision flips

	return Object.assign({}, base, {
		truth1, truth2, isFlipped1, isFlipped2,
		// keep the single-link contract so harness.selfTest (NAIVE link-1 perfect) and harness.score still work
		truth: truth1, isFlipped: isFlipped1,
		meta: Object.assign({}, base.meta, {
			links: 2,
			driftCases1: base.stream.filter(isFlipped1).length,
			driftCases2: base.stream.filter(isFlipped2).length,
		}),
	});
}

module.exports = { makeComposedWorkload };
