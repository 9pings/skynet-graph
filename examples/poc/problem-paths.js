/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — problem decomposition over a STATE graph, with BEST-PATH selection. A problem is a
 * segment from a START state to a GOAL state. On each (chosen) segment a `Plan` concept proposes
 * ALTS alternative intermediate STATES (using only LOCAL context — the segment's endpoint states +
 * its parent); a `Select` concept SCORES the alternatives and marks the winning sub-path `onPath`
 * (Propose → SELECT → Adopt); only the chosen path recurses and is `Resolve`d; pruned alternatives
 * stay in the graph (inspectable) but are never explored. Then we SUMMARIZE along the BEST path.
 * No call ever sees the whole problem — only a local neighbourhood.
 *
 *   STUB (deterministic — picks the balanced split; validates the engine mechanics, no LLM):
 *     ALTS=2 node examples/poc/problem-paths.js
 *   REAL LLM (text states; thinking off):
 *     MODE=llm ALTS=2 LLM_NO_THINK=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-nvfp4-mtp node examples/poc/problem-paths.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { makeAsk, parseJSON } = require('../../lib/providers/llm.js');

const MODE     = process.env.MODE || 'stub';
const MAXDEPTH = Number(process.env.MAXDEPTH || 3);
const ALTS     = Number(process.env.ALTS || 2);     // alternative intermediate states per segment
const out      = (...a) => process.stdout.write(a.join(' ') + '\n');

const PROBLEM = MODE === 'llm'
	? { start: process.env.START || 'an empty git repository, nothing built', goal: process.env.GOAL || 'a tested CLI tool published to npm with a README' }
	: { start: 0, goal: 16 };

// ---- injected content (stub = deterministic; llm = real, LOCAL-context prompts) ----
let llmCalls = 0;
function makeContent() {
	if ( MODE !== 'llm' ) return {
		// propose ALTS candidate midpoints; the balanced one scores best (deterministic best-path)
		plan: async ({ from, to }) => (to - from <= 1 ? { atomic: true }
			: { mids: ALTS <= 1 ? [Math.floor((from + to) / 2)] : [from + Math.floor((to - from) * 0.4), from + Math.floor((to - from) * 0.6)] }),
		score: async ({ from, to, mid }) => -Math.abs(mid - (from + to) / 2),    // prefer the balanced split
		resolve: async ({ from, to }) => `advance the state from ${from} to ${to}`,
		summarize: async ( steps ) => `Plan (${steps.length} steps): ` + steps.join(' → ')
	};
	const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-nvfp4-mtp' });
	const J = async ( system, user ) => { llmCalls++; return parseJSON(await ask({ system, user: user + '\n\nReply ONLY JSON.', maxTokens: 500 })); };
	return {
		plan: async ({ from, to, parent }) => J(
			`Given a START and a GOAL state of one step, decide if the gap is directly doable (atomic) or needs an intermediate state. If it needs one, propose UP TO ${ALTS} DISTINCT alternative intermediate states. JSON: {"atomic":true} or {"mids":["state one line","..."]}`,
			`Parent step: ${parent || '(root)'}\nSTART state: ${from}\nGOAL state: ${to}`),
		score: async ({ from, to, mid }) => { const r = await J('Rate 0-10 how good this intermediate state is as a stepping-stone from START to GOAL (balanced, reachable, useful). JSON: {"score":N}', `START: ${from}\nGOAL: ${to}\nINTERMEDIATE: ${mid}`); return Number(r && r.score) || 0; },
		resolve: async ({ from, to }) => { llmCalls++; return (await ask({ system: 'Describe concretely how to get from the START state to the GOAL state, in 1-2 sentences.', user: `START: ${from}\nGOAL: ${to}` })).trim(); },
		summarize: async ( steps ) => { llmCalls++; return (await ask({ system: 'Summarize these ordered steps into one coherent, bounded plan (max ~6 sentences). Do not copy; synthesize.', user: steps.map((s, i) => `${i + 1}. ${s}`).join('\n') })).trim(); }
	};
}

// ---- the concept set: Plan (propose alts) → Select (pick best → onPath) → Resolve (the chosen path) ----
const conceptTree = { common: { childConcepts: {
	Plan   : { _id: 'Plan', _name: 'Plan', require: ['Segment', 'onPath'], provider: ['P::plan'] },           // only the chosen path decomposes
	Select : { _id: 'Select', _name: 'Select', require: ['Decomposed'], provider: ['P::select'] },            // score alternatives, mark the winner onPath
	Resolve: { _id: 'Resolve', _name: 'Resolve', require: ['Atomic', 'onPath'], provider: ['P::resolve'] }    // resolve only the chosen atomic steps
} } };

