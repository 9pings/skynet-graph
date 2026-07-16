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
const { libraryKey } = require('../learning/crystallize.js');
const { holdsAtoms } = require('../core/contract.js');
const { digest } = require('../../providers/canonicalize.js');

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

/**
 * The dropped NACs of a candidate at a site = the application-conditions that FAIL (so dispatch would drop it). The
 * SAME predicates as `appConditionsHold` (`require` by PRESENCE — engine present-not-truthy, finding #32; `assert` by
 * `holdsAtoms`), so the loosened path and the exact path never disagree. NEVER use `contract.satisfies` for the require
 * half — it tests truthiness and disagrees on present-falsy keys (Laurie confront pt2). Empty ⇒ the appConditions hold.
 */
function droppedNACs( frontier, scopeFacts ) {
	const ac = (frontier && frontier.appConditions) || {}, facts = scopeFacts || {};
	const require = [], assert = [];
	for ( const k of (ac.require || []) ) if ( !(k in facts) ) require.push(k);
	for ( const a of (ac.assert || []) ) if ( typeof a === 'string' && a.trim() && !holdsAtoms(facts, a) ) assert.push(a);
	return { require, assert };
}

/**
 * §6.2 INTERFACE-ONLY (loosened) dispatch — the FUZZY-RECALL arm of the library (spec §3.4, refined by the Laurie
 * confront). Same O(1) `libraryKey` bucket as `dispatch` (the structural interface — NEVER widened: fuzzing it is the
 * GPTCache false-merge / K1 defeat, pt4), but instead of DROPPING the NAC-failing in-bucket candidates it SURFACES them
 * as `proposals` — ADAPT-SKELETON sources (NOT replay candidates). The controller (adapt.js#adaptOrForge, interfaceRecall)
 * re-forges the differing content into a NEW method with SITE-derived appConditions, then the EXACT verify gates THAT
 * method's own contract — so a proposal can only MISS (→ fresh forge) or be REJECTED, never write an unsound fact.
 * @returns { key, exact, proposals:[{candidate,weight,key,droppedNACs,dropCount}], scanned, total }
 *   exact      — the bucket entries whose appConditions HOLD (== `dispatch` candidates), weight-ranked.
 *   proposals  — NAC-failing in-bucket donors, ranked by VERSION-SPACE SPECIFICITY (fewest NACs dropped first, the
 *                least-adaptation climb; weight tie-break), capped at opts.k (default 3).
 */
function dispatchInterface( lib, target, scopeFacts, opts ) {
	opts = opts || {};
	const { key, entries } = bucketOf(lib, target);
	const weightOf = opts.weight || (( e ) => e.weight);
	const exact = [], proposals = [];
	for ( const e of entries ) {
		const dropped = droppedNACs(frontierOf(e.candidate), scopeFacts);
		if ( !dropped.require.length && !dropped.assert.length ) exact.push(e);
		else proposals.push(Object.assign({}, e, { droppedNACs: dropped, dropCount: dropped.require.length + dropped.assert.length }));
	}
	exact.sort(( a, b ) => weightOf(b) - weightOf(a));
	proposals.sort(( a, b ) => (a.dropCount - b.dropCount) || (weightOf(b) - weightOf(a)));
	return { key, exact, proposals: proposals.slice(0, opts.k == null ? 3 : opts.k), scanned: entries.length, total: lib.methods.length };
}

/**
 * DRIFT-side invalidation at the CATALOG grain — the companion of master-loop's `drift()` (which only
 * evicts the exact-result cache + recall index). Without it, a drifted problem's next FORGE would
 * re-dispatch the SAME stale method and re-`hit` its template at 0 calls — resurrecting exactly what
 * drift invalidated (the correct-on-drift claim breaks). This deletes the template keyed by THIS
 * site's signature from every in-bucket candidate: the stale unit only — the method skeleton, its
 * other signature classes, and its class knowledge (frontier/contract/appConditions) survive, so the
 * next solve re-adapts/re-forges just the violated entry (and re-indexes a fresh template).
 * @param target      { frontier, signatureKeys } | { libraryKey }  — as `dispatch`.
 * @param scopeFacts  the drifted call-site facts (the signature source).
 * @returns { key, invalidated:[{ id, sig }] }
 */
function invalidateTemplate( lib, target, scopeFacts ) {
	const { key, entries } = bucketOf(lib, target);
	const invalidated = [];
	for ( const e of entries ) {
		const cand = e.candidate || {};
		const proj = {};
		for ( const k of (cand.signatureKeys || []) ) if ( scopeFacts && k in scopeFacts ) proj[k] = scopeFacts[k];
		const sig = digest(proj);
		if ( cand.templatesBySig && sig in cand.templatesBySig ) {
			delete cand.templatesBySig[sig];
			invalidated.push({ id: cand.schema && cand.schema._id, sig });
		}
	}
	return { key, invalidated };
}

module.exports = { makeLibrary, indexMethod, bucketOf, appConditionsHold, dispatch, dispatchInterface, droppedNACs, frontierOf, invalidateTemplate };
