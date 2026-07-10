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
 * Reason-loop — the packaged `AI::*` provider set that drives `concepts/_substrate` end-to-end.
 * The LLM generalization of `examples/poc/trip-decompose.js#makeTripProviders` (which used canned
 * content). Roadmap P1.a / GAP A of `doc/WIP/2026-07-05-combos-design.md §11`.
 *
 * WHY THIS EXISTS. `concepts/_substrate/Task/*` + `Claim/*` NAME `AI::evalComplexity/expand/answer/
 * reportUp/rollup/confidence` but the library ships NO `AI::` provider — so the answer loop never
 * runs: an unwired provider silently auto-flags its concept (Concept.js:239) without writing
 * `complexityClass`, so `Atomic`/`Compound` never cast and no `Answer` is ever produced. This brick
 * supplies the set, each fn emitting the EXACT marker its concept gates on (mirroring the proven
 * trip markers — `tests/integration/poc-decompose.test.js`):
 *
 *   Task/EvalComplexity   -> { EvalComplexity, complexityClass:'atomic'|'compound' }  (enum, canon-snapped)
 *   .../Compound/Expansion-> { Expansion, expandedInto } + child Node/Segment templates (the AND hyper-edge)
 *   Task/Answer           -> { Answer, answer }         (concept's own applyMutations sets `Answered`)
 *   Task/ReportUp         -> push self-id into parent.answeredBy (deterministic, race-free {__push})
 *   Task/Rollup           -> { Rollup, answer }         (fires on the .length completion gate)
 *   Claim/Confidence      -> { Confidence, confBand }   (a SNAPPED band, never a raw float — K1/A2)
 *
 * Plus the INTAKE→TASK BRIDGE (GAP B): `AI::seedTask` turns a typed Intake node into a root Task
 * Segment carrying the question, so the answer loop has something to run on (without it the intake
 * and the loop are two disconnected sub-graphs). A host wires the matching concept
 * `concepts/_substrate/Intake/ToTask.json` (require Intake, ensure IntakeStatus=='typed').
 *
 * TERMINATION + TYPED REFUSAL (answer-side). A depth FLOOR forces `atomic` at `maxDepth`. A model
 * reply that can't be snapped to a class (eval) or yields no steps (expand) emits `strategiesExhausted`
 * WITHOUT a class/children — so the task neither answers nor expands and lands in `Frontier/Stuck`
 * (`ensure:["$strategiesExhausted"]`, previously never written — GAP C), a readable answer-side refusal,
 * instead of re-firing to the apply-cap. `strategiesExhausted` is placed only on eval/expand (whose
 * concepts do NOT force `Answered`); the answer concept's own `applyMutations` sets `Answered`, so an
 * answer-call failure is surfaced as an errored answer (`llmError`), not a stuck state.
 *
 * FAITHFUL to the substrate authoring: each provider USES the concept's declared `prompt` (interpolated
 * `${label}` etc.) and, where the concept declares `prompt.facts`, the canonicalization barrier
 * (`canonicalize.canonFacts`) to snap the enum — the same K1 discipline as `LLM::complete`/`Intake`.
 * Provider-cast-marker GOTCHA honored: every returned template self-flags its concept `_name`.
 *
 * @param opts.ask       async ({system,user,maxTokens}) -> string. REQUIRED (throws otherwise).
 * @param opts.parseJSON JSON-salvage fn. Default `llm.parseJSON`.
 * @param opts.maxDepth  decomposition depth floor (forces atomic at/after it). Default 2.
 * @param opts.maxBranch max sub-steps per expand. Default 5.
 * @param opts.namespace provider namespace. Default 'AI'.
 * @returns { AI: { seedTask, evalComplexity, expand, answer, reportUp, rollup, confidence } }
 */

var llm = require('./llm');
var canonicalize = require('./canonicalize');

