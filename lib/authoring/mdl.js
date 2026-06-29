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
 * mdl — a STATIC, corpus-level, bits-based MDL admission objective for grammar induction
 * (#12, the §4.2-A front-end). The cheap pre-filter/ranker IN FRONT OF the empirical gate
 * (`abstraction.evaluate`), NEVER a replacement.
 *
 * Where `evaluate` BOOTS the engine twice per candidate on ONE seed (grounded but expensive,
 * single-episode, can over-fit a seed), `mdl` is O(corpus) arithmetic with NO boot: it
 * aggregates the co-firing `count` mined across EVERY episode, so it ranks GENERALITY and
 * prunes the many `mineChains` candidates BEFORE any boot. The one-criterion unification
 * (Minton speedup ≡ SEQUITUR rule-utility ≡ smallest-grammar MDL ≡ Lari-Young weights).
 *
 * Two-part code length  L = L(library) + L(corpus | library):
 *   - L(library)        = Σ_c schemaBits(c)               — bits to DESCRIBE the grammar
 *   - L(corpus|library) = R · log2(N)                     — bits to PARSE the corpus (R records,
 *                                                           each names one of N concepts)
 * Promote a chain A→…→B (length ℓ, co-firing `count`) iff it shrinks total L:
 *   savedBits = count·(ℓ−1)·log2(N)   each co-firing now names 1 abstract, not ℓ constituents
 *   encodeBits = schemaBits(M)        the new production added to the library
 *   taxBits = R·(log2(N+1) − log2(N)) the Minton/Lari-Young MATCH-COST tax: +1 symbol raises
 *                                     EVERY record's parse cost
 *   ΔL = encodeBits + taxBits − savedBits ;  admit iff ΔL < 0     (SEQUITUR "used ≥2×" in bits)
 *
 * SOUNDNESS DISCIPLINE: MDL only RANKS / PRE-PRUNES. It cannot verify fixpoint-equivalence or
 * real model-cost, so it must never be the sole admit authority (false-admit risk). Compose it
 * with `abstraction.makeAbstractionGate` as the authority via `composeGates` (MDL rejects
 * cheaply; survivors boot once through the empirical gate).
 *
 *   const { rankCandidates, mdlGain, makeMdlGate, composeGates } = require('./mdl');
 *   const ranked = rankCandidates(mineChains(records, tree), { tree, records, alphabet });
 *   const gate = composeGates(makeMdlGate(ctx), makeAbstractionGate(ctx));   // cheap → authority
 */
const { eachConcept, refsOf, refKeyOf, templateKeys } = require('./validate.js');

var LOG2 = Math.log(2);
function log2( x ) { return Math.log(x) / LOG2; }

// The discrete SYMBOLS a concept's schema spends (the same auditable spine the validator reads:
// require refs + ensure/assert atoms + applyMutations template keys + the provider name).
function symbolsOf( schema ) {
	schema = (schema && schema._schema) || schema || {};
	var reqs = refsOf(schema.require, false).map(function ( r ) { return refKeyOf(r).key; });
	var ens  = refsOf(schema.ensure, true).concat(refsOf(schema.assert, true));
	var tpl  = templateKeys(schema.applyMutations);
	var prov = schema.provider ? [Array.isArray(schema.provider) ? schema.provider[0] : schema.provider] : [];
	return reqs.length + ens.length + tpl.length + prov.length;
}

// |Σ| from a number, or a {knownFacts, conceptNames, palette} alphabet (deduped union).
function alphabetSize( alphabet ) {
	if ( typeof alphabet === 'number' ) return Math.max(2, alphabet);
	var s = new Set();
	(alphabet && alphabet.knownFacts   || []).forEach(function ( x ) { s.add(x); });
	(alphabet && alphabet.conceptNames || []).forEach(function ( x ) { s.add(x); });
	(alphabet && alphabet.palette      || []).forEach(function ( x ) { s.add(x); });
	return Math.max(2, s.size);
}

/**
 * Description length (bits) of ONE concept's schema: its symbol count encoded in the alphabet
 * + a small ordinal structural constant (the fixed _id/_name/wrapper overhead). Per the plan,
 * keep `structConst` ORDINAL — it places the rarity boundary, not an absolute fitted threshold.
 */
function schemaBits( concept, alphabet, opts ) {
	opts = opts || {};
	var structConst = opts.structConst != null ? opts.structConst : 4;
	return symbolsOf(concept) * log2(alphabetSize(alphabet)) + structConst;
}

// L(corpus | library) = R · log2(N): R records each costing log2(N) bits to name a concept.
function corpusBits( records, conceptCount ) {
	var R = (records && records.length) || 0;
	var N = Math.max(2, conceptCount || 0);
	return R * log2(N);
}

function conceptCountOf( tree ) {
	var n = 0;
	eachConcept(tree, function ( c ) { if ( c && c._name ) n++; });
	return n;
}

function conceptByName( tree, name ) {
	var found = null;
	eachConcept(tree, function ( c ) { if ( c && c._name === name ) found = c; });
	return found;
}

/**
 * The MDL gain of promoting one mined chain to an abstract production.
 * @param opts.chain     a mineChains edge { from, to, via, count } (+ optional `length` ℓ, default 2)
 * @param opts.tree      the concept tree (for N and the constituents' schema symbols)
 * @param opts.records   the trace corpus (for R, the parse-tax base)
 * @param opts.alphabet  Σ — a number, or { knownFacts, conceptNames, palette }
 * @param opts.abstractSchema  (optional) the composed method's schema; else estimated from the
 *                       constituents (sum of from+to symbols — the inlined chain's spine)
 * @returns { deltaL, encodeBits, savedBits, taxBits, admit, count, ell, N, R }
 */
function mdlGain( opts ) {
	opts = opts || {};
	var chain = opts.chain || {};
	var tree  = opts.tree;
	var count = chain.count || 0;
	var ell   = chain.length || 2;
	var N     = conceptCountOf(tree);
	var R     = (opts.records && opts.records.length) || 0;
	// conceptNames default into the alphabet when not given explicitly.
	var alphabet = opts.alphabet;
	if ( alphabet && typeof alphabet === 'object' && !alphabet.conceptNames ) {
		var names = [];
		eachConcept(tree, function ( c ) { if ( c && c._name ) names.push(c._name); });
		alphabet = Object.assign({}, alphabet, { conceptNames: names });
	}

	var encodeBits;
	if ( opts.abstractSchema ) {
		encodeBits = schemaBits(opts.abstractSchema, alphabet, opts);
	} else {
		// estimate the abstract method's description from its constituents (inlined spine).
		var fromC = conceptByName(tree, chain.from), toC = conceptByName(tree, chain.to);
		var syms  = symbolsOf(fromC) + symbolsOf(toC);
		var structConst = opts.structConst != null ? opts.structConst : 4;
		encodeBits = syms * log2(alphabetSize(alphabet)) + structConst;
	}

	var savedBits = count * (ell - 1) * log2(Math.max(2, N));
	var taxBits   = R * (log2(N + 1) - log2(Math.max(2, N)));
	var deltaL    = encodeBits + taxBits - savedBits;

	return {
		deltaL: deltaL, encodeBits: encodeBits, savedBits: savedBits, taxBits: taxBits,
		admit: deltaL < 0, count: count, ell: ell, N: N, R: R,
	};
}

/**
 * Rank mined candidates by MDL gain (most-negative ΔL = best refactor first). Each is annotated
 * with its `mdl` record. A cheap O(corpus) ordering to apply BEFORE any expensive boot.
 * @returns the chains sorted ascending by ΔL, each `{ ...chain, mdl }`.
 */
function rankCandidates( chains, ctx ) {
	ctx = ctx || {};
	return (chains || [])
		.map(function ( chain ) {
			return Object.assign({}, chain, { mdl: mdlGain(Object.assign({}, ctx, { chain: chain })) });
		})
		.sort(function ( a, b ) { return a.mdl.deltaL - b.mdl.deltaL; });
}

/**
 * The MDL gate in the shape `authorConcept`'s `spec.gate` expects. A cheap PRE-FILTER: it only
 * judges 'add' proposals that carry their mined `chain` (so the corpus stats exist); without
 * one it ABSTAINS (admit:true → defer to the authority gate). Reject = ΔL ≥ 0.
 * @param ctx { tree, records, alphabet, structConst }  the corpus context (as for mdlGain)
 * @param ctx.chainOf  (proposal)->chain   how to read the mined chain off a proposal
 *                     (default: `proposal.chain`)
 */
function makeMdlGate( ctx ) {
	ctx = ctx || {};
	var chainOf = ctx.chainOf || function ( proposal ) { return proposal && proposal.chain; };
	return function gate( graph, proposal ) {
		if ( (proposal.op || 'add') !== 'add' ) return { admit: true };
		var chain = chainOf(proposal);
		if ( !chain ) return { admit: true, reason: 'mdl-abstain (no mined chain on proposal)' };
		var schema = proposal.schema;
		var g = mdlGain(Object.assign({}, ctx, { chain: chain, abstractSchema: schema }));
		return { admit: g.admit, reason: g.admit ? null : 'mdl-reject (ΔL=' + g.deltaL.toFixed(2) + ' ≥ 0)', mdl: g };
	};
}

/**
 * Compose gates as a short-circuiting AND: run them in order, the FIRST reject wins (cheap
 * gates first prune before the expensive authority boots). All-admit → the last gate's verdict
 * (so the authority's `eval` rides through). Each gate is sync or async; the composite awaits.
 */
function composeGates() {
	var gates = Array.prototype.slice.call(arguments);
	return async function gate( graph, proposal ) {
		var last = { admit: true };
		for ( var i = 0; i < gates.length; i++ ) {
			last = await gates[i](graph, proposal);
			if ( !last || !last.admit ) return last;     // short-circuit on the first reject
		}
		return last;
	};
}

module.exports = {
	symbolsOf: symbolsOf, alphabetSize: alphabetSize, schemaBits: schemaBits, corpusBits: corpusBits,
	conceptCountOf: conceptCountOf, mdlGain: mdlGain, rankCandidates: rankCandidates,
	makeMdlGate: makeMdlGate, composeGates: composeGates,
};
