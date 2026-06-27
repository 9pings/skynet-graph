/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — DELEGATION TO A PROCESS (worker thread). Rung B delegated a sub-problem to an in-process fork;
 * this delegates it to a SEPARATE OS THREAD. The worker rehydrates a problem-solving sub-graph from a JSON
 * conceptMap + a provider FILE (`worker-solver-provider.js`) + a seed, runs the problem-paths grammar there,
 * and ships back only the serialized snapshot. The one effect that can't cross the thread boundary — the
 * model `ask` — is PROXIED back to the parent (the worker forwards each call; the parent's model answers).
 * So a sub-agent reasons on its own core/thread while the parent stays the single model owner.
 *
 *   node examples/poc/problem-worker.js                              (deterministic parent `ask`)
 *   LLM=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-q2-vram node examples/poc/problem-worker.js
 */
global.__SERVER__ = true;
const path = require('path');
const { createGraphWorker } = require('../../lib/runtime');
const { conceptTree } = require('./problem-paths.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const PROVIDER_FILE = path.join(__dirname, 'worker-solver-provider.js');

// extract the resolved plan from a worker snapshot (serialize().graph -> {conceptMaps:[facts...]}).
function planFromSnapshot( snapshot ) {
	const g = JSON.parse(snapshot.graph), objs = g.conceptMaps || [];
	const byOrigin = {}, byId = {}; let startId = null, goalId = null, root = null;
	objs.forEach(( f ) => {
		byId[f._id] = f;
		if ( f.Node && f.isStart ) startId = f._id;
		if ( f.Node && f.isGoal ) goalId = f._id;
		if ( f.Root ) root = f;
		if ( f.Segment && f.onPath && f.step != null ) byOrigin[f.originNode] = f;
	});
	const steps = []; let node = startId, guard = 0;
	while ( node !== goalId && guard++ < 1000 ) { const s = byOrigin[node]; if ( !s ) break; steps.push(s.step); node = s.targetNode; }
	return { steps, solution: root && root.solution, objectCount: objs.length };
}

/**
 * Dispatch a problem to a worker thread; the worker solves it with the model PROXIED to `parentAsk`.
 * Returns { steps, solution, proxiedCalls } — and the count of model calls the parent answered.
 */
async function solveInWorker( problem, parentAsk, opts ) {
	opts = opts || {};
	let proxiedCalls = 0;
	const ask = async ( prompt, o ) => { proxiedCalls++; return parentAsk(prompt, o); };
	const w = createGraphWorker({ conceptMap: conceptTree, providers: PROVIDER_FILE, ask: ask });
	await w.ready();
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: problem.start, isStart: true, reached: 'start' }, { _id: 'G', Node: true, state: problem.goal, isGoal: true }],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'solve' }] };
	const snapshot = await w.dispatch(seed, { settleTimeout: opts.settleTimeout || 20000 });
	await w.terminate();
	const r = planFromSnapshot(snapshot);
	return { steps: r.steps, solution: r.solution, objectCount: r.objectCount, proxiedCalls };
}

// a deterministic parent `ask` (so the demo/test runs with no real model) — echoes the bounded local prompt.
function stubAsk() {
	return async ( prompt ) => {
		if ( prompt && /Summarize/.test(prompt.system || '') ) return 'PLAN: ' + (prompt.user.split('\n').length) + ' ordered steps';
		const m = /START: (.*)\nGOAL: (.*)/.exec((prompt && prompt.user) || '');
		return m ? `step ${m[1]}→${m[2]}` : 'step';
	};
}

async function main() {
	out('\nFLAGSHIP problem-worker — a problem-solving sub-graph dispatched to a WORKER THREAD, model PROXIED to the parent\n');
	let parentAsk = stubAsk();
	if ( process.env.LLM ) {
		const { makeAsk } = require('../../lib/providers/llm.js');
		parentAsk = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-q2-vram' });
	}
	const r = await solveInWorker({ start: 0, goal: 6 }, parentAsk, {});
	out('  resolved in the WORKER (this thread only owned the model):');
	r.steps.forEach(( s, i ) => out(`    ${i + 1}. ${s}`));
	out(`\n  proxied model calls answered by the parent: ${r.proxiedCalls}`);
	out(`  worker sub-graph objects (built + destroyed in the worker): ${r.objectCount}`);
	out(`  SOLUTION (synthesized in the worker): ${r.solution}\n`);
}

module.exports = { solveInWorker, planFromSnapshot, stubAsk, PROVIDER_FILE };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
