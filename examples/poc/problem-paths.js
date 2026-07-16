/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — problem decomposition over a STATE graph, with BEST-PATH selection, an ADJACENT-step
 * hand-off, and IN-GRAPH bottom-up synthesis. A problem is a segment from a START state to a GOAL
 * state. No call ever sees the whole problem — only a local neighbourhood. The grammar:
 *
 *   Plan      require [Segment, onPath]                      decompose the CHOSEN segment: propose ALTS
 *                                                            alternative intermediate STATES, each on the
 *                                                            LOCAL context — its endpoint states + the
 *                                                            PARENT step's endpoint states (one level up).
 *   Select    require [Decomposed]                           PROPOSE→SELECT→ADOPT: score the alternatives,
 *                                                            mark the winning sub-path `onPath`; the rest
 *                                                            stay inspectable but are never explored.
 *   Resolve   require [Atomic, onPath, originNode:reached]   resolve an atomic step — but ONLY once its
 *                                                            origin state is `reached`. That cross-ref gate
 *                                                            forces resolution to flow in PATH ORDER and
 *                                                            feeds each step the ADJACENT hand-off: the
 *                                                            previous resolved step (origin.reached). On
 *                                                            success it writes its `step` AND sets its
 *                                                            target node `reached` = the hand-off forward.
 *   Summarize require [Root, targetNode:reached]             once the GOAL node is reached (the whole path
 *                                                            resolved), walk START→GOAL and write the
 *                                                            bounded plan onto the root segment — IN-graph.
 *
 * The `reached` chain is the spine: START is seeded reached; each Resolve consumes its origin's reached
 * and produces its target's reached; the GOAL becoming reached is the completion signal. Every per-call
 * context is bounded — two states + one previous step + one parent step — independent of problem size.
 *
 *   STUB (deterministic — numeric bisection; validates the engine mechanics, no LLM):
 *     ALTS=2 node examples/poc/problem-paths.js
 *   REAL LLM (text states; thinking off):
 *     MODE=llm ALTS=2 LLM_NO_THINK=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-q2-vram node examples/poc/problem-paths.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { makeAsk, parseJSON } = require('../../lib/providers/llm.js');

const MODE     = process.env.MODE || 'stub';
const MAXDEPTH = Number(process.env.MAXDEPTH || 3);
const ALTS     = Number(process.env.ALTS || 2);     // alternative intermediate states per segment
const out      = (...a) => process.stdout.write(a.join(' ') + '\n');

const PROBLEM = MODE === 'llm'
	? { start: process.env.START || 'an empty git repository, nothing built', goal: process.env.GOAL || 'a tested CLI tool published to npm with a README' }
	: { start: 0, goal: 16 };

