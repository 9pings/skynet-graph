'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * POC — the DURABLE EXECUTOR end to end: a compiled Brick-1/3 method (select + task + map) run over a stream of
 * case records via the CheckpointStore. Demonstrates, MEASURED (study `2026-06-28-rocinante-convergence.md` §5 +
 * the conception §11 gate setup):
 *   1. typed SELECT routing       — a record's typed `kind` fact picks the method branch (foldRoute/mapRoute/micro).
 *   2. content-memo AMORTIZATION  — a recurrent stream replays steps at 0 task calls (C5), keyed on the TRACKED
 *                                   facts (sound: the key captures everything a task reads); incidental fields
 *                                   don't re-key; a NOVEL class pays (no false hit).
 *   3. map FAN-OUT                — Brick-1: one child token per element; a shared element replays (#30-safe).
 *   4. CROSS-RESTART memo replay  — the durable memo survives a process restart → a warm class costs 0 calls.
 *   5. CRASH-RESUME               — an in-flight token recovered via rollbackInflight; no work lost or duplicated.
 *
 * Run: `node examples/poc/durable-flow.js`.
 */
const { createMemoryCheckpointStore, createSqliteCheckpointStore } = require('../../lib/durable/checkpoint-store.js');
const { compileMethod } = require('../../lib/durable/xlate.js');
const { runFlow } = require('../../lib/durable/interpreter.js');
const { digest } = require('../../lib/providers/canonicalize.js');

// ── the method (the compact Brick-1/3 spec) ────────────────────────────────────────────────────────────────
const spec = {
	name: 'triage',
	select: {
		on: ['kind'],
		rules: [
			{ when: "$kind=='collection'", method: 'mapRoute' },
			{ when: "$kind=='scalar'",     method: 'foldRoute' },
		],
		fallback: 'micro',
	},
	methods: {
		mapRoute:  { steps: [{ task: 'T::classify' }], map: { over: 'coll', body: [{ task: 'T::convert' }], elemKey: 'elem' } },
		foldRoute: { steps: [{ task: 'T::classify' }, { task: 'T::sum' }] },
		micro:     { steps: [{ task: 'T::askLLM' }] },
	},
};
const net = compileMethod(spec);

// the content-memo key — projected to the TRACKED facts each task reads (kind, elem). SOUND: a superset of every
// task's reads (so it never under-keys → never a false hit), yet ignores incidental fields (id/note) → amortizes.
const keyOf = ( tr, t ) => digest({ task: tr.task, kind: (t.payload || {}).kind, elem: (t.payload || {}).elem });

// the micro-tasks (the providers). Each output is a pure function of the keyed facts (kind / elem) → the key is
// sound. `counts` measures REAL calls (the LLM-call currency).
function makeRunTask() {
	const counts = {};
	const runTask = ( task, token ) => {
		counts[task] = (counts[task] || 0) + 1;
		const p = token.payload || {};
		if ( task === 'T::classify' ) return { payload: { classified: p.kind } };
		if ( task === 'T::sum' )      return { payload: { total: p.kind === 'scalar' ? 42 : 0 } };
		if ( task === 'T::convert' )  return { payload: { converted: 'c(' + p.elem + ')' } };
		if ( task === 'T::askLLM' )   return { payload: { answer: 'llm:' + p.kind } };
		return {};
	};
	const total = () => Object.values(counts).reduce(( a, b ) => a + b, 0);
	return { runTask, counts, total };
}

const STREAM = [
	{ id: 'a', kind: 'scalar', note: 'one' },
	{ id: 'b', kind: 'scalar', note: 'two' },                      // same CLASS as a, incidental diff → amortizes
	{ id: 'c', kind: 'collection', coll: ['x', 'y'] },
	{ id: 'd', kind: 'collection', coll: ['x', 'z'] },            // shares element x with c → convert(x) replays
	{ id: 'e', kind: 'mystery' },                                 // no typed rule → fallback micro
];

// 1-3 — route + amortize + fan-out on one in-memory run.
async function amortize() {
	const store = createMemoryCheckpointStore();
	const { runTask, counts, total } = makeRunTask();
	store.ensureRun('run', net);
	store.inject('run', STREAM);
	const c = await runFlow(store, 'run', net, { runTask, keyOf });
	return { c, counts, taskCalls: total(), marking: store.marking('run'), stats: store.stats('run') };
}

// 4 — the durable memo survives a restart: warm the scalar class, reopen the file, a fresh scalar record costs 0.
async function crossRestart( file ) {
	let store = createSqliteCheckpointStore({ file });
	const t1 = makeRunTask();
	store.ensureRun('r', net);
	store.inject('r', [{ id: 'a', kind: 'scalar' }]);
	await runFlow(store, 'r', net, { runTask: t1.runTask, keyOf });
	const warmCalls = t1.total();                                 // cold: classify + sum = 2
	store.close();                                               // ── restart ──

	store = createSqliteCheckpointStore({ file });
	const t2 = makeRunTask();
	store.inject('r', [{ id: 'b', kind: 'scalar' }]);            // same class, fresh process
	await runFlow(store, 'r', net, { runTask: t2.runTask, keyOf });
	const replayCalls = t2.total();                              // warm across restart: 0
	store.close();
	return { warmCalls, replayCalls };
}

// 5 — crash mid-flow, resume: in-flight token recovered, nothing lost or double-run.
async function crashResume( file ) {
	// baseline: 3 scalar records, uninterrupted, single run.
	const base = createMemoryCheckpointStore();
	const tb = makeRunTask();
	base.ensureRun('b', net);
	base.inject('b', [{ id: 'a', kind: 'scalar' }, { id: 'b', kind: 'scalar' }, { id: 'c', kind: 'scalar' }]);
	await runFlow(base, 'b', net, { runTask: tb.runTask, keyOf });
	const baseline = tb.total();                                  // = 2 (classify + sum, the rest replay)

	// crash run: fuel-cut leaves a claimed-but-unprocessed token LEASED (a worker died holding it).
	let store = createSqliteCheckpointStore({ file });
	const t1 = makeRunTask();
	store.ensureRun('c', net);
	store.inject('c', [{ id: 'a', kind: 'scalar' }, { id: 'b', kind: 'scalar' }, { id: 'c', kind: 'scalar' }]);
	await runFlow(store, 'c', net, { runTask: t1.runTask, keyOf, batch: 8, maxSteps: 2 });  // routes 2, leaves 1 in-flight
	const leasedAtCrash = store.stats('c').leased;
	store.close();                                              // ── crash ──

	store = createSqliteCheckpointStore({ file });
	const rb = store.rollbackInflight('c');                     // orphan-scan
	const t2 = makeRunTask();
	await runFlow(store, 'c', net, { runTask: t2.runTask, keyOf });   // resume to completion
	const done = store.stats('c').done, failed = store.stats('c').failed;
	const totalCalls = t1.total() + t2.total();
	store.close();
	return { baseline, leasedAtCrash, resetCount: rb.reset.length, done, failed, totalCalls };
}

module.exports = { spec, net, keyOf, makeRunTask, STREAM, amortize, crossRestart, crashResume };

if ( require.main === module ) {
	amortize().then(( a ) => console.log('[amortize] taskCalls=%d memoHits=%d routed=%d fanOut=%d done=%d (naive would be 11)',
		a.taskCalls, a.c.memoHits, a.c.routed, a.c.fanOut, a.stats.done));
}
