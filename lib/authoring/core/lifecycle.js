/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * lifecycle — the UNIFIED plasticity ledger (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-26-…, pass 4).
 *
 * Every concept (a mined mini-NN, an LLM-calling expert, a hand-written rule) carries ONE
 * scalar — its **plasticity** p ∈ [0,1] — the unified creativity/learning knob:
 *   p = 1  fully plastic   — learning ON / high creativity (NN: noise+lr; LLM: high temperature)
 *   p = 0  frozen          — deterministic, memo-perfect, the consolidated spine (temperature 0)
 *   0<p<1  partial          — the "personality" regime (some creativity retained)
 * The discrete regimes {plastic, probationary, frozen} are just the rounding/banding of p.
 *
 * Consolidation = Complementary-Learning-Systems annealing: a concept is born plastic and p
 * decays toward 0 as its reliability is PROVEN (the success of the derivations it's in, snapped
 * to a band via stats.bandOf). A concept that doesn't prove out stays plastic (keeps exploring);
 * a proven one freezes (joins the stable, auditable, memo-hot spine).
 *
 * DISCIPLINE (K1): plasticity lives HERE, in the ledger — it MODULATES a provider (temperature,
 * learning-rate, exploration noise) and the host's promotion decisions; it is NEVER a fact that
 * gates applicability (a continuous gate would churn the memo). And `record(name, ok)` takes the
 * GENUINE outcome — a retraction that was the intended iterative trial (#15) is not a failure;
 * the host decides `ok`, the ledger only tallies.
 *
 *   const lc = createLifecycle();
 *   lc.register('Crystal_A_B');            // born plastic
 *   lc.record('Crystal_A_B', verifiedOk);  // each verified outcome anneals p
 *   const temp = lc.plasticity('Crystal_A_B');  // thread into the provider (LLM temp / NN noise)
 */
const { bandOf } = require('../../providers/stats.js');

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function createLifecycle( opts ) {
	opts = opts || {};
	const minTrials = opts.minTrials == null ? 2 : opts.minTrials;  // explore until there's evidence
	const maxRank   = opts.maxRank == null ? 3 : opts.maxRank;       // bandOf's top rank (certain)
	const bands     = opts.bands;
	// Default anneal: plastic (1) until enough trials, then p decays with the snapped reliability
	// band — unproven/low stays plastic, 'certain' freezes (p=0). Override via opts.anneal(rep).
	const anneal = opts.anneal || function ( rep ) {
		if ( rep.trials < minTrials ) return 1;
		return clamp01(1 - rep.rank / maxRank);
	};

	const led = {};   // name -> { successes, trials, p }

	function rep( name ) {
		const e = led[name] || { successes: 0, trials: 0 };
		const theta = e.trials ? e.successes / e.trials : 0;
		const b = bandOf(theta, bands);
		return { successes: e.successes, trials: e.trials, theta: theta, rank: b.rank, label: b.label };
	}

	return {
		/** Register a concept — born fully plastic (p=1) unless opts.p0 given. */
		register: function ( name, o ) { led[name] = { successes: 0, trials: 0, p: (o && o.p0 != null) ? clamp01(o.p0) : 1 }; return this; },
		/** Record a GENUINE outcome; re-anneals plasticity. */
		record: function ( name, ok ) {
			const e = led[name] || (led[name] = { successes: 0, trials: 0, p: 1 });
			e.trials++; if ( ok ) e.successes++;
			e.p = anneal(rep(name));
			return this;
		},
		/** The unified plasticity knob p∈[0,1] (default 1 for an unknown concept). */
		plasticity: function ( name ) { return led[name] ? led[name].p : 1; },
		/** The rounded regime of p — a convenience view, not a separate state. */
		regime: function ( name ) { const p = this.plasticity(name); return p >= 0.75 ? 'plastic' : p < 0.25 ? 'frozen' : 'probationary'; },
		/** {successes, trials, theta, rank, label} — the evidence behind p. */
		reputation: function ( name ) { return rep(name); },
		/** Snapshot of the whole pool. */
		all: function () { const o = {}; for ( const k in led ) o[k] = { p: led[k].p, regime: this.regime(k), reputation: rep(k) }; return o; },
	};
}

module.exports = { createLifecycle };
