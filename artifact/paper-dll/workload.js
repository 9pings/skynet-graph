'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P1a — the REAL recurrent workload for the paper "Defeasible Library Learning".
 *
 * Domain: a typed APPROVAL decision  decide(record) -> {approve|reject}.
 *   record = { id, kind, region, tier, score, phase }
 *   - kind   ∈ {loan, refund, wire, payout}   (typed, decision-relevant)
 *   - region ∈ {EU, US, APAC}                  (typed, decision-relevant; APAC = HELD-OUT by default)
 *   - score  ∈ {high, low}                     (typed, decision-relevant)
 *   - tier   ∈ {small, large}                  (INCIDENTAL — never read by the rule; the amortization axis:
 *                                               a typed key that elides `tier` reuses across tiers)
 *
 * The method (the learnable rule):  approve  iff  score=='high'  AND  compliant(region,kind).
 * `compliant` is an EXTERNAL premise (a regulator's view), initially all-true. THE DRIFT is a mid-stream
 * compliance AUDIT that marks a (region,kind) class NON-compliant → its previously-approved (score=high)
 * cases must FLIP to reject. The audit is NOT a record field — it is exogenous state. This is the decisive
 * point: a similarity cache (RAG/CBR/skill) retrieves the SAME unchanged record and serves its cached
 * pre-audit `approve` (STALE — no defeasance), while a defeasible typed contract RE-ASSERTS the post against
 * the ingested audit fact, invalidates exactly the affected class, and re-derives `reject`.
 *
 * The "class" (the typed premise the decision depends on) = {kind, region, score}; tier is excluded.
 * Ground truth is KNOWN (a pure function of the record + the audit state at its position).
 */

const KINDS = ['loan', 'refund', 'wire', 'payout'];
const REGIONS = ['EU', 'US', 'APAC'];
const SCORES = ['high', 'low'];
const TIERS = ['small', 'large'];

const classKey = ( r ) => `${r.kind}|${r.region}|${r.score}`;          // the TYPED premise (tier excluded)
const auditKey = ( r ) => `${r.region}|${r.kind}`;                     // an audit targets a (region,kind) pair

function classesOf( { kinds = KINDS, regions = REGIONS, scores = SCORES } = {} ) {
	const out = [];
	for ( const kind of kinds ) for ( const region of regions ) for ( const score of scores )
		out.push({ kind, region, score });
	return out;
}

/**
 * Build the stream + the audit + the ground-truth oracle.
 *  opts: { kinds, regions, scores, heldOutRegion, audited:[{region,kind}], preCycles, postCycles }
 *  returns { stream, auditAt, auditedSet, truth, isFlipped, meta }
 *   - stream[i] = a record with a stable .index === i
 *   - auditAt   = the index at which the audit fires (records at index >= auditAt are post-audit)
 *   - auditedSet = Set of auditKey() strings that are non-compliant after the audit
 *   - truth(record) = the correct action GIVEN the record's position (pre/post audit) — KNOWN ground truth
 *   - isFlipped(record) = true iff this post-audit record's correct answer DIFFERS from its pre-audit answer
 *                         (the audited class with score=high) — the drift cases STRUCT must recover
 */
function makeWorkload( opts = {} ) {
	const kinds = opts.kinds || KINDS;
	const regions = opts.regions || REGIONS;
	const scores = opts.scores || SCORES;
	const heldOutRegion = 'heldOutRegion' in opts ? opts.heldOutRegion : 'APAC';
	const audited = opts.audited || [{ region: 'EU', kind: 'loan' }];
	const preCycles = opts.preCycles != null ? opts.preCycles : 2;
	const postCycles = opts.postCycles != null ? opts.postCycles : 2;

	const auditedSet = new Set(audited.map(( a ) => `${a.region}|${a.kind}`));
	const allClasses = classesOf({ kinds, regions, scores });
	const trainClasses = allClasses.filter(( c ) => c.region !== heldOutRegion);   // held-out region is test-only

	const stream = [];
	const push = ( cls, cycle, phase ) => {
		// the incidental tier varies BY CYCLE so each class recurs with BOTH tiers: a TYPED key (elides tier)
		// reuses across them; a SURFACE key (incl. tier) splits and amortizes worse — the measured contrast.
		const tier = TIERS[cycle % TIERS.length];
		stream.push({ id: stream.length, index: stream.length, kind: cls.kind, region: cls.region,
			score: cls.score, tier, phase });
	};

	// PRE-audit: warm the library on the train classes (held-out region withheld).
	for ( let c = 0; c < preCycles; c++ ) for ( const cls of trainClasses ) push(cls, c, 'pre');
	const auditAt = stream.length;
	// POST-audit: re-run ALL classes (incl. held-out + the audited class, which must now flip).
	for ( let c = 0; c < postCycles; c++ ) for ( const cls of allClasses ) push(cls, c, 'post');

	const activeAuditAt = ( index ) => index >= auditAt ? auditedSet : new Set();
	const truth = ( r ) => ( r.score === 'high' && !activeAuditAt(r.index).has(auditKey(r)) ) ? 'approve' : 'reject';
	const isFlipped = ( r ) => r.index >= auditAt && r.score === 'high' && auditedSet.has(auditKey(r));

	return {
		stream, auditAt, auditedSet, truth, isFlipped, activeAuditAt,
		meta: { n: stream.length, preCount: auditAt, postCount: stream.length - auditAt,
			classes: allClasses.length, trainClasses: trainClasses.length, heldOutRegion,
			audited: [...auditedSet], driftCases: stream.filter(isFlipped).length },
	};
}

module.exports = { makeWorkload, classesOf, classKey, auditKey, KINDS, REGIONS, SCORES, TIERS };
