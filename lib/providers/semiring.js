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
 * Semiring-parameterized accumulation — D and P are ONE forward-chaining machine
 * parameterized by the certainty semiring (doc/WIP/HANDOFF.md §7 Tier 2; SOTA
 * subgraph-grammars: provenance semirings, Green-Tannen 2007; experiments E1/E4). Zero
 * core change: it packages the coherence-theorem-validated commutative-monoid REDUCE
 * (E1: fold `{__push}`ed contributions after quiescence; order-independence ⟺ the combine
 * is a commutative monoid) as a reusable provider whose `⊕`/identity/readout you choose:
 *
 *   - `boolean` (the D socle):     ⊕ = OR,  readout = identity   -> "does ANY contribution hold"
 *   - `logodds` (the P layer):     ⊕ = +,   readout = σ          -> certainty accumulation (E1/E4)
 *   - `maxplus` (best-path):       ⊕ = max, readout = identity   -> Viterbi / longest-evidence
 *   - `probor`  (noisy-OR):        ⊕ = a+b−ab on [0,1]           -> independent-evidence OR
 *
 * The same engine, the same fold-after-quiescence, a different algebra — adding a same-family
 * regime is "declare a semiring", not a core change. Keep `⊕` a COMMUTATIVE monoid or the
 * result depends on the (non-semantic) scheduler order (E1: monoid variance ≈0 vs a
 * non-commutative combine ranging [−0.41, 1.06] on the SAME contributions).
 *
 *   const { createSemiring, semiringConceptTree } = require('./semiring');
 *   register(Graph, [ createSemiring() ]);   // wires Semiring::reduce
 *
 * Contributions arrive via the race-free `{__push}` primitive into an array fact; a `Reduce`
 * concept gated `ensure:["$contribs.length==$expected"]` (the proven completion gate) folds
 * them after the stratum is quiescent — same shape as verify's Vote::tally and stats' grandMean.
 */

var mc = require('./merge-consistency');
var sigmoid = mc.sigmoid, bandOf = mc.bandOf;

// Built-in commutative semirings: { plus, zero, times, one, readout }. `plus`/`zero` drive the
// REDUCE; `times`/`one` are the ⊗ for combining along a path (exposed for completeness).
var SEMIRINGS = {
	boolean: { plus: function ( a, b ) { return !!(a || b); }, zero: false, times: function ( a, b ) { return !!(a && b); }, one: true,  readout: function ( x ) { return x; } },
	logodds: { plus: function ( a, b ) { return a + b; },      zero: 0,     times: function ( a, b ) { return a + b; },      one: 0,     readout: sigmoid },
	maxplus: { plus: function ( a, b ) { return Math.max(a, b); }, zero: -Infinity, times: function ( a, b ) { return a + b; }, one: 0, readout: function ( x ) { return x; } },
	probor:  { plus: function ( a, b ) { return a + b - a * b; }, zero: 0,  times: function ( a, b ) { return a * b; },      one: 1,     readout: function ( x ) { return x; } }
};

function resolveSemiring( sr ) {
	if ( !sr ) return SEMIRINGS.logodds;
	return typeof sr === 'string' ? (SEMIRINGS[sr] || SEMIRINGS.logodds) : sr;
}

/**
 * Fold a list of contributions under a semiring's ⊕ (commutative -> order-independent), then
 * apply the readout. The accumulation is the abstract value; the readout is the observable.
 * @param values  the contributions (`{__push}`ed)
 * @param sr      a built-in name or a `{ plus, zero, readout }` object (default 'logodds')
 * @returns { acc, value, n }  acc = Σ⊕ contributions, value = readout(acc)
 */
function reduceSemiring( values, sr ) {
	sr = resolveSemiring(sr);
	var xs = values || [], acc = sr.zero;
	for ( var i = 0; i < xs.length; i++ ) acc = sr.plus(acc, xs[i]);
	return { acc: acc, value: sr.readout ? sr.readout(acc) : acc, n: xs.length };
}

/**
 * Build the semiring reducer provider fragment (host opt-in, like createVerifier).
 * @param opts.semirings  extra named semirings merged over the built-ins.
 * @returns { Semiring: { reduce } }
 *
 * Concept wiring:
 *   { require:['Pool'], ensure:['$contribs.length==$expected'], provider:['Semiring::reduce'],
 *     semiring:{ contribKey:'contribs', semiring:'logodds', as:'', bands:<optional> } }
 * Emits the self-flag + <as>acc (the ⊕-fold) + <as>value (readout) + <as>n, and — when a
 * `bands` table is given — a SNAPPED <as>band / <as>bandRank (barrier-clean enum to gate on).
 */
function createSemiring( opts ) {
	opts = opts || {};
	var registry = Object.assign({}, SEMIRINGS, opts.semirings);
	return {
		Semiring: {
			reduce: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ contribKey: 'contribs', semiring: 'logodds', as: '' },
					concept._schema && concept._schema.semiring, argz && argz[0]),
				    sr = typeof cfg.semiring === 'string' ? (registry[cfg.semiring] || SEMIRINGS.logodds) : cfg.semiring,
				    vals = graph.getRef(cfg.contribKey, scope) || [],
				    r = reduceSemiring(vals, sr),
				    as = cfg.as || '',
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[as + 'acc'] = r.acc;
				facts[as + 'value'] = r.value;
				facts[as + 'n'] = r.n;
				if ( cfg.bands ) {                       // optional snapped readout (barrier-clean enum)
					var b = bandOf(r.value, cfg.bands);
					facts[as + 'band'] = b.label;
					facts[as + 'bandRank'] = b.rank;
				}
				cb(null, facts);
			}
		}
	};
}

/**
 * A ready-made reducer concept fragment: contributions `{__push}` into `contribKey`, and a
 * `Reduce` concept folds them under the semiring once the cardinality gate is satisfied.
 * @param opts.semiring   built-in name or a semiring object (default 'logodds')
 * @param opts.contribKey the pushed-contributions array fact (default 'contribs')
 * @param opts.require    Reduce's require (default ['Pool'])
 * @param opts.as         output prefix
 * @param opts.bands      optional snapped-band table
 */
function semiringConceptTree( opts ) {
	opts = opts || {};
	var contribKey = opts.contribKey || 'contribs',
	    semiring = { contribKey: contribKey, semiring: opts.semiring || 'logodds', as: opts.as || '' };
	if ( opts.bands ) semiring.bands = opts.bands;
	return {
		childConcepts: {
			Reduce: {
				_id: 'Reduce', _name: 'Reduce',
				require: opts.require || ['Pool'],
				ensure: ['$' + contribKey + '.length==$expected'],
				provider: ['Semiring::reduce'],
				semiring: semiring
			}
		}
	};
}

module.exports = {
	SEMIRINGS: SEMIRINGS,
	reduceSemiring: reduceSemiring,
	createSemiring: createSemiring,
	semiringConceptTree: semiringConceptTree
};
