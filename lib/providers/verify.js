/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
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
 * Verification providers (roadmap #3) — the structural answer to K3 (coherence ≠ truth).
 * The engine maintains COHERENCE, never TRUTH; verification makes unreliability *visible
 * and non-propagating* by emitting discrete VERDICT facts that downstream concepts gate
 * on via `ensure` (a refuted fact auto-retracts its dependents — refutation IS defeasance,
 * no new engine path). Verdicts are discrete facts (the #1 typed-fact spine), never prose,
 * and NEVER overwrite the checked fact (the graph is additive; experts don't fight).
 *
 * Three reliable patterns (all verified against the engine):
 *   1. DETERMINISTIC verifier = a concept whose `ensure` IS the invariant (full `expr.js`
 *      grammar — uncapped). Its self-flag is the verdict; a target change re-tests it and
 *      auto-retracts. Consumers either nest under it (structural cascade) or `ensure` a
 *      verdict fact it writes. Prefer this — deterministic checkers >> LLM-refuters.
 *   2. INDEPENDENT verdict provider (`Verify::check`) — for a check that must run as an
 *      effect (an external lookup, or an LLM-refuter): reads the target, runs a checker,
 *      writes a DISTINCT verdict fact + `VerifiedAgainst` provenance. Downstream gates via
 *      `ensure:["$xVerified == true"]`.
 *   3. k-of-n VOTING (`Vote::tally`) — self-consistency: n strategies `{__push}` a vote
 *      into a grow-only array; a `Vote` concept gated `ensure:["$votes.length == $n"]`
 *      (the proven completion-gate) emits majority `consensus` + `confidence = agree/n`.
 *      Downstream gates `ensure:["$confidence >= threshold"]`.
 *
 * Independence discipline: a refuter must not be the same call that produced the fact
 * (don't ask the hallucination to grade itself) — a deterministic checker, a different
 * provider, or an adversarially-framed LLM. k-of-n over a biased model votes confidently
 * wrong; treat `confidence` as a heuristic, never a proof.
 */

// ---- deterministic checker library: (value, params) -> { pass, reason } ----
// Pure, side-effect-free, total (never throws). Add domain checks here as needed.
var checks = {
	range  : function ( v, p ) { var n = Number(v); return { pass: isFinite(n) && n >= p.min && n <= p.max, reason: 'range[' + p.min + ',' + p.max + ']' }; },
	oneOf  : function ( v, p ) { return { pass: (p.values || []).indexOf(v) !== -1, reason: 'oneOf' }; },
	equals : function ( v, p ) { return { pass: v === p.to, reason: 'equals' }; },
	approx : function ( v, p ) { var n = Number(v); return { pass: isFinite(n) && Math.abs(n - Number(p.to)) <= (p.tol || 0), reason: 'approx±' + (p.tol || 0) }; },
	nonEmpty: function ( v ) { return { pass: v != null && (typeof v === 'string' || Array.isArray(v) ? v.length > 0 : true), reason: 'nonEmpty' }; }
};

// ---- majority vote over an array of discrete votes ----
function majority( votes ) {
	var counts = {}, best = null, bestN = 0;
	for ( var i = 0; i < votes.length; i++ ) {
		var k = JSON.stringify(votes[i]);
		counts[k] = (counts[k] || 0) + 1;
		if ( counts[k] > bestN ) { bestN = counts[k]; best = votes[i]; }
	}
	return { value: best, agree: bestN, total: votes.length, confidence: votes.length ? bestN / votes.length : 0 };
}

/**
 * Build the verification provider-map fragment.
 * @param opts.checks  extra deterministic checkers merged over the defaults.
 * @returns { Verify: { check }, Vote: { tally } }
 */
function createVerifier( opts ) {
	opts = opts || {};
	var lib = Object.assign({}, checks, opts.checks);

	return {
		// Verify::check — independent verdict provider. Concept wiring:
		//   { provider:['Verify::check'],
		//     verify: { target:'$x', check:'range', params:{min:0,max:100}, as:'x' } }
		// Emits <as>Verdict / <as>Verified / <as>Reason / <as>VerifiedAgainst — never $x itself.
		Verify: {
			check: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({}, concept._schema && concept._schema.verify, argz && argz[0]),
				    prefix = cfg.as || concept._name,
				    checker = lib[cfg.check],
				    value = graph.getRef(cfg.target, scope),
				    res = checker ? checker(value, cfg.params || {}) : { pass: false, reason: 'unknown-check:' + cfg.check },
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[prefix + 'Verdict'] = res.pass ? 'pass' : 'fail';
				facts[prefix + 'Verified'] = res.pass;
				facts[prefix + 'Reason'] = res.reason;
				facts[prefix + 'VerifiedAgainst'] = cfg.check;
				cb(null, facts);
			}
		},
		// Vote::tally — k-of-n consensus. Concept wiring:
		//   { require:['votes'], ensure:['$votes.length == $expected'], provider:['Vote::tally'],
		//     vote: { votesKey:'votes', as:'' } }
		// Emits <as>consensus / <as>confidence / <as>agree / <as>total (flat by default).
		Vote: {
			tally: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({}, concept._schema && concept._schema.vote, argz && argz[0]),
				    prefix = cfg.as || '',
				    votes = graph.getRef(cfg.votesKey || 'votes', scope) || [],
				    m = majority(votes),
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[prefix + 'consensus'] = m.value;
				facts[prefix + 'confidence'] = m.confidence;
				facts[prefix + 'agree'] = m.agree;
				facts[prefix + 'total'] = m.total;
				cb(null, facts);
			}
		}
	};
}

module.exports = { createVerifier: createVerifier, checks: checks, majority: majority };