// ---- injected content (stub = deterministic; llm = real, LOCAL-context prompts) ----
// Every content fn records the LOCAL context it actually saw into `log` — so the tests can assert,
// as a NEGATIVE CONTROL, that the adjacency hand-off is genuinely consumed (not vacuously wired).
let llmCalls = 0;
function makeContent() {
	const log = { plan: [], select: [], resolve: [], summarize: [] };
	let C;
	if ( MODE !== 'llm' ) {
		C = {
			// propose ALTS candidate midpoints; the balanced one scores best (deterministic best-path)
			plan: async ( ctx ) => {
				log.plan.push(ctx);
				const { from, to } = ctx;
				return to - from <= 1 ? { atomic: true }
					: { mids: (ALTS <= 1 ? [Math.floor((from + to) / 2)]
						: [from + Math.floor((to - from) * 0.4), from + Math.floor((to - from) * 0.6)]).map((m) => ({ state: m })) };
			},
			score: async ( ctx ) => { log.select.push(ctx); return -Math.abs(ctx.mid - (ctx.from + ctx.to) / 2); },   // prefer the balanced split
			// the resolved step ECHOES the adjacent hand-off it received, so a test can prove the chain is live.
			resolve: async ( ctx ) => { log.resolve.push(ctx); return `from ${ctx.from} to ${ctx.to} [after: ${ctx.prev}]`; },
			summarize: async ( steps ) => { log.summarize.push(steps); return `Plan (${steps.length} steps): ` + steps.join(' → '); }
		};
	} else {
		const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-q2-vram' });
		const J = async ( system, user ) => { llmCalls++; return parseJSON(await ask({ system, user: user + '\n\nReply ONLY JSON.', maxTokens: 500 })); };
		C = {
			plan: async ( ctx ) => { log.plan.push(ctx); return J(
				`Given a START and a GOAL state of one planning step, decide if the gap is directly doable (atomic) or needs an intermediate state. If it needs one, propose UP TO ${ALTS} DISTINCT alternative intermediate states, each with a one-line rationale. Use the PARENT step only as framing — stay local. JSON: {"atomic":true} or {"mids":[{"state":"...","why":"..."}]}`,
				`Parent step: ${ctx.parent || '(root)'}${ctx.parentFrom != null ? ` (parent goes from «${ctx.parentFrom}» to «${ctx.parentTo}»)` : ''}\nSTART state: ${ctx.from}\nGOAL state: ${ctx.to}`); },
			score: async ( ctx ) => { log.select.push(ctx); const r = await J('Rate 0-10 how good this intermediate state is as a stepping-stone from START to GOAL (balanced, reachable, useful). JSON: {"score":N}', `START: ${ctx.from}\nGOAL: ${ctx.to}\nINTERMEDIATE: ${ctx.mid}`); return Number(r && r.score) || 0; },
			resolve: async ( ctx ) => { log.resolve.push(ctx); llmCalls++; return (await ask({ system: 'Describe concretely how to get from the START state to the GOAL state, in 1-2 sentences. The PREVIOUS step just completed is given for continuity — continue from it, do not repeat it.', user: `PREVIOUS step done: ${ctx.prev}\nSTART: ${ctx.from}\nGOAL: ${ctx.to}` })).trim(); },
			summarize: async ( steps ) => { log.summarize.push(steps); llmCalls++; return (await ask({ system: 'Summarize these ordered steps into one coherent, bounded plan (max ~6 sentences). Do not copy; synthesize.', user: steps.map((s, i) => `${i + 1}. ${s}`).join('\n') })).trim(); }
		};
	}
	C.log = log;
	return C;
}

// ---- the concept set ----
const conceptTree = { common: { childConcepts: {
	Plan     : { _id: 'Plan', _name: 'Plan', require: ['Segment', 'onPath'], provider: ['P::plan'] },                       // only the chosen path decomposes
	Select   : { _id: 'Select', _name: 'Select', require: ['Decomposed'], provider: ['P::select'] },                        // score alternatives, mark the winner onPath
	Resolve  : { _id: 'Resolve', _name: 'Resolve', require: ['Atomic', 'onPath', 'originNode:reached'], provider: ['P::resolve'] }, // resolve chosen atomic steps, IN PATH ORDER (origin must be reached)
	// BACKTRACK: when the chosen path dead-ends, a stuck signal bubbles to the deciding segment; this
	// ensure-gated concept RE-FIRES once per fresh stuck (the iterative-trial re-cast, finding #15) and
	// adopts the next-best untried alternative — escalating to its own parent when alternatives run out.
	Reselect : { _id: 'Reselect', _name: 'Reselect', require: ['Decomposed'], ensure: ['$stuck.length >= $attempt'], provider: ['P::reselect'] },
	Summarize: { _id: 'Summarize', _name: 'Summarize', require: ['Root', 'targetNode:reached'], provider: ['P::summarize'] } // once GOAL is reached, write the bounded plan in-graph
} } };

