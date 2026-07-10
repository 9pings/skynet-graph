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
	    // G-1: an optional (factsSchema)->resolvedSchema seam so a concept can REFERENCE registry keys (`{ref:'severity'}`)
	    // instead of inlining the enum+ring — the host wires it (`resolveFacts: fs => registry.resolveFactsSchema(fs,reg).facts`)
	    // WITHOUT intake (a provider) depending on the authoring registry (no layer inversion). Default: identity.
	    resolveFacts = opts.resolveFacts || function ( fs ) { return fs; },
	    // G-1 rung-2 CONNECTIVE INGEST (host opt-in, default absent → the front door behaves exactly as before): the
	    // borderline-only LLM gate (`makeBorderlineSnap(...)`). On a barrier CanonMiss it (a) yields a PROVISIONAL member
	    // for THIS run's dispatch — surfaced on the untracked `<name>Borderline` audit fact, kept OUT of the typed spine /
	    // digest so it stays un-cacheable (the miss is unchanged for status/digest) — and (b) emits a propose-only ring
	    // proposal that we DEPOSIT into the autonomous convergence loop (a fresh proxy node) so the exogenous vocabulary
	    // grows. SOUNDNESS (Laurie confront): the load is on model-INDEPENDENT floors (provisional-un-cacheable here +
	    // retractRingAlias de-lock + provenance in the registry), not on trusting the oracle; the model is a tunable.
	    borderlineSnap = opts.borderlineSnap,
	    // the proxy-node deposit template. Default inline (intake stays standalone — no authoring dep); a host may wire
	    // `proposalTemplate: registry.proposalTemplate` for a single source of truth. Fields = the RegistryMerge contract.
	    proposalTemplate = opts.proposalTemplate || function ( p, id ) {
		    return { $$_id: id, proposalKey: p.key, proposalAlias: p.alias, proposalMember: p.member, proposalVia: p.via };
	    },
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
					// resolve any `{ref:'key'}` fact specs against the registry (host-wired seam) → the ring lives in the registry.
					var raw = _parseJSON(txt),
					    rfacts = resolveFacts(cfg.facts || {}),
					    cf  = canonicalize.canonFacts(raw, rfacts);
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
					// surface the required subset explicitly (untracked, un-cacheable): `<name>CanonMiss` carries
					// ALL misses (required+optional); `<name>Missing` is the decision-bearing subset a typed REFUSAL
					// names ("missing required: [...]"). Reading it downstream is a pure fact-read, no re-derivation.
					if ( reqMiss.length ) facts[name + 'Missing'] = reqMiss;

					// --- G-1 rung-2 CONNECTIVE INGEST: consult the borderline gate on the barrier MISSES only (LAST resort) ---
					// The provisional resolutions ride on `<name>Borderline` (audit + dispatch) but the keys STAY misses, so
					// the typed-spine status/digest below are UNCHANGED (un-cacheable — the guess never mints typed truth on
					// THIS run; the ring-grown convergence, if any, lands on a LATER run through the deterministic barrier).
					// Each proposal is deposited on a fresh proxy node → the autonomous RegistryMerge loop admits it.
					var targetId = (scope && scope._ && scope._._id) || (concept && concept._id),
					    proposalNodes = [];
					var borderStep = (!borderlineSnap || !misses.length) ? Promise.resolve() : (function () {
						var provisional = [];
						return misses.reduce(function ( chain, key ) {
							return chain.then(function () {
								var spec = rfacts[key] || {}, src = spec.from != null ? spec.from : key;
								return Promise.resolve(borderlineSnap(raw[src], spec)).then(function ( r ) {
									if ( !r || r.miss || !r.provisional ) return;               // still out-of-vocab → the existing CanonMiss escalation
									provisional.push({ key: key, member: r.value });            // best-effort dispatch value (un-cacheable)
									if ( r.proposal ) proposalNodes.push(proposalTemplate(
										{ key: key, alias: r.proposal.alias, member: r.proposal.member, via: r.via || 'llm-borderline' },
										name + '-prop-' + targetId + '-' + key));               // stable id per (node,concept,key) → idempotent, one fire
								});
							});
						}, Promise.resolve()).then(function () {
							if ( provisional.length ) facts[name + 'Borderline'] = provisional;   // UNTRACKED audit fact (keys remain misses)
						});
					})();

					// --- optional independent back-check (verify.js discipline) ---
					return borderStep
						.then(function () { return backCheck ? backCheck(graph, concept, scope, cf.facts, raw) : undefined; })
						.then(function ( bc ) {
							var verified = (bc === undefined) ? undefined : (bc === true || bc === 'pass');
							if ( verified !== undefined ) facts[name + 'Verified'] = verified ? 'pass' : 'fail';

							// --- the discrete gate: typed | partial | untyped (borderline provisionals do NOT clear a miss) ---
							var status = (reqMiss.length || verified === false) ? 'untyped'
							           : (misses.length ? 'partial' : 'typed');
							facts[statusKey] = status;

							// --- Invariant 2: a REUSABLE digest is minted ONLY for a faithful (typed) projection ---
							if ( cfg.digest !== false && status === 'typed' ) facts[name + 'FactsDigest'] = canonicalize.digest(cf.facts);

							// deposit the propose-only ring proposals alongside the _parent mutation (array template)
							cb(null, proposalNodes.length ? [facts].concat(proposalNodes) : facts);
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

/**
 * The DEPTH back-check (closes C0 "back-check depth", roadmap FINIR F5) — a ready-made INDEPENDENT verifier
 * of the typed projection against its source PROSE, pluggable straight into `createIntake({ backCheck })`.
 * CEGIS-style re-check: a SEPARATE model call (verify.js independence discipline — never grade with the call
 * that produced the extraction; ideally a different model) is shown the prose and the canonicalized facts and
 * must judge faithfulness per key. A 'fail' downgrades the intake to `untyped` (Invariant 2: a doubted
 * projection never mints a reusable digest); the judged-wrong keys land on the scope via `opts.onBlame` for
 * localized blame (which key to re-extract), not just a global veto.
 *
 * PROSE SOURCE: `opts.proseOf(scope, concept)` — default reads the common inbound keys off the target object
 * (`prose`, `text`, `message`, `q`). When no prose is found the check ABSTAINS (returns undefined → the hook
 * records no verdict) rather than vetoing blind — wire proseOf explicitly on a non-standard shape.
 * A checker-call REJECTION propagates (the intake's catch → llmError + `untyped`): fail-closed, never certify
 * on a broken verifier. An unparseable verdict is a 'fail' (can't verify → don't trust).
 *
 * @param opts.ask       REQUIRED async ({system,user,maxTokens}) -> text — the independent checker.
 * @param opts.proseOf   (scope, concept) -> string — where the source prose lives (see default above).
 * @param opts.system    override the strict-verifier prompt.
 * @param opts.onBlame   optional (wrongKeys, scope, concept) => void — receives the judged-wrong keys.
 * @param opts.maxTokens verdict budget (default 96).
 * @returns a `backCheck(graph, concept, scope, facts, raw)` -> Promise<'pass'|'fail'|undefined>
 */
function makeProseBackCheck( opts ) {
	opts = opts || {};
	var ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('makeProseBackCheck needs opts.ask (an INDEPENDENT checker call)');
	var _parseJSON = opts.parseJSON || llm.parseJSON;
	var maxTokens = opts.maxTokens || 96;
	var system = opts.system || 'You are a strict verifier. Given a PROSE statement and TYPED FACTS extracted from it, '
		+ 'judge whether EVERY fact value is supported by the prose. Reply ONLY the JSON '
		+ '{"faithful": true|false, "wrong": ["<factKey>", ...]} — wrong lists the unsupported keys. '
		+ 'Judge only; never correct the facts.';
	var proseOf = opts.proseOf || function ( scope ) {
		var o = scope && scope._ || {};
		return String(o.prose || o.text || o.message || o.q || '').trim();
	};
	return function backCheck( graph, concept, scope, facts /*, raw */ ) {
		var prose = proseOf(scope, concept);
		if ( !prose ) return Promise.resolve(undefined);   // nothing to check against → abstain, never veto blind
		return ask({ system: system, user: 'PROSE: ' + prose + '\nTYPED FACTS: ' + JSON.stringify(facts), maxTokens: maxTokens })
			.then(function ( reply ) {
				var v;
				try { v = _parseJSON(reply); } catch ( e ) { v = null; }
				if ( !v || typeof v.faithful !== 'boolean' ) return 'fail';   // unverifiable → don't trust
				var wrong = Array.isArray(v.wrong) ? v.wrong : [];
				if ( (!v.faithful || wrong.length) && typeof opts.onBlame === 'function' ) opts.onBlame(wrong, scope, concept);
				return (v.faithful && !wrong.length) ? 'pass' : 'fail';
			});
	};
}

module.exports = { createIntake: createIntake, makeProseBackCheck: makeProseBackCheck };
