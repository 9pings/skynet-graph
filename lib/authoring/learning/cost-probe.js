/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * cost-probe — the CONSTITUENT-COST utility gate for `compress.js` (the half `compose-hotspot.js` structurally CANNOT
 * measure). G-0 answers *does a composite RECUR?*; this answers the REAL build-gate: *does a composite-memo elide FORGE
 * calls that a per-primitive LEAF-memo cannot?* — measured in ELIDED FORGE CALLS net of the leaf floor, NEVER in MDL/bits
 * (a bit-compressing composite over cheap or leaf-memoizable constituents elides ZERO model calls; MDL is the
 * DreamCoder/Stitch *search-cost* objective, not the call-elision utility).
 *
 * WHY this is the decision axis, not structure (confront 2026-07-01 — Laurie + a library-learning SOTA, both converged):
 * `savedCalls = distinctTasks − 1` (compose-hotspot) is an UPPER BOUND that ASSUMES a per-task forge; it is blind to
 * whether the leaf memo already elides the constituents at ~0 marginal calls. A composite PAYS iff, per constituent, it is
 *   (a) FORGE-COSTLY (a real model call), and
 *   (b) NOT individually leaf-memoizable — its STANDALONE typed key varies per instance so the leaf memo MISSES — while
 *   (c) the composite-as-a-unit is K1-STABLE: its typed ENVELOPE key IS a function of the composite input.
 * That is the **canonicalization-in-context band**: an expensive, standalone-UNSTABLE interior under a stable typed
 * ENVELOPE. It is structurally THIN because in a data-flow DAG **linearity ↔ cheapness are anti-correlated**: an in=out=1
 * (linear, poly-gate-visible) stage tends to be a cheap deterministic transform (leaf-memo already floors it), whereas an
 * expensive reasoning stage emits a multiply-consumed rich artifact → fan-out → FORK → outside the poly gate (SUBDUE-beam
 * scope). So the composites worth compressing are the ones G-a misses, and the ones G-a sees are not worth compressing —
 * the double bind that keeps compress.js FILED until a real payer is EXHIBITED on this axis.
 *
 * The engine already embodies this band at the SINGLE-method level: `Intake::type` is canonicalization-in-context — free
 * prose (standalone-unstable) → a stable typed digest (envelope), the borderline gate + synonym ring making the envelope
 * stable across paraphrases. compress.js would be the MULTI-step generalization; this probe is its kill-gate.
 *
 * MODEL (charitable to compress.js — it may use the leaf memo INSIDE the composite):
 *   leaf floor   : a constituent forges iff its leafKey is NEW (else the leaf memo replays it).
 *   + composite  : on a composite HIT (envelopeKey seen) the whole composite is replayed → 0 forge; on a MISS, forge only
 *                  the still-unmemoized leaves. So the composite memo elides a forge iff (leafKey NEW ∧ envelopeKey OLD).
 *   net = Σ forgeCost·[leaf NEW ∧ envelope OLD] − bloat.   GO iff net > bloat-adjusted 0.
 */

/**
 * @param occurrences  stream-ordered [{ envelopeKey, constituents:[{ concept, forgeCost?=1, leafKey }] }]
 *                     — one entry per whole-task instance of the candidate composite. `envelopeKey` = the composite's typed
 *                     input digest (the K1 envelope); `leafKey` = a constituent's STANDALONE memo key; `forgeCost` = model
 *                     calls a cold constituent costs (0 = a cheap deterministic autoflag).
 * @param opts.bloat   library overhead charged against the saving (default 0).
 * @returns { net, pays, leafFloorForges, compositeForges, bloat, n, perConstituent:[{ concept, forgeCost, n, leafMisses,
 *            leafMissRate, band }] }  — band ∈ 'payer-interior' (forge-costly ∧ leaf-unstable) | 'leaf-floored'
 *            (forge-costly ∧ leaf-stable) | 'cheap' (forgeCost 0).
 */
function costProbe( occurrences, opts ) {
	opts = opts || {};
	var bloat = opts.bloat || 0;
	var seenLeaf = Object.create(null), seenEnv = Object.create(null);
	var leafFloorForges = 0, compositeForges = 0, saved = 0;
	var per = Object.create(null);

	for ( var o = 0; o < (occurrences || []).length; o++ ) {
		var occ = occurrences[o];
		var envNew = !seenEnv[occ.envelopeKey];
		if ( envNew ) seenEnv[occ.envelopeKey] = true;
		var cons = occ.constituents || [];
		for ( var i = 0; i < cons.length; i++ ) {
			var k = cons[i], cost = k.forgeCost == null ? 1 : k.forgeCost;
			var leafNew = !seenLeaf[k.leafKey];
			if ( leafNew ) seenLeaf[k.leafKey] = true;
			if ( leafNew ) leafFloorForges += cost;                          // the leaf memo must forge a new leaf
			if ( leafNew && envNew ) compositeForges += cost;                // the composite memo forges only on a new envelope
			if ( leafNew && !envNew ) saved += cost;                         // the payer event: leaf missed BUT the composite hit
			var p = per[k.concept] || (per[k.concept] = { concept: k.concept, forgeCost: cost, n: 0, leafMisses: 0 });
			p.n++; if ( leafNew ) p.leafMisses++;
		}
	}
	var perConstituent = Object.keys(per).map(function ( c ) {
		var p = per[c], rate = p.n ? p.leafMisses / p.n : 0;
		p.leafMissRate = rate;
		p.band = p.forgeCost === 0 ? 'cheap' : (rate > 0.5 ? 'payer-interior' : 'leaf-floored');
		return p;
	});
	var net = saved - bloat;
	return { net: net, pays: net > 0, saved: saved, leafFloorForges: leafFloorForges, compositeForges: compositeForges,
		bloat: bloat, n: (occurrences || []).length, perConstituent: perConstituent };
}

// the go/no-go boolean for BUILDING compress.js on a candidate: does a composite-memo strictly out-elide the leaf floor?
function paysToCompress( occurrences, opts ) { return costProbe(occurrences, opts).pays; }

module.exports = { costProbe: costProbe, paysToCompress: paysToCompress };
