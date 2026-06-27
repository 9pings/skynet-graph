/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — a BOUNDED ADJACENCY WINDOW. The `reached` spine hands each step its IMMEDIATE predecessor;
 * but some steps must be resolved against a HORIZON of recent steps, not just the last one — while keeping
 * the per-call context BOUNDED (the flagship invariant |context| ≤ B). The grammar now hands a capped
 * `trail` (the last WINDOW resolved steps) along the spine: `resolve` reads `ctx.window` (the bounded
 * horizon) and each step writes the truncated trail forward. WINDOW=1 reproduces the old immediate-only
 * adjacency; WINDOW=K gives a K-step horizon at constant context size.
 *
 * The measured demonstration: a "no-repeat within the last K steps" constraint (e.g. don't reuse a DB
 * connection / cache shard within K steps to avoid contention). With a window of 1, the resolver can only
 * avoid the immediate predecessor, so it VIOLATES the K-window constraint; with a window of K it sees the
 * whole horizon and satisfies it — at the SAME bounded context size (K small, independent of plan length).
 *
 *   node examples/poc/problem-adjacency.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { providers, conceptTree, pathSteps } = require('./problem-paths.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');

const RES = ['r1', 'r2', 'r3', 'r4'];   // a pool of resources (≥ K+1 so a K-window can always avoid a repeat)
const N = 9;                            // plan length
const K = 3;                            // the contention horizon: no resource may repeat within K consecutive steps
const resOf = ( step ) => { const m = /\b(r\d)\b/.exec(step || ''); return m ? m[1] : null; };

// the content: each step picks the lowest-index resource NOT seen in the (bounded) window it is given.
const content = {
	plan: async ( { from, to } ) => to - from <= 1 ? { atomic: true } : { mids: [{ state: from + 1 }] },   // a chain of N steps
	score: async () => 0,
	resolve: async ( { window } ) => {
		const used = new Set((window || []).map(resOf).filter(Boolean));
		const pick = RES.find(( r ) => !used.has(r)) || RES[0];
		return `use ${pick}`;
	},
	summarize: async ( steps ) => steps.map(resOf).join(' ')
};

async function runWithWindow( window ) {
	Graph._providers = providers(content, { maxDepth: N + 2, alts: 1, window: window });
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: 0, isStart: true, reached: 'start', trail: [] }, { _id: 'G', Node: true, state: N, isGoal: true }],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'schedule' }] };
	const g = new Graph(seed, { label: 'adj' + window, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(g);
	const seq = pathSteps(g, 'S', 'G').map(resOf);
	// count violations of the K-window constraint (a resource repeating within K consecutive steps).
	let violations = 0;
	for ( let i = 0; i < seq.length; i++ ) for ( let j = Math.max(0, i - K + 1); j < i; j++ ) if ( seq[i] === seq[j] ) { violations++; break; }
	// the handed-along trail is BOUNDED: its length never exceeds the window (constant context, any plan length).
	let maxTrail = 0;
	for ( const id in g._objById ) { const t = g._objById[id]._etty._.trail; if ( Array.isArray(t) ) maxTrail = Math.max(maxTrail, t.length); }
	return { seq, violations, maxTrail };
}

async function main() {
	out(`\nFLAGSHIP problem-adjacency — a BOUNDED ADJACENCY WINDOW vs immediate-only adjacency`);
	out(`  constraint: no resource may repeat within the last K=${K} steps; pool=${RES.join(',')}; plan length=${N}\n`);

	const w1 = await runWithWindow(1);
	out(`  WINDOW=1 (immediate only): ${w1.seq.join(' ')}`);
	out(`     → ${w1.violations} within-${K} repeats (the resolver could only avoid the IMMEDIATE prior)\n`);

	const wK = await runWithWindow(K);
	out(`  WINDOW=${K} (bounded horizon): ${wK.seq.join(' ')}`);
	out(`     → ${wK.violations} within-${K} repeats (the resolver saw the whole K-horizon — at the SAME bounded context size)\n`);

	out(`  ⇒ the bounded window eliminated ${w1.violations - wK.violations} constraint violations; per-call context stayed ≤ ${K} prior steps (independent of plan length ${N}).\n`);
}

module.exports = { runWithWindow, RES, N, K, resOf };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
