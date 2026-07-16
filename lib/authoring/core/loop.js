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
 * The "answer a (huge) prompt" loop, as a reusable concept set + helpers.
 *
 *   DECOMPOSE (reactive concepts):  a root segment (start->goal) carrying the prompt
 *     Task            require Segment                 every segment is a Task
 *       EvalComplexity require Task        -> Atomic | NeedsSplit  (depth floor forces Atomic)
 *       Expand         require NeedsSplit  -> child sub-step segments + expandedInto
 *       Answer         require Atomic      -> a leaf answer
 *
 *   SYNTHESIZE — two regimes, same bounded rollup:
 *
 *   (a) DETERMINISTIC post-pass (`synthesize`, the one-shot default): a post-order
 *     walk leaf->root. Race-free, simple, O(V+E); reactivity buys nothing when
 *     everything is cold. Use with `loopConceptTree`.
 *
 *   (b) REACTIVE concepts (`reactiveLoopConceptTree`, the live/standing regime): each
 *     answered segment appends its id to its parent's grow-only `answeredBy` array via
 *     the race-free `{__push}` primitive; a `Rollup` concept gated on
 *     `ensure:["$answeredBy.length == $expandedInto.length"]` (a monotone G-Set
 *     cardinality predicate — §5.2) fires EXACTLY ONCE when the last child reports,
 *     reads the children's bounded answers (ordered by `expandedInto`) and writes the
 *     parent's answer. Synthesis happens IN stabilization, bottom-up, with ZERO core
 *     change (the earlier `+=1` counter would have raced — Entity arrays REPLACE on
 *     update; `{__push}` appends at serialized apply-time). The completion gate keys on
 *     a discrete `.length`, never prose (the #1 typed-fact spine in action).
 *     KNOWN LIMIT: this is reactive on COMPLETION; re-rolling on a live leaf-answer
 *     CONTENT change needs per-child answer-following (the aggregation gap — roadmap #5).
 *
 * Content (eval/expand/answer/rollup) is INJECTED so the same loop runs with
 * deterministic functions (tests) or an LLM (run-prompt.js).
 */

const path = require('path');
const dmerge = require('deepmerge');
const { buildConceptTree } = require('../core/concepts.js');

// ---- the concept set (the "library of concept<->prompt pairs", content-agnostic) ----
// The GRAMMAR lives in FILES, not code (owner: no grammar hard-coded in JS) — loaded from the
// `planner` plugin's `loop` set (plugins/planner/concepts/loop/). The AI:: providers stay
// factory-built at run time (makeDecomposeProviders below); the grammar only names them.
const PLANNER_SETS = path.join(__dirname, '..', '..', '..', 'plugins', 'planner', 'concepts');
const loopConceptTree = buildConceptTree(path.join(PLANNER_SETS, 'loop'));

// The reactive variant: the same decompose concepts PLUS the two reactive-synthesis
// concepts. `ReportUp` (every answered non-root segment) appends its id to its parent's
// `answeredBy`; `Rollup` (every expanded segment) fires once its children all reported.
// Composed as `loop` + the `loop-reactive` extension set with deepmerge — the exact merge
// the engine applies to cfg.conceptSets (Graph.js:189), so this ≡ conceptSets ['loop','loop-reactive'].
var reactiveLoopConceptTree = dmerge(loopConceptTree, buildConceptTree(path.join(PLANNER_SETS, 'loop-reactive')));

/**
 * The decomposition providers. Inject content functions:
 *   evalFn(scope)   -> { atomic: bool }                  (depth floor still applies)
 *   expandFn(scope) -> [{ name, description? }, ...]      ordered sub-steps
 *   answerFn(scope) -> string                             a leaf answer
 *   rollupFn(seg, childAnswers[]) -> string               bounded parent answer (reactive regime)
 * Options: maxDepth (depth floor), maxBranch (cap sub-steps).
 */
function makeDecomposeProviders( opts ) {
	opts          = opts || {};
	var maxDepth  = opts.maxDepth == null ? 2 : opts.maxDepth,
	    maxBranch = opts.maxBranch || 4,
	    evalFn    = opts.evalFn || function () { return { atomic: true }; },
	    expandFn  = opts.expandFn || function () { return []; },
	    answerFn  = opts.answerFn || function () { return ''; },
	    rollupFn  = opts.rollupFn || function ( seg, kids ) { return kids.join(''); };

	// content fns may be sync OR async (LLM) — Promise.resolve handles both
	return {
		AI: {
			evalComplexity: function ( graph, concept, scope, argz, cb ) {
				var depth = scope._.depth || 0;
				if ( depth >= maxDepth ) return cb(null, { $_id: '_parent', EvalComplexity: true, Atomic: true });// depth floor
				Promise.resolve(evalFn(scope)).then(function ( r ) {
					var facts = { $_id: '_parent', EvalComplexity: true };
					facts[(r && r.atomic) ? 'Atomic' : 'NeedsSplit'] = true;
					cb(null, facts);
				}).catch(function ( e ) { cb(null, { $_id: '_parent', EvalComplexity: true, Atomic: true, llmError: e.message }); });
			},
			expand: function ( graph, concept, scope, argz, cb ) {
				Promise.resolve(expandFn(scope)).then(function ( raw ) {
					var steps = (raw || []).slice(0, maxBranch);
					if ( !steps.length ) return cb(null, { $_id: '_parent', Expand: true, Atomic: true });// nothing to split -> leaf
					var base    = scope._._id,
					    origin  = scope._.originNode,
					    target  = scope._.targetNode,
					    depth   = (scope._.depth || 0) + 1,
					    childIds = steps.map(function ( _, i ) { return base + '_s' + i; }),
					    tpl      = [{ $_id: '_parent', Expand: true, expandedInto: childIds }],
					    prev     = origin;
					steps.forEach(function ( st, i ) {
						var last  = i === steps.length - 1,
						    tnode = last ? target : base + '_m' + i;
						if ( !last ) tpl.push({ _id: tnode, Node: true, label: st.name });
						tpl.push({
							_id: childIds[i], Segment: true, originNode: prev, targetNode: tnode,
							depth: depth, parentSeg: base, label: st.name, description: st.description
						});
						prev = tnode;
					});
					cb(null, tpl);
				}).catch(function ( e ) { cb(null, { $_id: '_parent', Expand: true, Atomic: true, llmError: e.message }); });
			},
			answer: function ( graph, concept, scope, argz, cb ) {
				// MUST set its own name (Answer:true) as the self-flag, else the engine
				// keeps seeing the concept as applicable and re-fires it forever.
				Promise.resolve(answerFn(scope)).then(function ( a ) {
					cb(null, { $_id: '_parent', Answer: true, Answered: true, answer: a });
				}).catch(function ( e ) { cb(null, { $_id: '_parent', Answer: true, answer: '(error)', llmError: e.message }); });
			},
			// reactive synthesis: an answered child appends its OWN id to the parent's
			// grow-only `answeredBy` (race-free `{__push}` — distinct ids, no lost update).
			reportUp: function ( graph, concept, scope, argz, cb ) {
				var selfId = scope._._id, parentId = scope._.parentSeg;
				cb(null, [
					{ $$_id: parentId, answeredBy: { __push: selfId } },
					{ $_id: '_parent', ReportUp: true }
				]);
			},
			// fires once the completion gate holds; reads children's answers in
			// `expandedInto` order (deterministic) and writes the BOUNDED parent answer.
			rollup: function ( graph, concept, scope, argz, cb ) {
				var kids = (scope._.expandedInto || []).map(function ( id ) {
					var e = graph.getEtty(id);
					return e && e._.answer;
				});
				Promise.resolve(rollupFn(scope._, kids)).then(function ( ans ) {
					cb(null, { $_id: '_parent', Rollup: true, Answered: true, answer: ans });
				}).catch(function ( e ) { cb(null, { $_id: '_parent', Rollup: true, Answered: true, answer: '(error)', llmError: e.message }); });
			}
		}
	};
}

/**
 * Bottom-up synthesis: post-order walk from rootId; each non-leaf segment's answer
 * is rollupFn(segmentFacts, childAnswers) (which MUST be bounded — a summary, not a
 * concatenation, in real use). Writes the answer back onto each segment (so it's in
 * the graph + traced) and returns the root answer. Race-free (deterministic walk).
 *
 * @param graph
 * @param rootId   the root segment id
 * @param rollupFn (segFacts, childAnswers[]) -> answer string
 */
function synthesize( graph, rootId, rollupFn ) {
	// async: rollupFn may be an LLM call. Post-order, sequential (leaves first).
	async function answerOf( segId ) {
		var o = graph.getEtty(segId);
		if ( !o ) return undefined;
		var e    = o._,
		    kids = e.expandedInto || [];
		if ( !kids.length ) return e.answer;// leaf: already answered by the Answer concept
		var childAnswers = [];
		for ( var i = 0; i < kids.length; i++ ) childAnswers.push(await answerOf(kids[i]));
		var ans = await rollupFn(e, childAnswers);
		graph.pushMutation({ $$_id: segId, answer: ans, Synthesized: true }, segId);
		return ans;
	}
	return answerOf(rootId);
}

module.exports = {
	loopConceptTree        : loopConceptTree,
	reactiveLoopConceptTree: reactiveLoopConceptTree,
	makeDecomposeProviders : makeDecomposeProviders,
	synthesize             : synthesize
};