function providers( C ) {
	const stateOf = (graph, id) => { const e = graph.getEtty(id); return e ? e._.state : undefined; };
	return { P: {
		plan: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, depth = seg.depth || 0;
			if ( depth >= MAXDEPTH ) return cb(null, { $_id: '_parent', Plan: true, Atomic: true });
			const from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			const parent = seg.parentSeg ? graph.getEtty(seg.parentSeg)._.label : null;
			Promise.resolve(C.plan({ from, to, parent })).then(function ( r ) {
				if ( !r || r.atomic || !r.mids || !r.mids.length ) return cb(null, { $_id: '_parent', Plan: true, Atomic: true });
				const base = seg._id, alts = [], tpl = [{ $_id: '_parent', Plan: true, Decomposed: true }];
				r.mids.slice(0, ALTS).forEach(function ( mid, i ) {
					const midN = base + '_m' + i, segA = base + '_a' + i, segB = base + '_b' + i;
					alts.push({ mid: mid, segA: segA, segB: segB });
					tpl.push({ _id: midN, Node: true, state: mid });
					tpl.push({ _id: segA, Segment: true, originNode: seg.originNode, targetNode: midN, depth: depth + 1, parentSeg: base, label: 'reach ' + mid, cand: true });
					tpl.push({ _id: segB, Segment: true, originNode: midN, targetNode: seg.targetNode, depth: depth + 1, parentSeg: base, label: 'from ' + mid, cand: true });
				});
				tpl[0].alts = alts;
				out(`  [plan  d${depth}] ${from}  ⟶  ${to}   : ${alts.length} alt(s) ${alts.map((a) => '«' + a.mid + '»').join('  ')}`);
				cb(null, tpl);
			});
		},
		// PROPOSE → SELECT → ADOPT: score the alternatives, mark the winning sub-path onPath
		select: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, alts = seg.alts || [];
			const from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			Promise.all(alts.map(function ( a ) { return Promise.resolve(C.score({ from: from, to: to, mid: a.mid })); })).then(function ( scores ) {
				let best = 0; for ( let i = 1; i < alts.length; i++ ) if ( scores[i] > scores[best] ) best = i;
				const win = alts[best];
				out(`  [select  ] picked «${win.mid}»   (scores: ${scores.map((s) => Number(s).toFixed(1)).join(', ')})`);
				cb(null, [
					{ $_id: '_parent', Select: true, chosen: win.mid },
					{ $$_id: win.segA, onPath: true },
					{ $$_id: win.segB, onPath: true }
				]);
			});
		},
		resolve: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			Promise.resolve(C.resolve({ from: from, to: to })).then(function ( step ) {
				out(`  [resolve ] ${from}  ⟶  ${to}`);
				cb(null, { $_id: '_parent', Resolve: true, step: step });
			});
		}
	} };
}

// ---- walk the start→goal BEST path over the resolved (onPath, atomic) segments, in order ----
function pathSteps( graph, startId, goalId ) {
	const byOrigin = {};
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Segment && e.step != null ) byOrigin[e.originNode] = e; }
	const steps = []; let node = startId, guard = 0;
	while ( node !== goalId && guard++ < 1000 ) { const seg = byOrigin[node]; if ( !seg ) break; steps.push(seg.step); node = seg.targetNode; }
	return steps;
}

async function solve( problem, C ) {
	Graph._providers = providers(C);
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: problem.start, isStart: true }, { _id: 'G', Node: true, state: problem.goal, isGoal: true }],
		segments: [{ _id: 'root', Segment: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'solve the problem' }] };
	const g = new Graph(seed, { label: 'problem-paths', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(g);
	return { graph: g, steps: pathSteps(g, 'S', 'G') };
}

async function main() {
	const C = makeContent();
	out(`\nFLAGSHIP problem-paths  (mode=${MODE}, ${ALTS} alternative(s)/segment)\n  START: ${PROBLEM.start}\n  GOAL:  ${PROBLEM.goal}\n`);
	const { steps } = await solve(PROBLEM, C);
	out(`\n  best path: ${steps.length} resolved atomic steps (LLM calls=${llmCalls})`);
	out(`\nSOLUTION (summarized along the BEST path):\n${await C.summarize(steps)}\n`);
}

module.exports = { solve, makeContent, pathSteps };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
