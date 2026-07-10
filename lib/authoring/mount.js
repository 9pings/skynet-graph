/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * mount — the 3-REGIME MOUNT POLICY (host-side meta-controller, ZERO-CORE). U2 / master-graph study §2.x.
 *
 * A learned method can be MOUNTED three ways; the controller picks one by (depth, efficiency, reliability),
 * with HYSTERESIS (banded promote/demote so it doesn't flap) and a well-founded MOUNT-RANK whose bottom is
 * the K1 "stay-in-LLM" floor (termination of the adapt loop). The regimes:
 *
 *   - INSTANCE (fork-per-case)   — the SAFE DEFAULT. Each case in its own world (single-world JTMS forces
 *                                  this for unproven / write-frontier methods). Always sound.
 *   - INLINE (addConcept)        — mount into the live graph. Sound ONLY for a READ-ONLY frontier (confluence
 *                                  is undecidable; an inline write-frontier method can race consumers).
 *                                  Restricted to shallow, proven, read-only-frontier methods.
 *   - FROZEN (warm-cache replay) — a proven, "dry" method replayed from the warm cache + a deopt-guard
 *                                  (NOT a stabilization-skipping executor — §2 Correction 2). The cheapest.
 *   - ESCALATE (stay in the LLM) — the floor: a method that has DEOPTed K times is demoted off the library
 *                                  and always re-forged/escalated. This is the well-founded bottom (K1).
 *
 * MOUNT-RANK μ = (deoptBudget, …): each deopt strictly decrements deoptBudget; at 0 the method is pinned to
 * ESCALATE. So the collapse→re-forge→re-mount loop cannot cycle forever — it descends to the LLM floor in
 * ≤K deopts (HotSpot/PyPy deopt-pinning, Hölzle-Chambers-Ungar 1992; Bolz et al. 2009). A success replenishes
 * nothing automatically (demotion is sticky until an explicit re-admit), so μ is monotone non-increasing.
 *
 *   const ctl = createMountController();
 *   ctl.decide('M_AB', { reliability: 0.9, hitRate: 0.95, depth: 1, readOnlyFrontier: true });  // -> 'frozen'
 *   ctl.recordDeopt('M_AB');  // a guaranteeing value drifted → partial-collapse + re-forge; budget--
 */

const DEFAULTS = {
	maxDeopt: 3,              // K: deopts before a method is pinned to ESCALATE (the floor)
	freezeHi: 0.85, freezeLo: 0.70,   // hysteresis band for FROZEN (promote at Hi, demote below Lo)
	inlineHi: 0.65, inlineLo: 0.50,   // hysteresis band for INLINE
	inlineMaxDepth: 1,       // INLINE only for shallow methods (deep → fork, to bound context at the join)
	widenCap: 5              // §6.4: the megamorphic WIDTH cap — distinct widens before a method degrades to ESCALATE
};

// Pure classifier: given signals + the CURRENT regime (for hysteresis), pick the regime. No state.
function classify( signals, current, t ) {
	t = Object.assign({}, DEFAULTS, t || {});
	const s = signals || {};
	const score = Math.min(s.reliability == null ? 0 : s.reliability, s.hitRate == null ? (s.reliability || 0) : s.hitRate);
	const readOnly = !!s.readOnlyFrontier;
	const depth = s.depth == null ? 99 : s.depth;

	if ( (s.deoptCount || 0) >= t.maxDeopt ) return 'escalate';           // the K1 floor (absorbing)

	// FROZEN — proven + dry + read-only frontier. Hysteresis: promote at freezeHi; once frozen, hold until <freezeLo.
	const freezeThresh = (current === 'frozen') ? t.freezeLo : t.freezeHi;
	if ( readOnly && score >= freezeThresh ) return 'frozen';

	// INLINE — shallow + read-only frontier + moderately proven (confluence: read-only only).
	const inlineThresh = (current === 'inline') ? t.inlineLo : t.inlineHi;
	if ( readOnly && depth <= t.inlineMaxDepth && score >= inlineThresh ) return 'inline';

	// INSTANCE — the safe default for everything else (unproven, deep, or write-frontier).
	return 'instance';
}

function createMountController( opts ) {
	opts = opts || {};
	const t = Object.assign({}, DEFAULTS, opts.thresholds || {});
	const state = new Map();   // methodId -> { regime, deoptCount }

	function get( id ) { if ( !state.has(id) ) state.set(id, { regime: 'instance', deoptCount: 0, widenCount: 0 }); return state.get(id); }

	return {
		thresholds: t,
		/** decide (and remember) the regime for a method given live signals; applies hysteresis + the deopt floor. */
		decide( id, signals ) {
			const st = get(id);
			const sig = Object.assign({ deoptCount: st.deoptCount }, signals || {});
			const regime = classify(sig, st.regime, t);
			st.regime = regime;
			return { regime, deoptCount: st.deoptCount, reason: reasonFor(regime, sig, t) };
		},
		/** a guaranteeing value drifted → the method DEOPTs (partial-collapse + re-forge). Decrements μ. */
		recordDeopt( id ) {
			const st = get(id);
			st.deoptCount++;
			if ( st.deoptCount >= t.maxDeopt ) st.regime = 'escalate';   // pinned to the floor
			return st.deoptCount;
		},
		/**
		 * §6.4 — a method's pre was WIDENED (the S-boundary climbed). This is a SUCCESS, NOT a deopt:
		 *   • it DEMOTES FROZEN→INSTANCE (G2 — the newly-admitted cases must re-hit `assertPost`; the caller MUST call
		 *     this BEFORE issuing the gate-relax `patchConcept` so the relaxed gate never admits a case under a frozen regime);
		 *   • it consumes its OWN megamorphic WIDTH budget (PIC degradation, Hölzle-Chambers-Ungar 1991/92), NEVER μ —
		 *     a healthy generalizer must not be pinned to the deopt floor with zero failures. At `widenCap` distinct
		 *     widens the method is too polymorphic to be a useful specialization → ESCALATE (degrade to generic).
		 */
		recordWiden( id ) {
			const st = get(id);
			const demotedFrom = st.regime;
			if ( st.regime === 'frozen' ) st.regime = 'instance';        // G2: re-guard with assertPost (never elide on widened cases)
			st.widenCount++;
			if ( st.widenCount >= t.widenCap ) st.regime = 'escalate';   // megamorphic width cap (NOT μ)
			return { regime: st.regime, widenCount: st.widenCount, demotedFrom };
		},
		regimeOf( id ) { return get(id).regime; },
		deoptBudget( id ) { return Math.max(0, t.maxDeopt - get(id).deoptCount); },   // the well-founded rank μ (deopts only)
		widenBudget( id ) { return Math.max(0, t.widenCap - get(id).widenCount); },   // §6.4 — the megamorphic width budget
		state
	};
}

function reasonFor( regime, s, t ) {
	if ( regime === 'escalate' ) return `deopt floor (${s.deoptCount}/${t.maxDeopt}) — stay in the LLM`;
	if ( regime === 'frozen' ) return 'proven + dry + read-only frontier → warm-cache replay';
	if ( regime === 'inline' ) return 'shallow + read-only frontier + proven → addConcept';
	return 'unproven / deep / write-frontier → fork-per-case (safe default)';
}

module.exports = { createMountController, classify, DEFAULTS };
