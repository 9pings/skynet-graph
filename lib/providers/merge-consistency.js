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
 * Merge-consistency operator — the consistency radius ε (the sheaf C1 gluing brick;
 * docs/WIP/HANDOFF.md §7 Tier 1; SOTA subgraph-grammars C1; experiment E6). Zero core change.
 *
 * NRG already had the other two sheaf conditions at the sub-graph frontier: C2 (the
 * commutative log-odds monoid = separation) and C3 (recombine-the-continuous-partials-
 * THEN-snap, E4). The missing one was C1 (coherent restrictions). The reason it matters,
 * shown decisively in E6: the monoid combine collapses two opposite epistemic states to
 * the SAME certainty —
 *   - two confident sources that DISAGREE   ℓ=(+2.5,−2.5) -> Σℓ=0 -> κ=0.5
 *   - two genuinely NEUTRAL sources         ℓ=(+0.1,−0.1) -> Σℓ=0 -> κ=0.5
 * identical κ=0.5, opposite meaning. The combine alone LOSES the disagreement. The
 * consistency radius ε = the spread of the partials in log-odds (max−min; = |ℓ_A−ℓ_B|
 * for two) is the missing dimension. Exposed as a SNAPPED typed fact `mergeConsistency`
 * (barrier-clean enum, never a raw float on a gate), a pure-D `Reconcile` concept can
 * fire/audit on the conflict band. C1 is, in clear, "a fact + a gate."
 *
 *   const { createConsistency, consistencyConceptTree } = require('./merge-consistency');
 *   register(Graph, [ createConsistency() ]);                 // wires Merge::combine
 *   // a ready-made audited contract (Combine crosses + snaps; Reconcile gates on conflict):
 *   const tree = consistencyConceptTree({ partials: ['ellA', 'ellB'] });
 *
 * Combine the CONTINUOUS partials and compute ε BEFORE snapping (correction #6 / E4) — snap
 * first and you lose evidence (two partials that each round down sum higher than their
 * rounded sum). The crossing fact at the frontier is the continuous log-odds; only the
 * snapped enum is consumed by a gate.
 */

function sigmoid( x ) { return 1 / (1 + Math.exp(-x)); }

// Default consistency-radius bands on ε (log-odds disagreement): agree <1, borderline <3,
// conflict ≥3. A band with no `max` is the catch-all (largest disagreement). Override via opts.bands.
var DEFAULT_BANDS = [
	{ max: 1, label: 'agree', rank: 0 },
	{ max: 3, label: 'borderline', rank: 1 },
	{ label: 'conflict', rank: 2 }
];

// Snap a disagreement ε to its band { rank, label }. The first band whose `max` ε is under
// wins; a maxless band is the catch-all.
function bandOf( eps, bands ) {
	bands = bands || DEFAULT_BANDS;
	for ( var i = 0; i < bands.length; i++ )
		if ( bands[i].max == null || eps < bands[i].max ) return { rank: bands[i].rank, label: bands[i].label };
	var last = bands[bands.length - 1];
	return { rank: last.rank, label: last.label };
}

/**
 * The C1 operator: combine N log-odds partials and expose the consistency radius ε.
 * @param partials   array of log-odds numbers (non-finite entries ignored)
 * @param opts.bands custom band table (default DEFAULT_BANDS)
 * @returns { ell, kappa, eps, rank, label, n }
 *   ell   = Σ partials (the commutative monoid combine)
 *   kappa = σ(ell)     (the recombined certainty)
 *   eps   = max−min    (the disagreement; 0 for a single partial)
 *   rank/label = the snapped consistency band (the barrier-clean enum)
 */
function mergeConsistency( partials, opts ) {
	opts = opts || {};
	var xs = (partials || []).map(Number).filter(function ( x ) { return isFinite(x); });
	var ell = xs.reduce(function ( s, w ) { return s + w; }, 0);
	var eps = xs.length ? Math.max.apply(null, xs) - Math.min.apply(null, xs) : 0;
	var b = bandOf(eps, opts.bands);
	return { ell: ell, kappa: sigmoid(ell), eps: eps, rank: b.rank, label: b.label, n: xs.length };
}

/**
 * Build the merge-consistency provider fragment (host opt-in, like createVerifier).
 * @param opts.bands  default band table for every Merge::combine apply (per-concept override
 *                    via the concept's `merge.bands`).
 * @returns { Merge: { combine } }
 *
 * Concept wiring (the Combine concept at a merge frontier):
 *   { require:['ellA','ellB'], provider:['Merge::combine'],
 *     merge: { partials:['ellA','ellB'], as:'' } }
 * Emits the self-flag + <as>ell / <as>kappa / <as>eps / <as>mergeConsistency (enum) /
 * <as>mergeConsistencyRank. Reads each partial via getRef (a key on the merge target).
 */
function createConsistency( opts ) {
	opts = opts || {};
	var defaultBands = opts.bands;
	return {
		Merge: {
			combine: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({}, concept._schema && concept._schema.merge, argz && argz[0]),
				    prefix = cfg.as || '',
				    keys = cfg.partials || [],
				    xs = keys.map(function ( k ) { return Number(graph.getRef(k, scope)); }),
				    r = mergeConsistency(xs, { bands: cfg.bands || defaultBands }),
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[prefix + 'ell'] = r.ell;
				facts[prefix + 'kappa'] = r.kappa;
				facts[prefix + 'eps'] = r.eps;
				facts[prefix + 'mergeConsistency'] = r.label;     // snapped enum — barrier-clean
				facts[prefix + 'mergeConsistencyRank'] = r.rank;
				cb(null, facts);
			}
		}
	};
}

/**
 * A ready-made audited merge-projection contract as a concept-tree fragment: a `Combine`
 * concept that crosses the continuous partials and snaps ε, with a pure-D `Reconcile` gate
 * nested under it that casts ONLY in the conflict band (so the D grammar can react/audit).
 * @param opts.partials      partial-fact keys to combine (default ['ellA','ellB'])
 * @param opts.require       Combine's require keys (default = the partials)
 * @param opts.conflictRank  Reconcile's gate threshold on the snapped rank (default 2 = conflict)
 * @param opts.as            output-fact prefix (default '')
 */
function consistencyConceptTree( opts ) {
	opts = opts || {};
	var partials = opts.partials || ['ellA', 'ellB'],
	    as = opts.as || '',
	    rank = opts.conflictRank == null ? 2 : opts.conflictRank;
	return {
		childConcepts: {
			Combine: {
				_id: 'Combine', _name: 'Combine',
				require: opts.require || partials.slice(),
				provider: ['Merge::combine'],
				merge: { partials: partials, as: as },
				childConcepts: {
					Reconcile: {
						_id: 'Reconcile', _name: 'Reconcile',
						require: ['Combine'],
						ensure: ['$' + as + 'mergeConsistencyRank>=' + rank]
					}
				}
			}
		}
	};
}

module.exports = {
	mergeConsistency: mergeConsistency,
	bandOf: bandOf,
	sigmoid: sigmoid,
	DEFAULT_BANDS: DEFAULT_BANDS,
	createConsistency: createConsistency,
	consistencyConceptTree: consistencyConceptTree
};
