/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — problem decomposition over a STATE graph (the real loop). A problem is a segment from a
 * START state to a GOAL state. Concepts apply ON each segment and DECOMPOSE or RESOLVE it using only
 * their LOCAL context — the segment's own facts, its parent, and the start/end STATES of its endpoint
 * nodes (the origin state IS the hand-off from the adjacent/previous step). Decomposition inserts an
 * intermediate STATE node and recurses; a depth floor makes it well-founded. Then we SUMMARIZE along
 * the resulting start→goal PATH. No call ever sees the whole problem — only a local neighbourhood.
 *
 *   STUB (deterministic numeric bisection — validates the engine mechanics, no LLM):
 *     node examples/poc/problem-paths.js
 *   REAL LLM (text states; thinking off):
 *     MODE=llm LLM_NO_THINK=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-nvfp4-mtp node examples/poc/problem-paths.js
 *
 * NEXT layer (not v1): propose ALTERNATIVE intermediate states per segment → Pareto-SELECT the best
 * (lib/authoring/support.js) → summarize along the BEST path among alternatives.
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { makeAsk, parseJSON } = require('../../lib/providers/llm.js');

const MODE     = process.env.MODE || 'stub';
const MAXDEPTH = Number(process.env.MAXDEPTH || 3);
const out      = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- the problem: a START state and a GOAL state ----
const PROBLEM = MODE === 'llm'
	? { start: process.env.START || 'an empty git repository, nothing built', goal: process.env.GOAL || 'a tested CLI tool published to npm with a README' }
	: { start: 0, goal: 16 };   // stub: bisect the interval to atomic unit steps

// ---- injected content (stub = deterministic; llm = real, LOCAL-context prompts) ----
let llmCalls = 0;
function makeContent() {
	if ( MODE !== 'llm' ) return {
		// numeric bisection: a gap >1 decomposes at its midpoint; a unit gap is atomic
		plan: async ({ from, to }) => (to - from <= 1 ? { atomic: true } : { mid: Math.floor((from + to) / 2) }),
		resolve: async ({ from, to }) => `advance the state from ${from} to ${to}`,
		summarize: async ( steps ) => `Plan (${steps.length} steps): ` + steps.join(' → ')
	};
	const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-nvfp4-mtp' });
	const J = async ( system, user ) => { llmCalls++; return parseJSON(await ask({ system, user: user + '\n\nReply ONLY JSON.', maxTokens: 500 })); };
	return {
		// LOCAL context only: this step's start state, its end state, the parent step
		plan: async ({ from, to, parent }) => J(
			'Given a START state and a GOAL state of ONE step, decide if the gap is directly doable (atomic) or needs an intermediate state. JSON: {"atomic":true} or {"mid":"the intermediate state, one line"}',
			`Parent step: ${parent || '(root)'}\nSTART state: ${from}\nGOAL state: ${to}`),
		resolve: async ({ from, to }) => { llmCalls++; return (await ask({ system: 'Describe concretely how to get from the START state to the GOAL state, in 1-2 sentences.', user: `START: ${from}\nGOAL: ${to}` })).trim(); },
		summarize: async ( steps ) => { llmCalls++; return (await ask({ system: 'Summarize these ordered steps into one coherent, bounded plan (max ~6 sentences). Do not copy; synthesize.', user: steps.map((s, i) => `${i + 1}. ${s}`).join('\n') })).trim(); }
	};
}

// ---- the concept set: Plan (decompose/atomic) + Resolve (atomic) — both read LOCAL context ----
const conceptTree = { common: { childConcepts: {
	Plan   : { _id: 'Plan', _name: 'Plan', require: ['Segment'], provider: ['P::plan'] },
	Resolve: { _id: 'Resolve', _name: 'Resolve', require: ['Atomic'], provider: ['P::resolve'] }
} } };

function providers( C ) {
	const stateOf = (graph, id) => { const e = graph.getEtty(id); return e ? e._.state : undefined; };
	return { P: {
		// decide atomic vs decompose using ONLY {origin state, target state, parent}
		plan: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, depth = seg.depth || 0;
			if ( depth >= MAXDEPTH ) return cb(null, { $_id: '_parent', Plan: true, Atomic: true });
			const from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			const parent = seg.parentSeg ? graph.getEtty(seg.parentSeg)._.label : null;
			Promise.resolve(C.plan({ from, to, parent })).then(function ( r ) {
				if ( !r || r.atomic || r.mid == null ) return cb(null, { $_id: '_parent', Plan: true, Atomic: true });
				const base = seg._id, mid = base + '_m';
				out(`  [decompose d${depth}] ${from}  ⟶  ${to}   via  «${r.mid}»`);
				cb(null, [
					{ $_id: '_parent', Plan: true, Decomposed: true, expandedInto: [base + '_a', base + '_b'] },
					{ _id: mid, Node: true, state: r.mid },                                          // the intermediate STATE
					{ _id: base + '_a', Segment: true, originNode: seg.originNode, targetNode: mid, depth: depth + 1, parentSeg: base, label: 'reach ' + r.mid },
					{ _id: base + '_b', Segment: true, originNode: mid, targetNode: seg.targetNode, depth: depth + 1, parentSeg: base, label: 'from ' + r.mid }
				]);
			});
		},
		// resolve an atomic segment using ONLY {origin state, target state}
		resolve: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			Promise.resolve(C.resolve({ from, to })).then(function ( step ) {
				out(`  [resolve   ] ${from}  ⟶  ${to}`);
				cb(null, { $_id: '_parent', Resolve: true, step: step });
			});
		}
	} };
}

// ---- walk the start→goal PATH over the resolved atomic segments, in order ----
function pathSteps( graph, startId, goalId ) {
	const byOrigin = {};
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Segment && e.step != null ) byOrigin[e.originNode] = e; }
	const steps = []; let node = startId, guard = 0;
	while ( node !== goalId && guard++ < 1000 ) { const seg = byOrigin[node]; if ( !seg ) break; steps.push(seg.step); node = seg.targetNode; }
	return steps;
}

// Decompose + resolve a problem into a start→goal state path; returns { graph, steps }.
async function solve( problem, C ) {
	Graph._providers = providers(C);
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: problem.start, isStart: true }, { _id: 'G', Node: true, state: problem.goal, isGoal: true }],
		segments: [{ _id: 'root', Segment: true, originNode: 'S', targetNode: 'G', depth: 0, label: 'solve the problem' }] };
	const g = new Graph(seed, { label: 'problem-paths', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(g);
	return { graph: g, steps: pathSteps(g, 'S', 'G') };
}

async function main() {
	const C = makeContent();
	out(`\nFLAGSHIP problem-paths  (mode=${MODE})\n  START: ${PROBLEM.start}\n  GOAL:  ${PROBLEM.goal}\n`);
	const { steps } = await solve(PROBLEM, C);
	out(`\n  best path: ${steps.length} resolved atomic steps (LLM calls=${llmCalls})`);
	out(`\nSOLUTION (summarized along the path):\n${await C.summarize(steps)}\n`);
}

module.exports = { solve, makeContent, pathSteps };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
