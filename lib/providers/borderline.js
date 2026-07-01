/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * borderline — the BORDERLINE-ONLY LLM gate (G-1 rung 2; the "ask the librarian" LAST resort). The library-science
 * dispatch pattern (owner) + wiseways.me's production shape: the deterministic barrier (`canonicalize.js`, exact members
 * + curated synonym ring) resolves ~everything; a small model is consulted ONLY for the thin residual band — a surface
 * in NEITHER the enum members NOR the ring — and even then it may only PROPOSE, never author.
 *
 * SOUNDNESS (the load-bearing discipline — why this does not reopen the false-merge the barrier guards):
 *   • OUTSIDE the barrier. `canonValue` stays a pure, deterministic, confluent lookup. This gate runs only AFTER it MISSES.
 *   • RE-CANONICALIZED. The model's answer is snapped back through the SAME spec (`canonValue`) — a hallucinated or
 *     free-text answer becomes a member or a miss; the model can NEVER put raw prose on a dependency edge (fuzzy recall,
 *     EXACT truth). Constrained decoding (`enumGbnf`) makes the answer a valid member/`none` by construction.
 *   • PROVISIONAL. A borderline resolution is a GUESS on out-of-vocabulary. It is returned `via:'llm-borderline',
 *     provisional:true` — best-effort for THIS run's dispatch, but treated like a CanonMiss for MEMOIZATION (never mint a
 *     reusable digest → never CACHE a borderline merge). So an un-validated guess can serve one dispatch but can never
 *     become a cached false-merge.
 *   • PROPOSE-ONLY (LILO/AutoDoc). It also returns a `proposal:{alias,member}` — a candidate SYNONYM-RING entry for
 *     human/gate validation. Admitted proposals grow the ring, which is deterministic + confluent (validated by
 *     `validate.js`'s critical-pair check), so the exogenous vocabulary CONVERGES and the model fires ever less.
 *
 *   const { makeLocalAsk } = require('skynet-graph/lib/providers/llm-local');
 *   const snap = makeBorderlineSnap({ ask: makeLocalAsk({ modelPath, gbnf: null }) });  // a small local model suffices
 *   const r = await snap('catastrophic', { enum: ['low','high'], synonyms: { high: ['severe'] } });
 *   // r = { value:'high', via:'llm-borderline', provisional:true, proposal:{ alias:'catastrophic', member:'high' } }
 */
var canonicalize = require('./canonicalize');

// A GBNF grammar restricting the model's reply to a bare enum member or "none" (constrained decoding = the answer is a
// valid member by construction). Members are emitted as quoted GBNF string literals. Pass as `makeLocalAsk({ gbnf })`.
function enumGbnf( spec ) {
	var members = (spec && spec.enum) || [];
	var alts = members.concat(['none']).map(function ( m ) { return JSON.stringify(String(m)); });
	return 'root ::= ' + alts.join(' | ');
}

// Extract the chosen member from a model reply, THROUGH the barrier (so the ring + normalization apply). Tries the whole
// reply first (a constrained/one-word answer), then a token scan (robust to a free-text answer). Returns the member or null.
function pickMember( answer, spec ) {
	var whole = canonicalize.canonValue(String(answer == null ? '' : answer).trim(), spec);
	if ( !whole.miss ) return whole.value;
	var toks = String(answer == null ? '' : answer).toLowerCase().split(/[^a-z0-9_-]+/);
	for ( var i = 0; i < toks.length; i++ ) {
		if ( !toks[i] ) continue;
		var c = canonicalize.canonValue(toks[i], spec);
		if ( !c.miss ) return c.value;
	}
	return null;                                                     // "none" / unresolvable → stays a miss
}

var DEFAULT_SYS = 'You map a term to the single closest label from a fixed list, or "none" if it fits none. Reply with only the label.';
function defaultPrompt( raw, members ) {
	return 'Labels: ' + members.join(', ') + ', none.\nWhich single label best matches the term "' + String(raw) + '"? Reply with only the label.';
}

/**
 * Build a borderline snapper over an `ask` backend (e.g. `makeLocalAsk(...)` — a SMALL local model is enough).
 * @param opts.ask     async ({system,user,maxTokens,temperature}) -> string (the model seam; the ONLY coupling).
 * @param opts.system  optional system prompt override.
 * @param opts.prompt  optional (raw, members) -> user-prompt override.
 * @returns async snap(raw, spec) -> { value, miss?, via?, provisional?, proposal? }
 *          If the deterministic barrier already resolves `raw` (member or ring), returns THAT (the model is NOT called).
 *          On a genuine miss, consults the model, re-canonicalizes, and returns a PROVISIONAL member (+ a ring proposal)
 *          or the original miss (→ the host's existing CanonMiss escalation). Never mutates the spec/ring.
 */
function makeBorderlineSnap( opts ) {
	opts = opts || {};
	var ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('makeBorderlineSnap: opts.ask (a model backend) is required');
	var system = opts.system || DEFAULT_SYS;
	var mkPrompt = opts.prompt || defaultPrompt;

	return async function snap( raw, spec ) {
		spec = spec || {};
		var det = canonicalize.canonValue(raw, spec);
		if ( !det.miss ) return det;                                 // the deterministic barrier resolved it → NEVER call the model
		if ( !spec.enum || raw == null || String(raw).trim() === '' ) return det;   // nothing to disambiguate

		var answer = await ask({ system: system, user: mkPrompt(raw, spec.enum), maxTokens: 16, temperature: 0 });
		var member = pickMember(answer, spec);                      // re-canonicalized through the SAME spec (defense in depth)
		if ( member == null ) return det;                           // model said none / unresolvable → stays a miss (escalate as today)

		return {
			value: member, via: 'llm-borderline', provisional: true,   // best-effort for THIS run; treat like CanonMiss for memo
			proposal: { alias: String(raw), member: member },          // a candidate ring entry for human/gate validation (propose-only)
		};
	};
}

/**
 * Batch helper: canonicalize a raw reply against a facts schema (the deterministic barrier), then run the borderline gate
 * on the MISSES only. Returns the same shape as `canonFacts` plus `borderline` (the provisional snaps) and `proposals`
 * (candidate ring entries). The still-unresolved keys remain in `misses` (→ the host's CanonMiss escalation). `provisional`
 * keys carry a member value for dispatch but MUST be treated as un-cacheable (no reusable digest) by the caller.
 * @param snap  a `makeBorderlineSnap(...)` snapper.
 */
async function borderlineFacts( raw, factsSchema, snap ) {
	raw = raw || {};
	var base = canonicalize.canonFacts(raw, factsSchema);
	var facts = Object.assign({}, base.facts), misses = [], borderline = [], proposals = [];
	for ( var i = 0; i < base.misses.length; i++ ) {
		var key = base.misses[i], spec = (factsSchema || {})[key] || {};
		var src = spec.from != null ? spec.from : key;
		var r = await snap(raw[src], spec);
		if ( r && r.provisional && !r.miss ) {
			facts[key] = r.value; borderline.push({ key: key, raw: raw[src], member: r.value });
			if ( r.proposal ) proposals.push(Object.assign({ key: key }, r.proposal));
		} else {
			misses.push(key);                                       // still out-of-vocab → the existing fail-closed escalation
		}
	}
	return { facts: facts, misses: misses, synonyms: base.synonyms, borderline: borderline, proposals: proposals };
}

module.exports = { makeBorderlineSnap: makeBorderlineSnap, borderlineFacts: borderlineFacts, enumGbnf: enumGbnf, pickMember: pickMember };
