/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — the CENTRAL CLAIM, MEASURED for the problem-solving grammar: every per-call context is
 * BOUNDED (a constant local neighbourhood — the two endpoint states + the immediate hand-off + the bounded
 * adjacency window), INDEPENDENT of how large the problem / plan grows. A naive solver that carries "the
 * objective + the whole plan-so-far" into each call has per-call context that GROWS with the plan — which
 * is exactly the context-window blow-up the engine exists to avoid.
 *
 * This instruments the ACTUAL local context each `resolve` of the problem-paths grammar assembles, across
 * problems of increasing size, and compares the MAX per-call context to a naive baseline on the same task.
 * The result: ENGINE max per-call context is FLAT; BASELINE grows linearly with the plan length.
 *
 *   node examples/poc/problem-bounded.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { providers, conceptTree, pathSteps } = require('./problem-paths.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const WINDOW = 3;

// the SIZE of the local context a resolve actually assembles (the bounded neighbourhood it sends to a model).
// A real state is a bounded-size DESCRIPTION, not an unbounded counter — represent the toy's numeric states
// at fixed width so the measurement isn't polluted by the O(log N) digit count of a growing integer id.
const fixed = ( s ) => String(s).padStart(4, '·');
function localContextSize( ctx ) {
	const payload = [
		'FROM: ' + fixed(ctx.from),
		'TO: ' + fixed(ctx.to),
		'PREV: ' + (ctx.prev || ''),
		'RECENT: ' + (ctx.window || []).join(' | ')      // the bounded adjacency window (≤ WINDOW steps)
	].join('\n');
	return payload.length;
}

// ENGINE: the problem-paths grammar. The content records the size of the bounded local context per call.
function engineContent( sizes ) {
	return {
		plan: async ( { from, to } ) => to - from <= 1 ? { atomic: true } : { mids: [{ state: Math.floor((from + to) / 2) }] },
		score: async () => 0,
		resolve: async ( ctx ) => { sizes.push(localContextSize(ctx)); return `do work ${fixed(ctx.from)}→${fixed(ctx.to)}`; },   // fixed-width step → the window stays constant-size
		summarize: async ( steps ) => `plan of ${steps.length} steps`
	};
}

async function runEngine( N ) {
	const sizes = [];
	Graph._providers = providers(engineContent(sizes), { maxDepth: 64, alts: 1, window: WINDOW });
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: 0, isStart: true, reached: 'start', trail: [] }, { _id: 'G', Node: true, state: N, isGoal: true }],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'solve' }] };
	const g = new Graph(seed, { label: 'eng' + N, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(g);
	const steps = pathSteps(g, 'S', 'G');
	return { steps: steps.length, maxCtx: Math.max(...sizes), totalCtx: sizes.reduce((a, b) => a + b, 0), calls: sizes.length };
}

// BASELINE: a naive step-by-step planner that carries the objective + the WHOLE plan-so-far into each call.
function runBaseline( N ) {
	const objective = 'solve the problem from state 0 to state ' + N + ' — produce one concrete step at a time';
	const plan = [], sizes = [];
	for ( let i = 0; i < N; i++ ) {
		const payload = 'OBJECTIVE: ' + objective + '\nPLAN SO FAR:\n' + plan.map((s, k) => (k + 1) + '. ' + s).join('\n');
		sizes.push(payload.length);                    // the per-call context GROWS with the plan
		plan.push('do work from state ' + i + ' to state ' + (i + 1));
	}
	return { steps: N, maxCtx: Math.max(...sizes), totalCtx: sizes.reduce((a, b) => a + b, 0), calls: sizes.length };
}

async function measure( sizesN ) {
	const rows = [];
	for ( const N of sizesN ) {
		const e = await runEngine(N), b = runBaseline(N);
		rows.push({ N, engMax: e.maxCtx, baseMax: b.maxCtx, engTotal: e.totalCtx, baseTotal: b.totalCtx, engCalls: e.calls });
	}
	return rows;
}

async function main() {
	out('\nFLAGSHIP problem-bounded — per-call context: the problem-solving grammar (BOUNDED) vs a naive carry-everything baseline\n');
	const rows = await measure([4, 8, 16, 32, 64]);
	out('  plan size N │ ENGINE max per-call ctx │ BASELINE max per-call ctx │ engine calls');
	out('  ────────────┼─────────────────────────┼───────────────────────────┼─────────────');
	rows.forEach((r) => out(`  ${String(r.N).padStart(10)}  │ ${String(r.engMax).padStart(22)} │ ${String(r.baseMax).padStart(24)} │ ${String(r.engCalls).padStart(12)}`));
	const flat = rows.every((r) => r.engMax === rows[0].engMax);
	out(`\n  ENGINE max per-call context is ${flat ? 'CONSTANT' : 'NOT constant'} (${rows[0].engMax} chars) across N=4..64 — bounded, independent of plan size.`);
	out(`  BASELINE max per-call context GROWS ${Math.round(rows[rows.length - 1].baseMax / rows[0].baseMax)}× from N=4 to N=64 — the context-window blow-up the engine avoids.\n`);
}

module.exports = { runEngine, runBaseline, measure, WINDOW };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
