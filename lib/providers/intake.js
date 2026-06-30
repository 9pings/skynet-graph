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
 * Intake — C0, the prose→typed FRONT DOOR (roadmap §3.2; the runtime realization of the
 * published P4 boundary, `artifact/paper-dll/p4-coverage.js`).
 *
 * It is the ONE place free-text prose crosses into the typed world, and the system's
 * declared SOUNDNESS BOUNDARY. `Intake::type` is a specialization of `LLM::complete`
 * (it reuses the SAME canonicalization barrier, `canonicalize.js`) plus three additions
 * that make the boundary *gated and visible* rather than silently crossed:
 *
 *   1. a DISCRETE gate fact `IntakeStatus ∈ typed | partial | untyped` — downstream
 *      concepts MUST `ensure:["$IntakeStatus=='typed'"]`. A `required` key that came back
 *      out-of-vocabulary makes the intake `untyped` (decision-bearing miss); an optional-
 *      only miss makes it `partial`; a clean snap makes it `typed`.
 *   2. a MISS-AWARE `<name>FactsDigest`: emitted ONLY when `typed`. This closes a latent
 *      false-memo-hit (see "Invariant 2" below).
 *   3. an optional independent BACK-CHECK (verify.js discipline): a failed back-check
 *      downgrades to `untyped` even with a clean snap.
 *
 * Two non-negotiables (CLAUDE.md "Typed-fact discipline"; doc/MODELISATION.md §4.2):
 *   • never let prose silently RE-KEY the memo (K1 fragmentation), and
 *   • never FALSE-ADMIT a prose-derived value as if typed.
 *
 * ── Invariant 2 (the load-bearing soundness fix) ────────────────────────────────────────
 * `LLM::complete` digests `cf.facts` unconditionally (llm.js). When a key came back
 * out-of-vocabulary, `canonicalize.canonValue` returns its *default* (e.g. `null`), so two
 * textually-distinct, semantically-DIFFERENT out-of-vocab inputs both produce `{k:null}` →
 * the SAME `digest` → a latent false memo hit (the next same-default record reuses the wrong
 * typing). C0 refuses to mint a reusable digest unless the projection is faithful (`typed`).
 *
 * Note (a critique that mattered): folding the miss-key list into the digest —
 * `digest({...facts, __miss: misses})` — is NOT a sufficient fix. Two distinct inputs that
 * miss the SAME required key produce identical `{k:null, __miss:[k]}` and STILL collide. The
 * only sound horn is "no reusable digest when not typed": out-of-vocabulary genuinely is not
 * K1-canonicalizable, so the typed projection is not a valid key for it. The CanonMiss marker
 * additionally makes such a result un-cacheable (cache.js#defaultCanonMiss), so a non-typed
 * intake is never stored and never collides in the provider cache either.
 *
 * Degradation (= P4's "non-K1 degrades COST not CORRECTNESS"):
 *   fully in-vocab        → typed   / digest emitted / memoized        / 0 repeat-cost
 *   optional miss only    → partial / no digest      / CanonMiss→un-cacheable / 1 call + escalate
 *   required miss / bad   → untyped / no digest      / CanonMiss→un-cacheable / 1 call + escalate
 *                                                                       + raw prose preserved
 *
 * Escalation (widen vocab / micro-LLM / human / vocab-extension) is HOST-OWNED by design:
 * the boundary is made visible (`IntakeStatus`, `<name>CanonMiss`, the preserved prose); what
 * to do about a miss is a host policy, routed off the discrete status fact.
 *
 * Concept wiring:
 *   { "require": ["rawText"], "provider": ["Intake::type"],
 *     "prompt": { "system": "...", "user": "${rawText}",
 *                 "facts": { "severity": { "enum": ["low","high"] } },   // CLOSED vocab
 *                 "prose": "intakeNarrative" },                          // untracked remainder
 *     "intake": { "required": ["severity"] } }                          // decision-bearing keys
 *   downstream: { "require": ["Intake"], "ensure": ["$IntakeStatus=='typed'"], ... }
 */

var canonicalize = require('./canonicalize');
var llm = require('./llm');

/**
 * Build the Intake provider-map fragment.
 * @param opts.ask        async ({system,user,maxTokens}) -> string. Defaults to the bundled client.
 * @param opts.parseJSON  JSON-salvage fn. Defaults to llm.parseJSON.
 * @param opts.backCheck  optional independent verifier (graph,concept,scope,facts,raw) ->
 *                        bool | 'pass' | 'fail' | Promise<…>. A falsy/'fail' verdict downgrades
 *                        the intake to `untyped` (the typed projection is not trustworthy).
 *                        Apply verify.js independence discipline (don't grade with the same call).
 * @param opts.namespace  provider namespace key. Default 'Intake'.
 * @returns { Intake: { type } }
 */
function createIntake( opts ) {
	opts = opts || {};
	var ask        = opts.ask || llm.makeAsk(opts),
	    _parseJSON = opts.parseJSON || llm.parseJSON,
	    backCheck  = opts.backCheck,
	    namespace  = opts.namespace || 'Intake';

	var ns = {};
	ns[namespace] = {
		type: function ( graph, concept, scope, argz, cb ) {
			// schema lives under `prompt` (system/user/facts/prose — so validate.js recognizes the
			// prose contract) + the NEW bits under `intake` (required/statusKey); argz overrides both.
			var cfg  = Object.assign({}, concept._schema && concept._schema.prompt,
			                             concept._schema && concept._schema.intake,
			                             argz && argz[0]),
			    name = concept._name,
			    sys  = llm.interpolate(cfg.system, graph, scope),
			    usr  = llm.interpolate(cfg.user, graph, scope),
			    required  = cfg.required || [],
			    statusKey = cfg.statusKey || 'IntakeStatus';

			Promise.resolve()
				.then(function () { return ask({ system: sys, user: usr, maxTokens: cfg.maxTokens }); })
				.then(function ( txt ) {
					graph.traceProvider && graph.traceProvider(concept, scope, { prompt: { system: sys, user: usr }, reply: txt });

					var facts = { $_id: '_parent' };
					facts[name] = true;                                   // self-flag (provider-cast-marker gotcha)

					// --- the canonicalization barrier (REUSED, not re-implemented) ---
					var raw = _parseJSON(txt),
					    cf  = canonicalize.canonFacts(raw, cfg.facts || {});
					Object.assign(facts, cf.facts);                       // ONLY declared discrete keys, snapped -> TRACKED
					var misses = cf.misses;
					if ( misses.length ) facts[name + 'CanonMiss'] = misses;   // visible + fail-closed (untracked, un-cacheable)

					// the terminal, UNTRACKED free text (stays in the model)
					var proseKey = cfg.prose || (name + 'Prose'),
					    proseVal = cfg.proseFrom != null ? raw[cfg.proseFrom]
					             : (raw && raw.prose != null ? raw.prose : txt);
					facts[proseKey] = proseVal;

					// a required key that came back out-of-vocab = a DECISION-BEARING miss
					var reqMiss = required.filter(function ( k ) { return misses.indexOf(k) !== -1; });

					// --- optional independent back-check (verify.js discipline) ---
					return Promise.resolve(backCheck ? backCheck(graph, concept, scope, cf.facts, raw) : undefined)
						.then(function ( bc ) {
							var verified = (bc === undefined) ? undefined : (bc === true || bc === 'pass');
							if ( verified !== undefined ) facts[name + 'Verified'] = verified ? 'pass' : 'fail';

							// --- the discrete gate: typed | partial | untyped ---
							var status = (reqMiss.length || verified === false) ? 'untyped'
							           : (misses.length ? 'partial' : 'typed');
							facts[statusKey] = status;

							// --- Invariant 2: a REUSABLE digest is minted ONLY for a faithful (typed) projection ---
							if ( cfg.digest !== false && status === 'typed' ) facts[name + 'FactsDigest'] = canonicalize.digest(cf.facts);

							cb(null, facts);
						});
				})
				.catch(function ( e ) {
					var facts = { $_id: '_parent', llmError: e.message };
					facts[name] = true;
					facts[cfg && cfg.statusKey || 'IntakeStatus'] = 'untyped';   // an errored intake is never 'typed'
					cb(null, facts);
				});
		}
	};
	return ns;
}

module.exports = { createIntake: createIntake };
