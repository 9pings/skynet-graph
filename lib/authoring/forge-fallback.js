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
 * makeForgeFallback(spec) — build a `forge` fn wired for a segment-proxy's hook.
 * @param spec.forge        (prompt, args) => { name, castTemplate, summary?, footprint?, method? } | null   REQUIRED — the model.
 *                          castTemplate = the cast the proxy applies (a typed sub-graph); summary/footprint = what it
 *                          produces (re-gated); method = a method spec to index-back.
 * @param spec.stackToPrompt (stack, contract, args) => prompt   the LEVER (default: defaultStackToPrompt).
 * @param spec.index        Map<libraryKey, method>   the library the forged method is indexed into (amortise; default: own).
 * @returns fallback        async (args) => castTemplate   (args = the P2 hook: { scope, graph, contract, stack, reason, blame }).
 *                          fallback.index exposes the growing library.
 */
function makeForgeFallback( spec ) {
	spec = spec || {};
	const stackToPrompt = spec.stackToPrompt || defaultStackToPrompt;
	const forge = spec.forge;
	const index = spec.index || new Map();
	if ( typeof forge !== 'function' ) throw new Error('makeForgeFallback needs spec.forge(prompt, args)');

	const fallback = async function ( args ) {
		args = args || {};
		const prompt = stackToPrompt(args.stack || [], args.contract || {}, args);   // the LEVER: stack → prompt
		const cand = await forge(prompt, args);                                      // the model — PROPOSE
		if ( !cand || !cand.castTemplate ) throw new Error('forge-fallback: the model produced no candidate');
		// RE-ENTER the gate (DISPOSE): the forged output must satisfy the contract — a bad forge cannot corrupt the caller.
		if ( cand.summary ) {
			const post = assertPost(args.contract || {}, cand.summary, cand.footprint || Object.keys(cand.summary), {});
			if ( !post.ok ) throw new Error('forge-fallback: the forged method is REFUSED by the gate (' + post.violations.map(( v ) => v.kind).join(',') + ')');
		}
		if ( cand.method ) index.set(cand.name || (args.stack && args.stack[0] && args.stack[0].id) || 'forged', cand.method);   // INDEX-BACK (amortise)
		return cand.castTemplate;
	};
	fallback.index = index;
	return fallback;
}

module.exports = { makeForgeFallback, defaultStackToPrompt };
