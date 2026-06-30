/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * library — the method-library INDEX + dispatch: the JUNCTURE of the two grammars (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-30-creative-loop-two-level-grammar.md).
 *
 * The STRUCTURING grammar describes an abstract mechanism as a target FrontierSignature (params `role:sort` + the
 * signature keys); the CONCEPT-DLL grammar is the learned library of crystallized methods. Dispatch = an **O(1)
 * dictionary lookup on the canonical `libraryKey`** (the bucket) → refine the bucket by each candidate's APPLICATION
 * CONDITIONS (the NACs) over the call-site scope → a RANKED list (weighted = "plusieurs façons"). It is NEVER a
 * search/parse over the corpus — that is the HRG-parsing NP cliff (Lange-Welzl 1987). This is structure-mapping
 * (Gentner): the abstract mechanism is the relational structure, the library methods are the source domains, a match
 * is the analogy. The interface alphabet (`libraryKey` + `appConditions`) IS the snapped separator between the two
 * grammars; keeping it K1-canonical is exactly what makes dispatch a lookup instead of a search.
 *
 *   const lib = makeLibrary();
 *   indexMethod(lib, crystalCandidate, { weight: 2 });            // index a crystallizeStructural candidate
 *   const r = dispatch(lib, { frontier, signatureKeys }, scopeFacts);
 *   // r.candidates = ranked methods whose app-conditions hold at this site; r.scanned = bucket size (<< r.total)
 */
const { libraryKey } = require('./crystallize.js');
const { holdsAtoms } = require('./contract.js');

const frontierOf = ( c ) => c && (c.frontier || (c.schema && c.schema.frontier)) || { params: [] };
const keyOf = ( c ) => (c && (c.libraryKey || (c.schema && c.schema.libraryKey))) || libraryKey(frontierOf(c), (c && c.signatureKeys) || []);

/** A fresh, empty method library (a `libraryKey` → entries dictionary + a flat list). */
function makeLibrary() { return { byKey: Object.create(null), methods: [] }; }

/**
 * Index a crystallized method under its `libraryKey`.
 * @param candidate  a `crystallizeStructural` candidate ({ schema:{frontier,libraryKey,…}, signatureKeys, … }).
 * @param opts.weight  production weight for ranking (default 1) — the home for `semiring.js`/inside-outside scores.
 * @returns the libraryKey it was indexed under.
 */
function indexMethod( lib, candidate, opts ) {
	opts = opts || {};
	const key = keyOf(candidate);
	const entry = { candidate, key, weight: opts.weight == null ? 1 : opts.weight };
	(lib.byKey[key] = lib.byKey[key] || []).push(entry);
	lib.methods.push(entry);
	return key;
}

/** The O(1) bucket for a target signature — the LOOKUP (never a scan over the corpus). target = { frontier,
 *  signatureKeys } | { libraryKey }. */
function bucketOf( lib, target ) {
	const key = (target && target.libraryKey) || libraryKey((target && target.frontier) || { params: [] }, (target && target.signatureKeys) || []);
	return { key, entries: lib.byKey[key] || [] };
}

/** Do a method's application conditions (the NACs reified on its FrontierSignature) hold at a call site? require keys
 *  must be PRESENT (engine semantics — present, not truthy); assert atoms must HOLD (`contract.holdsAtoms`, the single
 *  source of truth, handles `$ref` + bare keys via the safe `expr.js`). An empty appConditions ⇒ trivially applicable. */
function appConditionsHold( frontier, scopeFacts ) {
	const ac = (frontier && frontier.appConditions) || {};
	const facts = scopeFacts || {};
	for ( const k of (ac.require || []) ) if ( !(k in facts) ) return false;
	for ( const a of (ac.assert || []) ) if ( typeof a === 'string' && a.trim() && !holdsAtoms(facts, a) ) return false;
	return true;
}

/**
 * Dispatch a target FrontierSignature against the library: O(1) bucket lookup → refine by app-conditions over the
 * scope → ranked candidates.
 * @returns { key, candidates:[{candidate,weight,key}], scanned, total }
 *   candidates  the bucket entries whose app-conditions hold, sorted by descending weight (ties keep index order).
 *   scanned     the bucket size — proves dispatch touched ONLY the bucket, never the whole corpus (the lookup invariant).
 *   total       the library size (for the scanned << total assertion).
 */
function dispatch( lib, target, scopeFacts, opts ) {
	opts = opts || {};
	const { key, entries } = bucketOf(lib, target);
	const weightOf = opts.weight || (( e ) => e.weight);
	const matched = entries
		.filter(( e ) => appConditionsHold(frontierOf(e.candidate), scopeFacts))
		.sort(( a, b ) => weightOf(b) - weightOf(a));
	return { key, candidates: matched, scanned: entries.length, total: lib.methods.length };
}

module.exports = { makeLibrary, indexMethod, bucketOf, appConditionsHold, dispatch };
