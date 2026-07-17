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
 * debug-provider.js — a STRUCTURAL debugging provider for the distillation kill-gate (B-thin;
 * `docs/WIP/specs/2026-06-30-distill-killgate-construct-method-design.md`).
 *
 * It snaps a bug to typed facts (the canonicalization barrier, `canonicalize.canonFacts`) and emits a
 * MULTI-OBJECT decomposition sub-graph `Bug → Hypothesis → Localize → Fix(target)` whose typed content
 * (`fixKind`, the intermediate `role`s) is a FUNCTION of the typed `bugClass` — so the cast is
 * signature-determined and therefore crystallizable into a re-mountable `Method` (`crystallizeStructural`).
 * The free text rides an UNTRACKED `debugProse` key (it stays in the model, off the dependency edges).
 *
 * Two non-negotiables it obeys (CLAUDE.md):
 *   • a flat length-1 fact patch is SKIPPED by the structural miner (`mine.js`), so the cast emits a
 *     multi-object sub-graph (intermediate nodes + child segments);
 *   • a wired provider does NOT auto-flag its cast, so the head template sets BOTH the cast marker
 *     `{ DebugStep:true }` and a DISTINCT durable re-fire guard `{ Decomposed:true }` (the gotcha).
 *
 * `ask` is INJECTABLE: a deterministic stub in tests, the real model in the live harness — so the
 * deterministic backbone and the live measurement share ONE code path. `classify(rawJSON)` decides the
 * typed class (a deterministic table in the stub; the canon barrier on the model's JSON, live).
 *
 * @param opts.ask         async ({system,user,maxTokens}) -> string (the model, or a stub).
 * @param opts.parseJSON   JSON-salvage fn. Default JSON.parse.
 * @param opts.classify    (rawJSON) -> { bugClass, fixKind }. The typed-class decision.
 * @param opts.factsSchema optional override of the closed enum vocab for { bugClass, fixKind }.
 * @returns { AI: { debugStep } }  a provider-map fragment (concept provider ref `AI::debugStep`).
 */
var canonicalize = require('../../../lib/providers/canonicalize.js');

var DEFAULT_FACTS = {
	bugClass: { enum: ['off-by-one', 'null-deref', 'wrong-branch', 'type-mismatch', 'resource-leak'] },
	fixKind:  { enum: ['adjust-bound', 'guard-null', 'fix-cond', 'cast', 'release'] },
};

function makeDebugProvider( opts ) {
	opts = opts || {};
	var ask         = opts.ask;
	var parseJSON   = opts.parseJSON || JSON.parse;
	var classify    = opts.classify;
	var factsSchema = opts.factsSchema || DEFAULT_FACTS;

	return { AI: {
		debugStep: function ( graph, concept, scope, argz, cb ) {
			var base = scope._._id, origin = scope._.originNode, target = scope._.targetNode;
			var sys = 'You debug code. Decompose the bug into hypothesis / localize / fix. ' +
			          'Respond ONLY JSON: {"bugClass":"...","hypothesis":"...","fix":"..."}';
			var usr = 'Failing test: ' + (scope._.failingTest || '?') + '\n' +
			          'Bug: ' + (scope._.bugText || scope._.label || base);
			Promise.resolve(ask({ system: sys, user: usr, maxTokens: 600 }))
				.then(function ( txt ) {
					graph.traceProvider && graph.traceProvider(concept, scope, { prompt: { system: sys, user: usr }, reply: txt });
					var raw = parseJSON(txt);
					var cls = classify(raw);                              // host/stub picks the typed class
					var cf  = canonicalize.canonFacts({ bugClass: cls.bugClass, fixKind: cls.fixKind }, factsSchema);
					var fixKind = cf.facts.fixKind;
					var h = base + '_h', l = base + '_l';
					var head = { $_id: '_parent', DebugStep: true, Decomposed: true,
					             debugProse: (raw && ((raw.hypothesis || '') + ' | ' + (raw.fix || ''))) };
					if ( cf.misses.length ) head.DebugStepCanonMiss = cf.misses;   // visible + fail-closed (un-cacheable)
					Object.assign(head, cf.facts);                        // ONLY declared, snapped keys -> TRACKED
					cb(null, [
						head,
						{ _id: h, Node: true, role: 'hypothesis', fixKind: fixKind },
						{ _id: l, Node: true, role: 'localize' },
						{ _id: base + '_a0', Segment: true, originNode: origin, targetNode: h, parentSeg: base },
						{ _id: base + '_a1', Segment: true, originNode: h, targetNode: l, parentSeg: base },
						{ _id: base + '_a2', Segment: true, originNode: l, targetNode: target, parentSeg: base },
					]);
				})
				.catch(function ( e ) { cb(null, { $_id: '_parent', DebugStep: true, Decomposed: true, llmError: e.message }); });
		},
	} };
}

module.exports = { makeDebugProvider: makeDebugProvider };
