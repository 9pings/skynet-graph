/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * adapt — the adapt-or-forge CONTROLLER: the creative loop's drive (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-30-creative-loop-two-level-grammar.md, brick C).
 *
 * The structuring grammar names a target mechanism; this drives retrieve-or-forge over the concept-DLL library:
 *   RETRIEVE  dispatch (library.js) → a candidate with a template for THIS signature (K1-sound by construction) → HIT, 0 model calls.
 *   FORGE     no hit → the model builds the method, REUSING the dispatched neighbours where it can (adapt = structural
 *             reuse + content forge; forge = fresh — the host's forge labels which) → VERIFIER GATE (it must carry a
 *             sound contract, mirroring crystallizeStructural's refuse-no-post) → index back so the next encounter HITS
 *             (amortise). The measured master-loop retrieve-or-forge; the verifier is the born-defeasible contract.
 *
 * The contract's POST is an OUTPUT invariant (true after the method runs) — so it is NOT a pre-dispatch gate (that is
 * the app-conditions, refined in dispatch). The gate here is "the forged method comes with a sound post" + an optional
 * host `verify` hook (run it + `assertPost`); a drift that breaks the post is caught by the runtime monitor (the moat).
 */
const { dispatch, indexMethod } = require('./library.js');
const { digest } = require('../providers/canonicalize.js');

const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };

/** the signature digest a candidate would key its replay on at this site (null if it has no template for it = a miss). */
function hitTemplate( cand, scopeFacts ) {
	const sig = digest(projectFacts(scopeFacts, cand.signatureKeys || []));
	return (cand.templatesBySig || {})[sig] ? sig : null;
}

const hasSoundContract = ( cand ) => !!(cand && cand.schema && cand.schema.contract);

/**
 * Drive retrieve-or-forge for a target mechanism at a site.
 * @param opts.lib/target/scopeFacts  the library + the abstract target FrontierSignature + the call-site facts.
 * @param opts.forge   (scopeFacts, neighbours) → { candidate, outcome?:'adapt'|'forge', calls?:number } | null
 *                     the model: builds a new method (may REUSE the dispatched `neighbours` = adapt). Returns null = give up.
 * @param opts.verify  optional (candidate, scopeFacts) → boolean   a stronger gate than "has a contract" (e.g. run + assertPost).
 * @param opts.onForge optional (candidate) → void   index the forged method (default: indexMethod into opts.lib).
 * @param opts.requireContract  default true — refuse a forged method with no sound post (the verifier gate).
 * @returns { outcome:'hit'|'adapt'|'forge'|'reject', candidate?, sig?, calls, neighbours, reason? }
 */
function adaptOrForge( opts ) {
	const r = dispatch(opts.lib, opts.target, opts.scopeFacts);
	const neighbours = r.candidates.map(( e ) => e.candidate );

	// RETRIEVE — a dispatched candidate with a template for this signature: K1-sound by construction, 0 model calls.
	for ( const cand of neighbours ) {
		const sig = hitTemplate(cand, opts.scopeFacts);
		if ( sig ) return { outcome: 'hit', candidate: cand, sig, calls: 0, neighbours };
	}

	// FORGE / ADAPT — the model builds it, reusing the neighbours where it can. Verifier-gated, then indexed (amortise).
	const f = opts.forge ? opts.forge(opts.scopeFacts, neighbours) : null;
	if ( !f || !f.candidate ) return { outcome: 'reject', reason: 'no forge / forge failed', calls: f && f.calls || 0, neighbours };
	if ( opts.requireContract !== false && !hasSoundContract(f.candidate) )
		return { outcome: 'reject', reason: 'forged method has no sound contract (verifier gate)', calls: f.calls == null ? 1 : f.calls, neighbours };
	if ( opts.verify && !opts.verify(f.candidate, opts.scopeFacts) )
		return { outcome: 'reject', reason: 'forged method failed the host verifier', calls: f.calls == null ? 1 : f.calls, neighbours };
	(opts.onForge || (( c ) => indexMethod(opts.lib, c)))(f.candidate);
	return { outcome: f.outcome === 'adapt' ? 'adapt' : 'forge', candidate: f.candidate, calls: f.calls == null ? 1 : f.calls, neighbours };
}

module.exports = { adaptOrForge, hitTemplate, hasSoundContract };
