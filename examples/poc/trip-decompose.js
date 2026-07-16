'use strict';
/**
 * PoC M1 — decompose a trip on the UNIVERSAL grammar (concepts/_substrate), with canned
 * (deterministic, no-LLM) content. Proves the authored universal layer STABILIZES
 * end-to-end on the real engine: decompose (Task -> Complexity -> Compound -> Expansion)
 * -> answer the atomic leaves -> reactive bottom-up Rollup (race-free {__push} + a
 * .length completion gate) -> the Claim / Verification / Trusted defeasance chain.
 *
 * The grammar is domain-agnostic; only the four content functions (eval/expand/answer/
 * rollup) carry the trip. Swap them (or an LLM) and the same grammar runs.
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M1).
 *   node examples/poc/trip-decompose.js
 */
global.__SERVER__ = true;
const path = require('path');
const Graph = require('../../lib/graph/index.js');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');

const SUBSTRATE = path.join(__dirname, '..', '..', 'concepts', '_substrate');

// the domain part: a Paris -> Tokyo trip (the grammar above is universal).
const TRIP = {
	evalFn  : () => ({ atomic: false }),                              // the root is compound
	expandFn: () => [{ name: 'Book flights' }, { name: 'Arrange lodging' }, { name: 'Plan local transport' }],
	answerFn: (scope) => 'DONE[' + scope._.label + ']',
	rollupFn: (seg, kids) => '{' + kids.join(' + ') + '}'             // bounded fold (a summary, not a dump)
};

// the decompose / reactive-synthesis providers, wired to the _substrate concept NAMES.
// Note the _substrate routing: EvalComplexity writes a distinct `complexityClass` enum
// (the concept self-flag would collide with the value — engine finding #20); Atomic /
// Compound gate on it; Expansion (under Compound) emits the AND hyper-edge.
function makeTripProviders( opts ) {
	opts = opts || {};
	const maxDepth = opts.maxDepth == null ? 1 : opts.maxDepth, maxBranch = opts.maxBranch || 4;
	const evalFn = opts.evalFn || TRIP.evalFn, expandFn = opts.expandFn || TRIP.expandFn,
	      answerFn = opts.answerFn || TRIP.answerFn, rollupFn = opts.rollupFn || TRIP.rollupFn;
	return {
		AI: {
			evalComplexity( graph, concept, scope, argz, cb ) {
				const depth = scope._.depth || 0;
				const cls = depth >= maxDepth ? 'atomic' : ((evalFn(scope) || {}).atomic ? 'atomic' : 'compound');
				cb(null, { $_id: '_parent', EvalComplexity: true, complexityClass: cls });   // depth floor forces atomic
			},
			expand( graph, concept, scope, argz, cb ) {                  // the Expansion provider (LLM-meta: synthesizes the template)
				const steps = (expandFn(scope) || []).slice(0, maxBranch);
				const base = scope._._id, origin = scope._.originNode, target = scope._.targetNode,
				      depth = (scope._.depth || 0) + 1, childIds = steps.map((_, i) => base + '_s' + i);
				const tpl = [{ $_id: '_parent', Expansion: true, expandedInto: childIds }];
				let prev = origin;
				steps.forEach(( st, i ) => {
					const last = i === steps.length - 1, tnode = last ? target : base + '_m' + i;
					if ( !last ) tpl.push({ _id: tnode, Node: true, label: st.name });
					tpl.push({ _id: childIds[i], Segment: true, originNode: prev, targetNode: tnode, depth, parentSeg: base, label: st.name });
					prev = tnode;
				});
				cb(null, tpl);
			},
			answer( graph, concept, scope, argz, cb ) {
				cb(null, { $_id: '_parent', Answer: true, Answered: true, answer: answerFn(scope) });   // terminal prose
			},
			reportUp( graph, concept, scope, argz, cb ) {                // race-free fan-in: self-id -> parent.answeredBy
				cb(null, [{ $$_id: scope._.parentSeg, answeredBy: { __push: scope._._id } }, { $_id: '_parent', ReportUp: true }]);
			},
			rollup( graph, concept, scope, argz, cb ) {                  // fires once the .length gate holds
				const kids = (scope._.expandedInto || []).map(( id ) => { const e = graph.getEtty(id); return e && e._.answer; });
				cb(null, { $_id: '_parent', Rollup: true, Answered: true, answer: rollupFn(scope._, kids) });
			},
			confidence( graph, concept, scope, argz, cb ) {              // Claim chain: a SNAPPED band, never a raw float
				cb(null, { $_id: '_parent', Confidence: true, confBand: 'high' });
			}
		},
		Verify: {
			check( graph, concept, scope, argz, cb ) {                   // sibling verdict, never overwrites the claim
				cb(null, { $_id: '_parent', Verification: true, claimVerdict: 'pass' });
			}
		}
	};
}

function tripSeed() {
	return {
		lastRev: 0,
		nodes: [{ _id: 'start', label: 'Paris' }, { _id: 'goal', label: 'Tokyo' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', depth: 0, label: 'Plan Paris->Tokyo trip' }]
	};
}

// boot the _substrate grammar on a trip seed; resolve once the root has rolled up.
function runTripDecompose( opts ) {
	Graph._providers = makeTripProviders(opts);
	const tree = buildConceptTree(SUBSTRATE);
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('trip decompose timed out')), 20000);
		let done = false;
		const g = new Graph(tripSeed(), {
			label: 'poc-trip', isMaster: true, autoMount: true, conceptSets: ['_substrate'], bagRefManagers: {}, logLevel: 'error',
			onStabilize() {
				if ( done || !g._objById['root']._etty._.answer ) return;   // wait until the root rolled up
				done = true; clearTimeout(timer); resolve(g);
			}
		}, { _substrate: tree });
	});
}

module.exports = { makeTripProviders, tripSeed, runTripDecompose, SUBSTRATE };

if ( require.main === module ) {
	runTripDecompose().then(( g ) => {
		const f = ( id ) => g._objById[id]._etty._;
		const segs = Object.keys(g._objById).filter(( id ) => f(id).Segment);
		console.log('\n=== PoC M1 — universal _substrate grammar on a canned trip ===');
		console.log('root answer :', f('root').answer);
		console.log('segments    :', segs.length, '| leaves answered:', segs.filter(( id ) => f(id).Answer).length,
			'| root rolled up:', !!f('root').Rollup);
		console.log('claim chain :', 'Claim=' + !!f('root').Claim, 'Verification=' + f('root').claimVerdict, 'Trusted=' + !!f('root').Trusted);
		process.exit(0);
	}).catch(( e ) => { console.error(e); process.exit(1); });
}
