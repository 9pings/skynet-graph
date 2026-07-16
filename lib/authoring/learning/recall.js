/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * recall — FUZZY-RECALL → TYPED-VERIFY retrieval (host-side, ZERO-CORE). U5 / the master-graph study §2.4.
 *
 * The derivation cache is an EXACT content-address (a hash hit on the K1 digest): a miss is total, so a
 * related-but-different problem pays full price even when a verifiable NEAR method exists. U5 adds the
 * missing arm — a RECALL front-end that PROPOSES close methods, gated by an exact TYPED VERIFY that ADMITS.
 *
 * THE CONTRACT (the load-bearing soundness line):
 *   - RECALL is FUZZY (embedding / similarity over the whole method signature). It may be lossy and may
 *     surface false neighbours. It only ORDERS + BUDGETS candidates — it NEVER admits.
 *   - VERIFY is EXACT + TYPED. It gates on the STRUCTURE (the K1-canonical fields that DEFINE the method),
 *     never on the similarity score. Three verdicts:
 *       · full    — structure matches AND content matches  → replay at 0 model calls (= the cache hit).
 *       · partial — structure matches, content differs      → mount the shared skeleton (U1 instantiate),
 *                                                              RE-FORGE only the differing content holes.
 *       · reject  — structure mismatch                      → forge fresh. NO false replay, whatever the score.
 *
 * So a candidate that is similar by embedding (overlapping CONTENT tokens) but has a DIFFERENT typed
 * STRUCTURE is high-similarity yet REJECTED — recall's fuzziness can never write an unsound derivation
 * (the canonicalize.js line; worst case of bad recall = a wasted lookup + a fresh call). The win compounds
 * with concept-as-graph reuse: more crystallized structural methods → more partial hits → fewer model calls.
 *
 *   const idx = createRecallIndex();
 *   idx.add({ structure:{oKind:'A',tKind:'B'}, content:{mid:'m1'} }, methodA);
 *   const cands = idx.recall({ structure:{oKind:'A',tKind:'B'}, content:{mid:'m9'} }, 3);  // fuzzy, ranked
 *   const v = verify(querySig, cands[0].sig);   // { mode:'partial', reForge:['mid'], reuse:['oKind','tKind'] }
 */

// ---- default embedding: a token multiset over the signature's typed values (deterministic, dep-free) ----
function defaultEmbed( sig ) {
	const toks = new Map();
	const add = ( t ) => toks.set(t, (toks.get(t) || 0) + 1);
	const walk = ( o ) => {
		if ( o == null ) return;
		if ( typeof o !== 'object' ) { add(String(o)); return; }
		for ( const k of Object.keys(o) ) { add('k:' + k); walk(o[k]); }
	};
	walk(sig);
	return toks;
}

// cosine over token multisets (the default similarity — pluggable via opts.sim / a real embedder via opts.embed).
function cosine( a, b ) {
	let dot = 0, na = 0, nb = 0;
	for ( const [, v] of a ) na += v * v;
	for ( const [, v] of b ) nb += v * v;
	for ( const [t, v] of a ) if ( b.has(t) ) dot += v * b.get(t);
	return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
}

function createRecallIndex( opts ) {
	opts = opts || {};
	const embed = opts.embed || defaultEmbed;
	const sim = opts.sim || cosine;
	const entries = [];
	return {
		/** index a method under its typed signature { structure, content }. */
		add( sig, method ) { entries.push({ sig: sig, method: method, vec: embed(sig) }); return this; },
		/** FUZZY recall: top-k candidates by similarity over the WHOLE signature. ORDERS only — never admits. */
		recall( sig, k ) {
			const v = embed(sig);
			return entries
				.map(( e ) => ({ method: e.method, sig: e.sig, score: sim(v, e.vec) }))
				.sort(( a, b ) => b.score - a.score)
				.slice(0, k || 3);
		},
		/** remove every entry whose signature canonicalizes to `sig` — used on DRIFT (a stale method must not
		 *  be recalled; a drifted premise means RE-DERIVE, never replay the invalidated method). */
		remove( sig ) {
			const c = canon(sig);
			let n = 0;
			for ( let i = entries.length - 1; i >= 0; i-- ) if ( canon(entries[i].sig) === c ) { entries.splice(i, 1); n++; }
			return n;
		},
		entries,
		size() { return entries.length; }
	};
}

// stable, key-sorted stringify (digest-safe; used by the exact typed VERIFY).
function canon( x ) {
	if ( x === undefined ) return 'null';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(canon).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

/**
 * The EXACT TYPED VERIFY gate. Decides reuse on the STRUCTURE (the K1 fields that DEFINE the method),
 * independent of the recall similarity score.
 * @param query      { structure, content }   the new problem's typed signature
 * @param candidate  { structure, content }   a recalled method's signature
 * @returns { mode:'full'|'partial'|'reject', reuse:[fields], reForge:[fields] }
 *   - 'reject'  : structure mismatch (or empty shared structure) — forge fresh; no false replay.
 *   - 'full'    : structure AND content match — replay at 0 calls.
 *   - 'partial' : structure matches, content differs — mount the skeleton (reuse), re-forge the diff (reForge).
 */
function verify( query, candidate ) {
	const qs = (query && query.structure) || {}, cs = (candidate && candidate.structure) || {};
	const qStructKeys = Object.keys(qs).sort();
	// STRUCTURE must match exactly (same typed shape) — the K1 barrier. Any structural difference ⇒ reject.
	if ( !qStructKeys.length || canon(qs) !== canon(cs) ) return { mode: 'reject', reuse: [], reForge: [] };
	const qc = (query && query.content) || {}, cc = (candidate && candidate.content) || {};
	const reForge = [];
	for ( const k of new Set([...Object.keys(qc), ...Object.keys(cc)]) )
		if ( canon(qc[k]) !== canon(cc[k]) ) reForge.push(k);
	return reForge.length
		? { mode: 'partial', reuse: qStructKeys, reForge: reForge.sort() }   // shared skeleton + re-forge the diff
		: { mode: 'full', reuse: qStructKeys.concat(Object.keys(qc).sort()), reForge: [] };
}

/**
 * Drive recall→verify for a query: recall top-k (fuzzy), then return the FIRST candidate the typed verify
 * admits (full or partial), preferring 'full'. Returns null (→ forge fresh) if none verifies. The chosen
 * candidate is NOT necessarily the highest-similarity one — verify, not the score, decides.
 */
function recallAndVerify( index, query, k ) {
	const cands = index.recall(query, k || 3);
	let partial = null;
	for ( const c of cands ) {
		const v = verify(query, c.sig);
		if ( v.mode === 'full' ) return { method: c.method, sig: c.sig, score: c.score, verdict: v };
		if ( v.mode === 'partial' && !partial ) partial = { method: c.method, sig: c.sig, score: c.score, verdict: v };
	}
	return partial;   // null if every recalled candidate was rejected by the typed verify
}

module.exports = { createRecallIndex, verify, recallAndVerify, defaultEmbed, cosine };