function createReasonLoop( opts ) {
	opts = opts || {};
	var ask = opts.ask;
	if ( typeof ask !== 'function' )
		throw new Error('createReasonLoop needs opts.ask (an async ({system,user,maxTokens}) -> string)');
	var parseJSON = opts.parseJSON || llm.parseJSON,
	    maxDepth   = opts.maxDepth == null ? 2 : opts.maxDepth,
	    maxBranch  = opts.maxBranch || 5,
	    namespace  = opts.namespace || 'AI';

	// the task's text: the segment label (the sub-problem) or the raw question on a seed node.
	function taskText( scope ) { return scope._.rawText || scope._.label || ''; }

	// the concept's authored prompt (interpolated), with a default when the concept ships none.
	function promptOf( concept, scope, graph, dflt ) {
		var p = (concept._schema && concept._schema.prompt) || {};
		return {
			system : llm.interpolate(p.system, graph, scope) || dflt.system,
			user   : llm.interpolate(p.user, graph, scope) || dflt.user,
			facts  : p.facts,
			prose  : p.prose
		};
	}
	function trace( graph, concept, scope, io ) { if ( graph.traceProvider ) graph.traceProvider(concept, scope, io); }

	var ns = {};
	ns[namespace] = {
		// ── BRIDGE (GAP B): a typed intake seeds a root Task Segment carrying the question ──────────
		seedTask: function ( graph, concept, scope, argz, cb ) {
			var id = scope._._id,
			    q  = scope._.rawText || scope._.intakeNarrative || scope._.label || '';
			cb(null, [
				{ $_id: '_parent', ToTask: true },                                         // self-flag (GOTCHA)
				{ _id: id + '_start', Node: true, label: '(question)' },                   // fresh endpoints (NOT the intake node,
				{ _id: id + '_goal', Node: true, label: '(answer)' },                      //  which is not a segment endpoint)
				{ _id: id + '_task', Segment: true, originNode: id + '_start', targetNode: id + '_goal',
				  depth: 0, label: q }                                                     // the root Task (label, NOT rawText:
				                                                                           //  rawText re-triggers Intake → runaway)
			]);
		},

		// ── EvalComplexity: atomic vs compound, canon-snapped to the concept's enum ────────────────
		evalComplexity: function ( graph, concept, scope, argz, cb ) {
			var depth = scope._.depth || 0;
			if ( depth >= maxDepth )                                                       // depth floor → terminate
				return cb(null, { $_id: '_parent', EvalComplexity: true, complexityClass: 'atomic' });
			var pr     = promptOf(concept, scope, graph, {
				    system: 'Classify whether the task is "atomic" (answerable directly in one step) or "compound" (needs breaking into sub-steps).',
				    user  : 'Task: ' + taskText(scope) }),
			    schema = pr.facts || { complexityClass: { enum: ['atomic', 'compound'] } };
			Promise.resolve()
				.then(function () { return ask({ system: pr.system + ' Reply ONLY JSON: {"complexityClass":"atomic"|"compound"}.', user: pr.user, maxTokens: 80 }); })
				.then(function ( txt ) {
					trace(graph, concept, scope, { reply: txt });
					var cf = canonicalize.canonFacts(parseJSON(txt), schema);
					if ( cf.misses.length || !cf.facts.complexityClass )                    // no snappable class → no strategy
						return cb(null, { $_id: '_parent', EvalComplexity: true, strategiesExhausted: true });
					cb(null, { $_id: '_parent', EvalComplexity: true, complexityClass: cf.facts.complexityClass });
				})
				.catch(function ( e ) { cb(null, { $_id: '_parent', EvalComplexity: true, strategiesExhausted: true, llmError: e.message }); });
		},

		// ── Expansion: the AND hyper-edge of child sub-segments ────────────────────────────────────
		expand: function ( graph, concept, scope, argz, cb ) {
			var pr = promptOf(concept, scope, graph, {
				system: 'Break the task into 2-' + maxBranch + ' ordered sub-steps.',
				user  : 'Task: ' + taskText(scope) });
			Promise.resolve()
				.then(function () { return ask({ system: pr.system + ' Reply ONLY JSON: {"steps":["...","..."]}.', user: pr.user, maxTokens: 400 }); })
				.then(function ( txt ) {
					trace(graph, concept, scope, { reply: txt });
					var r = parseJSON(txt),
					    steps = (r && Array.isArray(r.steps) ? r.steps : []).slice(0, maxBranch)
						.map(function ( s ) { return typeof s === 'string' ? s : (s && (s.name || s.step || s.label)) || ''; })
						.filter(Boolean);
					if ( !steps.length )                                                    // couldn't decompose → stuck
						return cb(null, { $_id: '_parent', Expansion: true, strategiesExhausted: true });
					var base = scope._._id, origin = scope._.originNode, target = scope._.targetNode,
					    depth = (scope._.depth || 0) + 1,
					    childIds = steps.map(function ( _, i ) { return base + '_s' + i; }),
					    tpl = [{ $_id: '_parent', Expansion: true, expandedInto: childIds }],
					    prev = origin;
					steps.forEach(function ( name, i ) {
						var last = i === steps.length - 1, tnode = last ? target : base + '_m' + i;
						if ( !last ) tpl.push({ _id: tnode, Node: true, label: name });
						tpl.push({ _id: childIds[i], Segment: true, originNode: prev, targetNode: tnode,
						           depth: depth, parentSeg: base, label: name });   // label only (no rawText → no re-intake)
						prev = tnode;
					});
					cb(null, tpl);
				})
				.catch(function ( e ) { cb(null, { $_id: '_parent', Expansion: true, strategiesExhausted: true, llmError: e.message }); });
		},

		// ── Answer: terminal prose for an atomic leaf (concept applyMutations sets `Answered`) ──────
		answer: function ( graph, concept, scope, argz, cb ) {
			var pr = promptOf(concept, scope, graph, {
				system: 'Answer the task directly and concisely (max ~4 sentences).',
				user  : 'Task: ' + taskText(scope) });
			Promise.resolve()
				.then(function () { return ask({ system: pr.system, user: pr.user, maxTokens: 500 }); })
				.then(function ( txt ) {
					trace(graph, concept, scope, { reply: txt });
					cb(null, { $_id: '_parent', Answer: true, answer: String(txt).trim() });
				})
				.catch(function ( e ) { cb(null, { $_id: '_parent', Answer: true, answer: '(answer unavailable)', llmError: e.message }); });
		},

		// ── ReportUp: race-free stigmergic fan-in (no LLM) ─────────────────────────────────────────
		reportUp: function ( graph, concept, scope, argz, cb ) {
			cb(null, [
				{ $$_id: scope._.parentSeg, answeredBy: { __push: scope._._id } },
				{ $_id: '_parent', ReportUp: true }
			]);
		},

		// ── Rollup: bounded bottom-up synthesis, fires once on the .length gate ─────────────────────
		rollup: function ( graph, concept, scope, argz, cb ) {
			var kids = (scope._.expandedInto || [])
				.map(function ( id ) { var e = graph.getEtty(id); return e && e._.answer; })
				.filter(function ( a ) { return a != null; });
			var pr = promptOf(concept, scope, graph, {
				system: 'Synthesize the sub-answers into ONE coherent, BOUNDED answer (max ~6 sentences). Do not copy; summarize.',
				user  : null });
			Promise.resolve()
				.then(function () {
					return ask({ system: pr.system,
						user: (pr.user ? pr.user + '\n\n' : 'Task: ' + taskText(scope) + '\n\n') +
						      'Sub-answers:\n' + kids.map(function ( a, i ) { return (i + 1) + '. ' + a; }).join('\n'),
						maxTokens: 700 });
				})
				.then(function ( txt ) {
					trace(graph, concept, scope, { reply: txt });
					cb(null, { $_id: '_parent', Rollup: true, answer: String(txt).trim() });
				})
				.catch(function () { cb(null, { $_id: '_parent', Rollup: true, answer: kids.join(' ') }); });   // fail-soft: concat
		},

		// ── Confidence: a SNAPPED band, canon-checked against the concept's enum ─────────────────────
		confidence: function ( graph, concept, scope, argz, cb ) {
			var pr     = promptOf(concept, scope, graph, {
				    system: 'Rate confidence in the answer as one of: low, medium, high.',
				    user  : 'Task: ' + taskText(scope) + '\nAnswer: ' + (scope._.answer || '') }),
			    schema = pr.facts || { confBand: { enum: ['low', 'medium', 'high'] } };
			Promise.resolve()
				.then(function () { return ask({ system: pr.system + ' Reply ONLY JSON: {"confBand":"low"|"medium"|"high"}.', user: pr.user, maxTokens: 40 }); })
				.then(function ( txt ) {
					var cf = canonicalize.canonFacts(parseJSON(txt), schema);
					cb(null, { $_id: '_parent', Confidence: true, confBand: cf.facts.confBand || 'low' });   // OOB → fail-closed low
				})
				.catch(function () { cb(null, { $_id: '_parent', Confidence: true, confBand: 'low' }); });
		}
	};
	return ns;
}

module.exports = { createReasonLoop: createReasonLoop };
