/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — PARALLEL COMPETITIVE exploration (rollout over possible-worlds). Best-path (rung A) ranks
 * alternatives by a STATIC heuristic BEFORE elaborating them — so a route that LOOKS cheap but elaborates
 * expensive is committed greedily. A `Compete` concept instead FORKS one sub-agent per alternative, runs
 * them CONCURRENTLY to a fixpoint (each in its own world), and selects by the REALIZED outcome (the true
 * elaborated cost / feasibility) — a parallel rollout that beats the greedy heuristic exactly when the
 * heuristic is misleading. Only the winning bounded plan crosses back; every losing fork is discarded.
 *
 * The measured win: a domain where the static estimate MIS-RANKS the routes. Greedy commits to the
 * statically-cheapest route and pays its (high) realized cost; competitive elaborates all routes in
 * parallel and pays the (low) realized cost of the true optimum. Concurrency makes the rollout overlap —
 * N routes are elaborated in roughly one route's wall-clock, not N×.
 *
 *   node examples/poc/problem-compete.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { providers, conceptTree, pathSteps } = require('./problem-paths.js');
const { namespaced } = require('./problem-delegate.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const sleep = ( ms ) => new Promise((r) => setTimeout(r, ms));

// the ROUTES: each has a STATIC estimate (what a heuristic sees up front) and a REALIZED elaboration
// length (only known after a sub-agent actually solves it). The estimate is MISLEADING for 'quick-hack'.
const ROUTES = [
	{ name: 'quick-hack', label: 'patch it in place', staticEstimate: 1, realLen: 6 },        // looks cheapest, elaborates into 6 messy steps
	{ name: 'proper-refactor', label: 'refactor cleanly', staticEstimate: 3, realLen: 2 },    // looks dearer, elaborates into 2 clean steps
	{ name: 'rewrite', label: 'rewrite from scratch', staticEstimate: 5, realLen: 4 }
];

// the sub-agent content is ROUTE-AGNOSTIC: it elaborates a sub-problem of length (to-from) into a chain,
// awaiting a small latency per step so concurrency can overlap (simulating real provider cost). The route
// identity is known to the PARENT that forked it (no shared global) — the parent builds the labelled plan.
const subContent = {
	plan: async ( { from, to } ) => to - from <= 1 ? { atomic: true } : { mids: [{ state: from + 1 }] },   // linear chain of (to-from) steps
	score: async () => 0,
	resolve: async ( { from } ) => { await sleep(15); return `step ${from + 1}`; },
	summarize: async ( steps ) => `${steps.length} steps`
};

const subTree = namespaced(conceptTree, 'Sub');

// the Compete concept: fork one sub-agent per route, elaborate CONCURRENTLY, pick by realized outcome.
const competeTree = { common: { childConcepts: {
	Compete  : { _id: 'Compete', _name: 'Compete', require: ['Segment', 'toCompete'], provider: ['P::compete'] },
	Summarize: { _id: 'Summarize', _name: 'Summarize', require: ['Root', 'Compete'], provider: ['P::summarizeRoot'] }
} } };

function buildProviders( stats ) {
	const Sub = providers(subContent, { maxDepth: 12, alts: 1 }).P;
	const P = {
		// PARALLEL ROLLOUT: a fork per route, all elaborated concurrently, selected by realized cost.
		compete: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._;
			const t0 = Date.now();
			const forks = ROUTES.map(( r ) => {
				const seed = { lastRev: 0,
					nodes: [{ _id: 'S', Node: true, state: 0, isStart: true, reached: 'start' }, { _id: 'G', Node: true, state: r.realLen, isGoal: true }],
					segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: r.name }] };
				return { r: r, child: graph.fork(seed, { conceptMap: subTree, label: 'compete:' + r.name }) };
			});
			// elaborate ALL routes CONCURRENTLY (the rollout) — the forks share a stateless registry, so
			// Promise.all overlaps their async resolves (proven safe by probe-parallel).
			Promise.all(forks.map(function ( f ) {
				return nextStable(f.child).then(function () {
					return { r: f.r, steps: pathSteps(f.child, 'S', 'G') };
				});
			})).then(function ( elaborated ) {
				const wall = Date.now() - t0;
				const feasible = elaborated.filter(function ( e ) { return e.steps.length > 0; });
				feasible.sort(function ( a, b ) { return a.steps.length - b.steps.length; });   // SELECT by realized cost
				const best = feasible[0];
				forks.forEach(function ( f ) { f.child.destroy(); });
				stats.wall = wall;
				stats.realized = elaborated.map(function ( e ) { return { route: e.r.name, staticEstimate: e.r.staticEstimate, realized: e.steps.length }; });
				stats.chosen = best.r.name; stats.chosenRealized = best.steps.length;
				// greedy-by-static would have chosen the min-staticEstimate route — record its realized cost for the comparison.
				const greedy = ROUTES.slice().sort(function ( a, b ) { return a.staticEstimate - b.staticEstimate; })[0];
				stats.greedyChosen = greedy.name; stats.greedyRealized = greedy.realLen;
				const plan = best.r.label + ' (' + best.steps.length + ' steps): ' + best.steps.join(' → ');
				cb(null, { $_id: '_parent', Compete: true, chosenRoute: best.r.name, realizedCost: best.steps.length, plan: plan });
			});
		},
		summarizeRoot: function ( graph, concept, scope, argz, cb ) {
			cb(null, { $_id: '_parent', Summarize: true, solution: scope._.plan });
		}
	};
	return { P: P, Sub: Sub };
}

async function solveCompetitively() {
	const stats = {};
	Graph._providers = buildProviders(stats);
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: 'a feature with a risky implementation choice' }, { _id: 'G', Node: true, state: 'feature delivered' }],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, toCompete: true, label: 'pick the best strategy by ELABORATING all of them' }] };
	const g = new Graph(seed, { label: 'compete', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, competeTree);
	await nextStable(g);
	return { graph: g, stats, solution: g.getEtty('root')._.solution };
}

async function main() {
	out('\nFLAGSHIP problem-compete — PARALLEL competitive exploration (rollout) vs the greedy static heuristic\n');
	const { stats, solution } = await solveCompetitively();
	out('routes (static estimate → REALIZED elaborated cost):');
	stats.realized.forEach(function ( r ) { out(`   ${r.route.padEnd(18)} static≈${r.staticEstimate}   realized=${r.realized}${r.route === stats.chosen ? '   ◀ CHOSEN (parallel rollout, by realized cost)' : ''}`); });
	out(`\n   GREEDY (static heuristic) would pick «${stats.greedyChosen}»  → realized cost ${stats.greedyRealized}`);
	out(`   COMPETITIVE (parallel rollout)  picks «${stats.chosen}»        → realized cost ${stats.chosenRealized}`);
	out(`   ⇒ competitive is ${stats.greedyRealized - stats.chosenRealized} steps cheaper (the heuristic mis-ranked the routes)`);
	out(`   parallel rollout wall-clock: ${stats.wall}ms  (all ${stats.realized.length} routes elaborated in the fan-out)\n`);
	out(`   SOLUTION (in-graph): ${solution}\n`);
}

module.exports = { solveCompetitively, ROUTES, competeTree };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