function providers( C, opts ) {
	opts = opts || {};
	const maxDepth = opts.maxDepth != null ? opts.maxDepth : MAXDEPTH, nAlts = opts.alts != null ? opts.alts : ALTS;
	const WINDOW   = opts.window != null ? opts.window : 1;   // bounded adjacency WINDOW: how many prior steps a resolve sees (1 = immediate only; keeps context ≤ B)
	const stateOf   = ( graph, id ) => { const e = graph.getEtty(id); return e ? e._.state : undefined; };
	const reachedOf = ( graph, id ) => { const e = graph.getEtty(id); return e ? e._.reached : undefined; };
	const trailOf   = ( graph, id ) => { const e = graph.getEtty(id); return (e && e._.trail) || []; };   // the bounded window of prior steps handed along the spine
	const labelOf   = ( graph, id ) => { const e = graph.getEtty(id); return e ? e._.label : undefined; };
	const kindOf    = ( graph, id ) => { const e = graph.getEtty(id); return e ? e._.kind : undefined; };   // typed-domain discriminant (enum); undefined = untyped
	return { P: {
		plan: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, depth = seg.depth || 0;
			if ( seg.toDelegate ) return cb(null, { $_id: '_parent', Plan: true });   // a delegated sub-problem is solved by a forked sub-agent (Delegate), not decomposed inline
			if ( depth >= maxDepth ) return cb(null, { $_id: '_parent', Plan: true, Atomic: true });
			const from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			// adjacency UP: the parent step's endpoint states (one bounded level), as framing for the planner.
			let parent = null, parentFrom = null, parentTo = null;
			if ( seg.parentSeg ) { const p = graph.getEtty(seg.parentSeg); if ( p ) { parent = p._.label; parentFrom = stateOf(graph, p._.originNode); parentTo = stateOf(graph, p._.targetNode); } }
			// typed-domain context: the endpoint KINDS let a domain content fn ground the decomposition
			// (a known route → deterministic mids, no LLM); untyped endpoints (undefined) fall back to the LLM.
			const originKind = kindOf(graph, seg.originNode), targetKind = kindOf(graph, seg.targetNode);
			Promise.resolve(C.plan({ from, to, parent, parentFrom, parentTo, originKind, targetKind })).then(function ( r ) {
				// DELEGATION: the content can flag a self-contained sub-problem to be solved by a forked
				// sub-agent (Delegate) instead of decomposed inline — carry the sub-problem spec onto the segment.
				if ( r && r.delegate ) return cb(null, { $_id: '_parent', Plan: true, toDelegate: true,
					subStart: r.delegate.from, subGoal: r.delegate.to, subStartKind: r.delegate.startKind, subGoalKind: r.delegate.goalKind });
				if ( !r || r.atomic || !r.mids || !r.mids.length ) return cb(null, { $_id: '_parent', Plan: true, Atomic: true });
				// Decomposed segments carry the backtrack ledger: `stuck` (grow-only signals from dead-ended
				// descendants) and `attempt` (how many alternatives tried) — the Reselect gate reads both.
				const base = seg._id, alts = [], tpl = [{ $_id: '_parent', Plan: true, Decomposed: true, stuck: [], attempt: 1 }];
				r.mids.slice(0, nAlts).forEach(function ( m, i ) {
					const mid = (m && m.state != null) ? m.state : m, why = (m && m.why) || null, mkind = (m && m.kind) || null;
					const midN = base + '_m' + i, segA = base + '_a' + i, segB = base + '_b' + i;
					alts.push({ mid: mid, why: why, segA: segA, segB: segB, kind: mkind });   // kind: typed-domain route discriminant (null = untyped) — lets Select rank ROUTES by kind
					// a domain may TYPE the intermediate state (kind) so the next hop stays grounded.
					tpl.push(mkind ? { _id: midN, Node: true, state: mid, kind: mkind } : { _id: midN, Node: true, state: mid });
					tpl.push({ _id: segA, Segment: true, originNode: seg.originNode, targetNode: midN, depth: depth + 1, parentSeg: base, label: 'reach ' + mid, cand: true });
					tpl.push({ _id: segB, Segment: true, originNode: midN, targetNode: seg.targetNode, depth: depth + 1, parentSeg: base, label: 'from ' + mid, cand: true });
				});
				tpl[0].alts = alts;
				out(`  [plan  d${depth}] ${from}  ⟶  ${to}   : ${alts.length} alt(s) ${alts.map((a) => '«' + a.mid + '»').join('  ')}`);
				cb(null, tpl);
			});
		},
		// PROPOSE → SELECT → ADOPT: score the alternatives, mark the winning sub-path onPath.
		select: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, alts = seg.alts || [];
			const from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			const originKind = kindOf(graph, seg.originNode), targetKind = kindOf(graph, seg.targetNode);   // typed-domain: let score rank ROUTES by the first-hop + remaining cost
			Promise.all(alts.map(function ( a ) { return Promise.resolve(C.score({ from: from, to: to, mid: a.mid, why: a.why, kind: a.kind, originKind: originKind, targetKind: targetKind })); })).then(function ( scores ) {
				let best = 0; for ( let i = 1; i < alts.length; i++ ) if ( scores[i] > scores[best] ) best = i;
				const win = alts[best];
				out(`  [select  ] picked «${win.mid}»   (scores: ${scores.map((s) => Number(s).toFixed(1)).join(', ')})`);
				cb(null, [
					// store the scores so Reselect can adopt the next-best alternative WITHOUT re-scoring.
					{ $_id: '_parent', Select: true, chosen: win.mid, scores: scores },
					{ $$_id: win.segA, onPath: true },
					{ $$_id: win.segB, onPath: true }
				]);
			});
		},
		// resolve an atomic step on its LOCAL context + the ADJACENT hand-off (origin.reached = the
		// previous resolved step). Writes its own `step` AND hands off forward by setting target.reached.
		// If the step is INFEASIBLE (a dead-end at the resolution floor), it does NOT hand off — it marks
		// itself Stuck and bubbles a stuck signal to the deciding (parent) segment, which then backtracks.
		resolve: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, from = stateOf(graph, seg.originNode), to = stateOf(graph, seg.targetNode);
			const prev = reachedOf(graph, seg.originNode);
			const window = trailOf(graph, seg.originNode);    // the bounded window of the last WINDOW resolved steps (not just `prev`)
			const originKind = kindOf(graph, seg.originNode), targetKind = kindOf(graph, seg.targetNode);
			Promise.resolve(C.resolve({ from: from, to: to, prev: prev, window: window, originKind: originKind, targetKind: targetKind })).then(function ( r ) {
				const stuck = r && typeof r === 'object' && r.stuck;
				const step  = (r && typeof r === 'object') ? r.step : r;
				if ( stuck || step == null ) {                       // dead-end: signal the deciding segment, no hand-off forward
					out(`  [resolve ] ✗ STUCK  ${from}  ⟶  ${to}   (${(r && r.why) || 'infeasible'})`);
					const tpl = [{ $_id: '_parent', Resolve: true, Stuck: true, why: (r && r.why) || 'infeasible' }];
					if ( seg.parentSeg ) tpl.push({ $$_id: seg.parentSeg, stuck: { __push: seg._id } });
					return cb(null, tpl);
				}
				out(`  [resolve ] ${from}  ⟶  ${to}`);
				const trail = window.concat([step]).slice(-WINDOW);   // hand forward a BOUNDED window (last WINDOW steps), not an unbounded history
				cb(null, [
					{ $_id: '_parent', Resolve: true, step: step },
					{ $$_id: seg.targetNode, reached: step, trail: trail }   // ADJACENT hand-off forward: `reached` = immediate prev, `trail` = bounded window
				]);
			});
		},
		// BACKTRACK / escalation. Fires (re-fires) once per fresh `stuck` signal that reaches this deciding
		// segment: drop the dead-ended alternative OFF the path, adopt the next-best UNTRIED alternative ON
		// the path (so it gets explored). If every alternative is exhausted, escalate — bubble a stuck signal
		// to THIS segment's parent (or flag the root Unsolvable). `attempt` is bumped each fire so the gate
		// `stuck.length >= attempt` closes until the next dead-end arrives (self-limiting; finding #15).
		reselect: function ( graph, concept, scope, argz, cb ) {
			const seg = scope._, alts = seg.alts || [], scores = seg.scores || [], attempt = seg.attempt || 1;
			const tried = (seg.tried || []).concat([seg.chosen]);   // the current chosen is the one that just dead-ended
			let pick = -1; for ( let i = 0; i < alts.length; i++ ) { if ( tried.indexOf(alts[i].mid) >= 0 ) continue; if ( pick < 0 || scores[i] > scores[pick] ) pick = i; }
			const oldWin = alts.find(function ( a ) { return a.mid === seg.chosen; });
			if ( pick < 0 ) {                                        // exhausted — escalate to the parent (or give up at the root)
				out(`  [reselect] ✗ EXHAUSTED at «${labelOf(graph, seg._id) || seg._id}» — escalating`);
				// record the last failed alternative too, so `tried` is the complete audit of attempts.
				const tpl = [{ $_id: '_parent', Reselect: true, Exhausted: true, attempt: attempt + 1, tried: { __push: seg.chosen } }];
				if ( seg.parentSeg ) tpl.push({ $$_id: seg.parentSeg, stuck: { __push: seg._id } });
				else tpl.push({ $_id: '_parent', Unsolvable: true });
				return cb(null, tpl);
			}
			const next = alts[pick];
			out(`  [reselect] ↩ «${seg.chosen}» dead-ended → adopt «${next.mid}»   (untried, score ${Number(scores[pick]).toFixed(1)})`);
			const tpl = [
				{ $_id: '_parent', Reselect: true, chosen: next.mid, attempt: attempt + 1, tried: { __push: seg.chosen } },
				{ $$_id: next.segA, onPath: true }, { $$_id: next.segB, onPath: true }
			];
			if ( oldWin ) { tpl.push({ $$_id: oldWin.segA, onPath: false }); tpl.push({ $$_id: oldWin.segB, onPath: false }); }
			cb(null, tpl);
		},
		// in-graph bottom-up synthesis: the GOAL became reached → the whole path resolved. Walk it and
		// write the bounded plan onto the root segment (so the solution lives in the graph + is traced).
		summarize: function ( graph, concept, scope, argz, cb ) {
			const startId = findNode(graph, 'isStart'), goalId = findNode(graph, 'isGoal');
			const steps = pathSteps(graph, startId, goalId);
			Promise.resolve(C.summarize(steps)).then(function ( sol ) {
				out(`  [summarize] ${steps.length} steps along the best path → solution written in-graph`);
				cb(null, { $_id: '_parent', Summarize: true, solution: sol, stepCount: steps.length });
			});
		}
	} };
}

