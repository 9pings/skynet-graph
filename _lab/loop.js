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
 *   SYNTHESIZE (deterministic bottom-up post-pass): each parent's answer is a BOUNDED
 *     rollup of its children's answers, leaf->root. Done as a post-stabilization walk
 *     (not reactive concepts) on purpose: a counter-gated reactive rollup has a
 *     read-modify-write race under async (LLM) providers; a post-order walk is
 *     race-free, simple, and sufficient for one-shot answering. (Reactive
 *     re-synthesis on live-data change is a later refinement.)
 *
 * Content (eval/expand/answer/rollup) is INJECTED so the same loop runs with
 * deterministic functions (tests) or an LLM (run-prompt.js).
 */

// ---- the concept set (the "library of concept<->prompt pairs", content-agnostic) ----
const loopConceptTree = {
	childConcepts: {
		Task: {
			_id: 'Task', _name: 'Task', require: 'Segment',
			childConcepts: {
				EvalComplexity: { _id: 'EvalComplexity', _name: 'EvalComplexity', require: ['Task'], provider: ['AI::evalComplexity'] },
				Expand        : { _id: 'Expand', _name: 'Expand', require: ['Task', 'NeedsSplit'], provider: ['AI::expand'] },
				Answer        : { _id: 'Answer', _name: 'Answer', require: ['Task', 'Atomic'], provider: ['AI::answer'] }
			}
		}
	}
};

/**
 * The decomposition providers. Inject content functions:
 *   evalFn(scope)   -> { atomic: bool }                  (depth floor still applies)
 *   expandFn(scope) -> [{ name, description? }, ...]      ordered sub-steps
 *   answerFn(scope) -> string                             a leaf answer
 * Options: maxDepth (depth floor), maxBranch (cap sub-steps).
 */
function makeDecomposeProviders( opts ) {
	opts          = opts || {};
	var maxDepth  = opts.maxDepth == null ? 2 : opts.maxDepth,
	    maxBranch = opts.maxBranch || 4,
	    evalFn    = opts.evalFn || function () { return { atomic: true }; },
	    expandFn  = opts.expandFn || function () { return []; },
	    answerFn  = opts.answerFn || function () { return ''; };

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

module.exports = { loopConceptTree: loopConceptTree, makeDecomposeProviders: makeDecomposeProviders, synthesize: synthesize };
