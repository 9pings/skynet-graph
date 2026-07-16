/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * negotiate — THE BOUNDED LLM↔GRAPH DIALOGUE (owner 2026-07-09; ZERO-CORE, host-side). "A thinking mode for a model
 * that doesn't think": instead of the model reasoning internally (CoT), the GRAPH supplies the reasoning as a
 * structured pushback. The model PROPOSES a typed answer; the graph GATES it (`assertPost`); on a mismatch the graph
 * returns the BLAME (why it fails) + the ADMISSIBLE OPTIONS (the domain values that PASS its own gate — enumerated by
 * testing, not guessed) → serialized into a revision prompt (the §5b LEVER) → the model REVISES → repeat, BOUNDED.
 *
 * This turns the one-shot forge (`forge-fallback.js`: propose→gate→refuse) into a NEGOTIATION. It is CEGIS with the
 * graph as the verifier and the model as the synthesizer, made CONSTRUCTIVE (the verifier enumerates admissible
 * options) + defeasible + deterministic. Three invariants, all load-bearing:
 *   • 0-FALSE — a non-gated answer is NEVER returned (`ok` ⇒ the gate passed); converge on a gated one or REFUSE.
 *   • HONEST REFUSAL — no admissible option ⇒ a typed refusal (`no-admissible-option`); the graph NEVER forces a
 *     match (forcing would be the graph hallucinating). This is the "…t'es sûr c'est pas une halu?" with no fit.
 *   • TERMINATION — `maxRounds` bounds the loop (no oscillation), the dialogue-level analog of the apply-cap / G3.
 *
 *   const solve = makeNegotiate({ propose, gate: gateFromContract(contract), optionsOf, maxRounds: 4 });
 *   const { ok, answer, refusal, rounds, trace } = await solve(input, ctx);
 */
const { assertPost } = require('../../../lib/authoring/core/contract.js');

/**
 * gateFromContract(contract, opts) → gate(candidate) → { ok, blame, violations }
 * The default graph gate: `assertPost` (P4) against a typed contract. candidate = { summary, footprint }.
 * @param opts.oracle  a G2 ground-truth probe for an effecting post.
 */
function gateFromContract( contract, opts ) {
	opts = opts || {};
	return function gate( cand ) {
		const summary = (cand && cand.summary) || {};
		const post = assertPost(contract, summary, (cand && cand.footprint) || Object.keys(summary), { oracle: opts.oracle });
		return { ok: post.ok, blame: post.blame, violations: post.violations };
	};
}

/**
 * admissibleOptions(gate, key, domain) → (candidate) => [values]
 * THE CONSTRUCTIVE part: the graph enumerates "the other options that would match" by TESTING each domain value for
 * `key` through its OWN gate — grounded (the gate decides), never a guess. Returns the domain values the gate admits.
 */
function admissibleOptions( gate, key, domain ) {
	return function ( cand ) {
		const base = (cand && cand.summary) || {};
		return (domain || []).filter(function ( val ) {
			const probe = Object.assign({}, cand, { summary: Object.assign({}, base, { [key]: val }) });
			return gate(probe).ok;
		});
	};
}

/** defaultSerialize — the LEVER: turn the graph's refusal (blame + admissible options) into a revision prompt. */
function defaultSerialize( blame, options, cand ) {
	return 'REFUSED (' + ((blame && blame.kind) || 'mismatch') + '): your answer ' + JSON.stringify((cand && cand.summary) || {})
		+ ' does not match what is established. The ONLY admissible options are: [' + (options || []).join(', ')
		+ ']. Pick the one that fits; if none genuinely fits, say so rather than guessing.';
}

/**
 * makeNegotiate(spec) → async solve(input, ctx) => { ok, answer?, refusal?, rounds, trace, blame? }
 * @param spec.propose    async (input, { round, feedback, options, prior, ctx }) => candidate|null   the MODEL.
 *                        round 0 = the initial proposal; round>0 = a revision seeing `feedback` (+ structured `options`).
 * @param spec.gate       (candidate, ctx) => { ok, blame }   the GRAPH check (default idiom: gateFromContract).
 * @param spec.optionsOf  (gateResult, candidate, ctx) => [options]   the admissible options (default idiom: admissibleOptions).
 * @param spec.serializeFeedback (blame, options, candidate) => string   the LEVER (default: defaultSerialize).
 * @param spec.maxRounds  the dialogue bound (default 4).
 */
function makeNegotiate( spec ) {
	spec = spec || {};
	if ( typeof spec.propose !== 'function' ) throw new Error('makeNegotiate needs spec.propose(input, ctx) -> candidate');
	if ( typeof spec.gate !== 'function' ) throw new Error('makeNegotiate needs spec.gate(candidate) -> { ok, blame }');
	const optionsOf = spec.optionsOf;
	const serialize = spec.serializeFeedback || defaultSerialize;
	const maxRounds = spec.maxRounds || 4;

	return async function solve( input, ctx ) {
		let feedback = null, options = null, prior = null;
		const trace = [];
		for ( let round = 0; round < maxRounds; round++ ) {
			const cand = await spec.propose(input, { round: round, feedback: feedback, options: options, prior: prior, ctx: ctx });
			if ( cand == null ) { trace.push({ round: round, event: 'no-candidate' }); return { ok: false, refusal: 'no-candidate', rounds: round + 1, trace: trace }; }
			const g = spec.gate(cand, ctx);
			trace.push({ round: round, summary: cand.summary, ok: g.ok, blame: g.blame && g.blame.kind });
			if ( g.ok ) return { ok: true, answer: cand, rounds: round + 1, trace: trace };   // 0-false: only a GATED answer returns ok
			options = optionsOf ? (optionsOf(g, cand, ctx) || []) : [];
			if ( !options.length )                                                            // the graph has no match → HONEST refusal (never force one)
				return { ok: false, refusal: 'no-admissible-option', rounds: round + 1, trace: trace, blame: g.blame };
			feedback = serialize(g.blame, options, cand);                                     // the graph pushes back (blame + options)
			prior = cand;
		}
		return { ok: false, refusal: 'max-rounds', rounds: maxRounds, trace: trace };          // bounded → terminates
	};
}

module.exports = { makeNegotiate, gateFromContract, admissibleOptions, defaultSerialize };
