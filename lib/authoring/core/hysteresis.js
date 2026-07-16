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
 * Hysteresis dead-band for the grain split/merge loop (doc/WIP/HANDOFF.md §7 Tier 3 P3;
 * experiment C). Zero core change — a host-side decision helper for a supervisor's injected
 * `evaluate` hook (lib/authoring/supervise.js).
 *
 * The problem (C probe): adopting a finer grain when a hold-out score improves, and reverting
 * when it regresses, OSCILLATES across episodes if the keep/revert decision uses a SINGLE
 * fixed margin and the re-evaluation variance exceeds it (the probe flipped 31/60 with a fixed
 * margin < noise). What terminates is a HYSTERESIS dead-band: a high bar to ADOPT the finer
 * grain (`keepThreshold`) and a separate bar to REVERT it (`mergeThreshold`), with the band
 * between them sized to ≥ ~3σ of the re-eval variance — plus an idempotent "grain in force"
 * marker so a settled grain stops re-triggering. Then steady-state flips → 0.
 *
 * HONEST: this is a statistical contraction, NOT a formal termination proof (an adversarial
 * hold-out with unbounded between-episode variance can still cross any finite band). It is the
 * available zero-core mitigation; a formal cross-episode guarantee is open R&D.
 *
 *   const { makeHysteresis, bandFromSigma } = require('../core/hysteresis.js');
 *   const h = makeHysteresis({ keepThreshold: bandFromSigma(reEvalSigma), betterIsLower: true });
 *   const action = h.decide(candidateScore, baselineScore, currentRegime);  // 'adopt' | 'revert' | 'hold'
 */

/** A ≥k·σ dead-band from an estimate of the re-evaluation std-dev (k defaults to 3, per C). */
function bandFromSigma( sigma, k ) {
	return (k == null ? 3 : k) * (sigma || 0);
}

/**
 * Build a hysteresis decision function.
 * @param opts.keepThreshold    the minimum GAIN to ADOPT the finer grain from 'coarse' (default 1).
 * @param opts.mergeThreshold   the minimum REGRESSION to REVERT from 'fine' (default = keepThreshold;
 *                              keeping it ≥ keepThreshold makes the dead-band ≥ keepThreshold wide).
 * @param opts.betterIsLower    true (default) when a LOWER score is better (deviance/MSE/loss);
 *                              false for higher-is-better (accuracy/reward).
 * @returns { decide(candidate, baseline, regime), gain(candidate, baseline), keepThreshold, mergeThreshold }
 */
function makeHysteresis( opts ) {
	opts = opts || {};
	var keep = opts.keepThreshold == null ? 1 : opts.keepThreshold;
	var merge = opts.mergeThreshold == null ? keep : opts.mergeThreshold;
	var lower = opts.betterIsLower !== false;

	// how much BETTER candidate is than baseline (positive = better), in either polarity
	function gain( candidate, baseline ) {
		return lower ? (baseline - candidate) : (candidate - baseline);
	}

	return {
		keepThreshold: keep,
		mergeThreshold: merge,
		gain: gain,
		/**
		 * Decide from the CURRENT regime:
		 *   'coarse' — considering adopting the finer grain: 'adopt' iff gain ≥ keepThreshold, else 'hold'.
		 *   'fine'   — considering reverting: 'revert' iff the finer grain REGRESSED by ≥ mergeThreshold
		 *              (gain ≤ −mergeThreshold), else 'hold'.
		 * The gap (−mergeThreshold, keepThreshold) is the dead-band where nothing changes.
		 */
		decide: function ( candidate, baseline, regime ) {
			var g = gain(candidate, baseline);
			if ( regime === 'fine' ) return g <= -merge ? 'revert' : 'hold';
			return g >= keep ? 'adopt' : 'hold';
		}
	};
}

module.exports = { makeHysteresis: makeHysteresis, bandFromSigma: bandFromSigma };
