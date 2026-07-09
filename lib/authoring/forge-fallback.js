/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * forge-fallback — THE LAST-RESORT LEARNING FALLBACK, wired (roadmap 2026-07-09 §5(b); ZERO-CORE). P2's segment-proxy
 * exposes a `forge` HOOK + `reconstructStack` (the bounded problem stack, walked UP the parentSeg chain). §5(b) wires
 * the pipeline behind that hook:
 *
 *   reconstructStack → STACK-TO-PROMPT → forge (the model) → RE-ENTER the gate (assertPost) → INDEX-BACK (amortise)
 *
 * The LEVER (owner): the fallback's success is the SERIALIZATION of the stack into a prompt — if `stackToPrompt`
 * reconstitutes "what we're doing", the model only has to answer simple-but-relevant. When it fails, you work the
 * info-provisioning + the prompt, NOT the model. The forged method is PROPOSE-only: it must satisfy the contract
 * (assertPost DISPOSES) before it casts — it is typed sub-graph, so determinism holds. A forged method is INDEXED so
 * the next matching case is a dispatch HIT (0-call) — the amortisation. The `forge` model is injected (a real LLM in
 * production; a deterministic stub in tests).
 *
 * BOUNDED BLAME-DRIVEN RETRY (2026-07-09, residue USE-2(d), RE-SCOPED by the 2-lens confront). `maxRounds > 1` turns
 * the one-shot forge into a bounded loop: on a gate refusal, the graph's PUSHBACK (the violated post atoms + the
 * rejected-history) is folded into the next prompt (`serializeBlame`, the §5b LEVER one level up) and the model
 * revises, up to `maxRounds`, then a typed refusal. This is the OPEN-regime DUAL of `negotiate.js`: negotiate is the
 * CLOSED-domain constructive dialogue (it ENUMERATES admissible options and refuses on empty-options); here the space
 * is OPEN (a method/castTemplate, not an enum), so the pushback is the BLAME and refusal is on max-rounds — importing
 * negotiate's `optionsOf` is inert here (no enumerable domain) / gold-leaks on a closed enum. The three invariants
 * hold, re-earned for the open regime: 0-FALSE (the admit path is the UNCHANGED `assertPost` — a non-gated forge is
 * never returned, any round), HONEST-but-OPERATIONAL REFUSAL (refuse when no gated answer was produced within the
 * bound — an operational, not epistemic, refusal; the graph never fabricates one), TERMINATION (`maxRounds`).
 * LIVE-PROVEN (Ministral-Q8, `WIP/experiments/2026-07-09-blame-retry-killgate/`): on an OPEN sum+mod3 target, one-shot
 * 17/24 → retry 24/24 at 0-FALSE; the dominant lever is the bounded retry-with-memory (+6/7), the violated-atom
 * CONTENT adds a thin-but-robust +1 (a stubborn case resampling can't reach). `maxRounds` DEFAULTS to 1 → the one-shot
 * behavior is byte-identical (fully backward-compatible).
 */
const { assertPost } = require('./contract.js');

/**
 * defaultStackToPrompt — the tunable serialization. Reconstitutes each level's TYPED interface (statement + produces
 * ⊢ / needs ⊨) + the required output (contract.write) — "what we're doing", bounded, no prose.
 */
function defaultStackToPrompt( stack, contract, args ) {
	const levels = (stack || []).map(( s, i ) => 'L' + i + ' ' + (s.statement || s.id)
		+ (s.produces ? ' ⊢' + s.produces : '') + (s.needs && s.needs.length ? ' ⊨' + s.needs.join(',') : '')).join(' | ');
	const goal = 'PRODUCE ' + (((contract || {}).write) || []).join(',');
	return 'STACK[' + levels + '] · ' + ((args && args.reason) || 'forge') + ' → ' + goal;
}

/**
 * defaultSerializeBlame — the graph's PUSHBACK folded into the revision prompt (the §5b LEVER, one level up). The
 * ONLY thing beyond a bare resample is the CONTENT: the violated post atoms + the rejected-history. Bounded, no prose.
 * @param violations  the `assertPost` violations of the last-rejected candidate ({kind,detail}).
 * @param rejected    the summaries rejected so far (so the model does NOT repeat them).
 * @param round       the current (0-indexed) round about to be attempted.
 */
function defaultSerializeBlame( violations, rejected, round ) {
	const atoms = (violations || []).filter(( v ) => v.kind === 'post-violated').map(( v ) => v.detail);
	const undecl = (violations || []).filter(( v ) => v.kind === 'undeclared-write').map(( v ) => v.detail);
	const why = [];
	if ( atoms.length ) why.push('violated constraints: [' + atoms.join(', ') + ']');
	if ( undecl.length ) why.push('undeclared writes: [' + undecl.join(', ') + ']');
	return ' | REVISE (attempt #' + (round + 1) + '): the previous answer was REJECTED — ' + (why.join('; ') || 'the post did not hold')
		+ '. Already-rejected (do NOT repeat): [' + (rejected || []).map(( r ) => JSON.stringify(r)).join(' ') + ']. Produce a NEW answer satisfying ALL.';
}

/**
 * makeForgeFallback(spec) — build a `forge` fn wired for a segment-proxy's hook.
 * @param spec.forge         (prompt, args) => { name, castTemplate, summary?, footprint?, method? } | null   REQUIRED — the model.
 *                           castTemplate = the cast the proxy applies (a typed sub-graph); summary/footprint = what it
 *                           produces (re-gated); method = a method spec to index-back.
 * @param spec.stackToPrompt (stack, contract, args) => prompt   the LEVER (default: defaultStackToPrompt).
 * @param spec.serializeBlame (violations, rejected, round) => promptSuffix   the retry pushback (default: defaultSerializeBlame).
 * @param spec.maxRounds     the bounded-retry cap (default 1 = one-shot, byte-identical to the pre-retry behavior).
 * @param spec.oracle        optional G2 ground-truth probe forwarded to `assertPost` (for an effecting post).
 * @param spec.index         Map<libraryKey, method>   the library the forged method is indexed into (amortise; default: own).
 * @returns fallback         async (args) => castTemplate   (args = the P2 hook: { scope, graph, contract, stack, reason, blame }).
 *                           fallback.index exposes the growing library.
 */
function makeForgeFallback( spec ) {
	spec = spec || {};
	const stackToPrompt = spec.stackToPrompt || defaultStackToPrompt;
	const serializeBlame = spec.serializeBlame || defaultSerializeBlame;
	const maxRounds = spec.maxRounds || 1;
	const forge = spec.forge;
	const index = spec.index || new Map();
	if ( typeof forge !== 'function' ) throw new Error('makeForgeFallback needs spec.forge(prompt, args)');

	const fallback = async function ( args ) {
		args = args || {};
		const base = stackToPrompt(args.stack || [], args.contract || {}, args);      // the LEVER: stack → prompt
		const rejected = [];
		let lastViolations = null;
		for ( let round = 0; round < maxRounds; round++ ) {
			const prompt = round === 0 ? base : base + serializeBlame(lastViolations, rejected, round);   // fold the pushback in (round>0)
			const cand = await forge(prompt, args);                                   // the model — PROPOSE
			if ( !cand || !cand.castTemplate ) throw new Error('forge-fallback: the model produced no candidate');
			// RE-ENTER the gate (DISPOSE): the forged output must satisfy the contract — a bad forge cannot corrupt the caller.
			if ( cand.summary ) {
				const post = assertPost(args.contract || {}, cand.summary, cand.footprint || Object.keys(cand.summary), { oracle: spec.oracle });
				if ( !post.ok ) {
					rejected.push(cand.summary); lastViolations = post.violations;
					if ( round + 1 < maxRounds ) continue;                            // RETRY with the graph's pushback in the prompt
					throw new Error('forge-fallback: the forged method is REFUSED by the gate (' + post.violations.map(( v ) => v.kind).join(',') + ')');
				}
			}
			if ( cand.method ) index.set(cand.name || (args.stack && args.stack[0] && args.stack[0].id) || 'forged', cand.method);   // INDEX-BACK (amortise)
			return cand.castTemplate;
		}
		throw new Error('forge-fallback: no gated candidate within ' + maxRounds + ' rounds');   // (unreachable when maxRounds>=1; a guard)
	};
	fallback.index = index;
	return fallback;
}

module.exports = { makeForgeFallback, defaultStackToPrompt, defaultSerializeBlame };
