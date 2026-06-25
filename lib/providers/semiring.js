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

// ---- Pareto / skyline selection (the multi-criteria SELECT operator for the support grammar's
// Candidate/Selected cluster). Laurie's framing: skyline-of-union is an IDEMPOTENT COMMUTATIVE
// MONOID, so it folds in reduceSemiring exactly like any semiring and inherits E1 order-
// independence; criteria scored on DISCRETE BAND RANKS keep dominance deterministic & memoizable
// (the float skyline is fragile — re-keys the K1 memo) and bound the front size. ----

// Rank of a value under a criterion spec — HIGHER RANK = BETTER, always (polarity folded in here,
// so dominance never silently selects the worst). A spec is either an ORDERED band list worst→best
// (the order IS the preference direction) or { dir:'max'|'min' } for a numeric criterion. A
// missing/unknown band ranks below all, so it never spuriously dominates.
function rankOf( value, spec ) {
	if ( Array.isArray(spec) ) { var i = spec.indexOf(value); return i < 0 ? -1 : i; }
	if ( spec && spec.order ) { var j = spec.order.indexOf(value); return j < 0 ? -1 : j; }
	var n = Number(value);
	if ( !isFinite(n) ) return -Infinity;
	return (spec && spec.dir === 'min') ? -n : n;     // min: lower is better -> negate
}

// Strict Pareto dominance: a ≥ b on EVERY criterion AND > on at least one. Strict (not weak), so
// mutually-equal points do NOT dominate each other — ties are kept.
function dominates( a, b, criteria ) {
	var keys = Object.keys(criteria), strictly = false;
	for ( var i = 0; i < keys.length; i++ ) {
		var ra = rankOf(a[keys[i]], criteria[keys[i]]), rb = rankOf(b[keys[i]], criteria[keys[i]]);
		if ( ra < rb ) return false;
		if ( ra > rb ) strictly = true;
	}
	return strictly;
}

// The skyline: points not strictly dominated by any other. Stable (input order preserved); ties
// all kept. O(n²·d) block-nested-loop — trivial at this scale (a handful of candidates); no index
// or pre-sort is justified.
function paretoFront( points, criteria ) {
	var pts = points || [], out = [];
	for ( var i = 0; i < pts.length; i++ ) {
		var dominated = false;
		for ( var j = 0; j < pts.length; j++ )
			if ( i !== j && dominates(pts[j], pts[i], criteria) ) { dominated = true; break; }
		if ( !dominated ) out.push(pts[i]);
	}
	return out;
}

// Étage-2 tie-break: lexicographic by DESCENDING rank along a criterion-priority list.
function lexCompare( a, b, criteria, lex ) {
	for ( var i = 0; i < lex.length; i++ ) {
		var d = rankOf(b[lex[i]], criteria[lex[i]]) - rankOf(a[lex[i]], criteria[lex[i]]);   // desc = better first
		if ( d ) return d;
	}
	return 0;
}

// Pareto SELECT = étage 1 (front, no weighting) + étage 2 (tie-break, default lexicographic on the
// criteria order; a custom `opts.tieBreak(a,b)` overrides), with a FINAL deterministic id tie-break
// so the pick is reproducible run-to-run (a hard tie must not depend on iteration order). idKey='id'.
function paretoSelect( points, criteria, opts ) {
	opts = opts || {};
	var idKey = opts.idKey || 'id',
	    lex   = opts.lex || Object.keys(criteria),
	    cmp   = opts.tieBreak || function ( a, b ) { return lexCompare(a, b, criteria, lex); },
	    front = paretoFront(points, criteria),
	    ranked = front.slice().sort(function ( a, b ) {
		    return cmp(a, b) || String(a[idKey]).localeCompare(String(b[idKey]));
	    }),
	    selected = ranked[0] || null;
	return {
		front     : front,
		frontIds  : front.map(function ( p ) { return p[idKey]; }),
		ranked    : ranked,
		selected  : selected,
		selectedId: selected ? selected[idKey] : null,
		n         : (points || []).length
	};
}

// Pareto AS A SEMIRING for reduceSemiring: plus = skyline(front ∪ {point}) RECOMPUTED (never an
// incremental shortcut — that would break associativity → E1 order-independence), zero = ∅,
// readout = the front. So `reduceSemiring(points, makePareto(crit)).value` is the order-invariant skyline.
function makePareto( criteria ) {
	return {
		plus   : function ( front, point ) { return paretoFront(front.concat([point]), criteria); },
		zero   : [],
		readout: function ( front ) { return front; }
	};
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
				    vals = graph.getRef(cfg.contribKey, scope) || [],
				    as = cfg.as || '',
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;

				// pareto family: multi-criteria SELECT (front + tie-break). Emits a barrier-clean
				// discrete selectedId + the front ids (NOT the candidate objects) for the cluster to gate on.
				if ( cfg.semiring === 'pareto' ) {
					var sel = paretoSelect(vals, cfg.criteria || {}, { idKey: cfg.idKey, lex: cfg.lex, tieBreak: cfg.tieBreak });
					facts[as + 'selectedId'] = sel.selectedId;
					facts[as + 'frontSize'] = sel.front.length;
					facts[as + 'frontIds'] = sel.frontIds;
					facts[as + 'n'] = sel.n;
					return cb(null, facts);
				}

				var sr = typeof cfg.semiring === 'string' ? (registry[cfg.semiring] || SEMIRINGS.logodds) : cfg.semiring,
				    r = reduceSemiring(vals, sr);
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

/**
 * A ready-made multi-criteria SELECT concept (the support grammar's Candidate→Selected step, J2):
 * candidate vectors `{__push}` into `contribKey`, and a `Select` concept folds them with the `pareto`
 * semiring once the cardinality gate holds — emitting the Pareto front + a deterministic lexicographic
 * pick (`selectedId`). Same shape as semiringConceptTree, specialized to the pareto family.
 * @param opts.criteria   {name: bandList|{dir}} the comparison criteria (REQUIRED to be useful)
 * @param opts.lex        criterion-priority order for the tie-break (default: criteria key order)
 * @param opts.idKey      candidate id key (default 'id')
 * @param opts.contribKey pooled-candidates array fact (default 'candidates')
 * @param opts.require    Select's require (default ['Pool'])
 * @param opts.as         output prefix
 */
function selectConceptTree( opts ) {
	opts = opts || {};
	var contribKey = opts.contribKey || 'candidates',
	    semiring = { contribKey: contribKey, semiring: 'pareto', criteria: opts.criteria || {}, as: opts.as || '' };
	if ( opts.lex ) semiring.lex = opts.lex;
	if ( opts.idKey ) semiring.idKey = opts.idKey;
	return {
		childConcepts: {
			Select: {
				_id: 'Select', _name: 'Select',
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
	semiringConceptTree: semiringConceptTree,
	selectConceptTree: selectConceptTree,
	// Pareto / skyline selection (the multi-criteria SELECT operator; a semiring that folds in reduceSemiring)
	rankOf: rankOf,
	dominates: dominates,
	paretoFront: paretoFront,
	lexCompare: lexCompare,
	paretoSelect: paretoSelect,
	makePareto: makePareto
};