function findNode( graph, flag ) { for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Node && e[flag] ) return id; } return null; }

// ---- walk the start→goal LIVE path over the resolved (onPath, atomic) segments, in order ----
// Filtering to `onPath` is what makes BACKTRACK sound: a dead-ended branch that was un-chosen
// (onPath:false) is skipped, so the walk follows only the live, contiguous, resolved chain.
function pathSteps( graph, startId, goalId ) {
	const byOrigin = {};
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Segment && e.onPath && e.step != null ) byOrigin[e.originNode] = e; }
	const steps = []; let node = startId, guard = 0;
	while ( node !== goalId && guard++ < 1000 ) { const seg = byOrigin[node]; if ( !seg ) break; steps.push(seg.step); node = seg.targetNode; }
	return steps;
}

async function solve( problem, C, opts ) {
	opts = opts || {};
	Graph._providers = providers(C, opts);
	// START/GOAL may carry a typed `kind` (typed-domain mode) so a domain content fn can ground the search.
	const sNode = { _id: 'S', Node: true, state: problem.start, isStart: true, reached: 'start: ' + problem.start };
	const gNode = { _id: 'G', Node: true, state: problem.goal, isGoal: true };
	if ( problem.startKind ) sNode.kind = problem.startKind;
	if ( problem.goalKind ) gNode.kind = problem.goalKind;
	const seed = { lastRev: 0, nodes: [sNode, gNode],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'solve the problem' }] };
	const g = new Graph(seed, { label: opts.label || 'problem-paths', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(g);
	const root = g.getEtty('root');
	return { graph: g, steps: pathSteps(g, 'S', 'G'), solution: root && root._.solution };
}

async function main() {
	const C = makeContent();
	out(`\nFLAGSHIP problem-paths  (mode=${MODE}, ${ALTS} alternative(s)/segment)\n  START: ${PROBLEM.start}\n  GOAL:  ${PROBLEM.goal}\n`);
	const { steps, solution } = await solve(PROBLEM, C);
	out(`\n  best path: ${steps.length} resolved atomic steps (LLM calls=${llmCalls})`);
	out(`\nSOLUTION (synthesized in-graph along the BEST path):\n${solution}\n`);
}

module.exports = { solve, makeContent, pathSteps, conceptTree, providers };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
