'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * POC — the C-CONTRACT GUARD in the DURABLE EXECUTOR: the §2 defeasible contract's "assert-at-runtime" realized in
 * the EXECUTE layer (not just the belief-view probe). It unifies the two builds — the durable executor (Layer A/B)
 * and `lib/authoring/contract.js#assertPost` — so a method's per-step contract is ENFORCED as cases flow through:
 * the post is asserted AFTER the task produces output but BEFORE the result is committed forward (the adversary's
 * #3 — catch a wrong learned post BEFORE an irreversible downstream commit). A violation QUARANTINES the token
 * (route to `fail` with a blame reason — a seed of C-fail), and a fresh violating output is NOT memoized.
 *
 * Demonstrated, MEASURED, negative controls:
 *   1. GUARD       — a step contract `score∈[0,100]`; a non-clamping body lets a 150 case through → the guard
 *                    blames it + quarantines it; it NEVER reaches the downstream step; sound cases flow to done.
 *   2. NO-COMMIT   — the quarantined case produced NO downstream fact (assert-BEFORE-commit, not after).
 *   3. MEMO-SOUND  — a violating fresh output is NOT cached: a repeat of the bad case re-calls + re-blames (never
 *                    replays a bad result); a sound repeat replays at 0 calls.
 *   4. G1 in-flow  — a body that writes an UNDECLARED key is blamed by the runtime frame-completeness diff.
 *   5. G2 in-flow  — an `external`-effect step needs a ground-truth ORACLE: without → blamed; with → flows.
 *
 * Run: `node examples/poc/durable-contract.js`.
 */
const { createMemoryCheckpointStore } = require('../../plugins/durable/lib/checkpoint-store.js');
const { compileMethod } = require('../../plugins/durable/lib/xlate.js');
const { runFlow } = require('../../plugins/durable/lib/interpreter.js');

// a 2-step method: score (guarded: score∈[0,100]) → label. The body does NOT clamp, so an out-of-range raw violates.
const guardedSpec = { methods: { grade: { steps: [
	{ task: 'T::score', contract: { write: ['score'], post: ['score>=0 && score<=100'], effect: 'pure' } },
	{ task: 'T::label' },
] } } };
const guardedNet = compileMethod(guardedSpec);

function scoreLabel( task, t ) {
	if ( task === 'T::score' ) return { payload: { score: t.payload.raw } };    // NO clamp — the body is wrong for >100
	if ( task === 'T::label' ) return { payload: { label: 'graded' } };
	return {};
}
const keyOf = ( tr, t ) => 'task:' + tr.task + '|raw:' + (t.payload || {}).raw;

// 1+2 — the guard quarantines a violating case before the downstream commit; sound cases flow.
async function guardRun() {
	const store = createMemoryCheckpointStore(); store.ensureRun('r', guardedNet);
	store.inject('r', [{ id: 'ok', raw: 85 }, { id: 'bad', raw: 150 }, { id: 'ok2', raw: 40 }]);
	const counts = { score: 0, label: 0 };
	const runTask = ( task, t ) => { counts[task === 'T::score' ? 'score' : 'label']++; return scoreLabel(task, t); };
	const c = await runFlow(store, 'r', guardedNet, { runTask, keyOf });
	const m = store.marking('r');
	const done = (m.done || []).map(( t ) => ({ rec: t.recordId, label: t.payload.label }));
	const failed = (m.failed || []).map(( t ) => ({ rec: t.recordId, reason: t.reason }));
	return { blamed: c.blamed, done, failed, labelCalls: counts.label,
		badReachedLabel: done.some(( d ) => d.rec === 'bad' ) };
}

// 3 — a violating fresh output is NOT memoized (re-call + re-blame); a sound case replays at 0.
async function memoSoundness() {
	const store = createMemoryCheckpointStore(); store.ensureRun('r', guardedNet);
	store.inject('r', [{ id: 'bad1', raw: 150 }, { id: 'bad2', raw: 150 }, { id: 'okA', raw: 50 }, { id: 'okB', raw: 50 }]);
	let scoreCalls = 0;
	const runTask = ( task, t ) => { if ( task === 'T::score' ) scoreCalls++; return scoreLabel(task, t); };
	const c = await runFlow(store, 'r', guardedNet, { runTask, keyOf });
	return { scoreCalls, blamed: c.blamed, memoHits: c.memoHits, done: (store.marking('r').done || []).length };
}

// 4 — G1 frame-completeness in the flow: a body writing an UNDECLARED key is blamed.
async function frameGuard() {
	const spec = { methods: { m: { steps: [{ task: 'T::leak', contract: { write: ['ok'], post: ['ok==true'], effect: 'pure' } }] } } };
	const net = compileMethod(spec);
	const store = createMemoryCheckpointStore(); store.ensureRun('r', net);
	store.inject('r', [{ id: 'x' }]);
	const c = await runFlow(store, 'r', net, { runTask: () => ({ payload: { ok: true, audit: 'leak' } }), keyOf: () => null });
	return { blamed: c.blamed, reason: (store.marking('r').failed || []).map(( t ) => t.reason )[0] };
}

// 5 — G2 effect-tag in the flow: an external step needs a ground-truth oracle.
async function oracleGuard( oracle ) {
	const spec = { methods: { m: { steps: [{ task: 'T::ship', contract: { write: ['shipped'], post: ['shipped==true'], effect: 'external' } }] } } };
	const net = compileMethod(spec);
	const store = createMemoryCheckpointStore(); store.ensureRun('r', net);
	store.inject('r', [{ id: 'x' }]);
	const c = await runFlow(store, 'r', net, { runTask: () => ({ payload: { shipped: true } }), keyOf: () => null, oracle });
	return { blamed: c.blamed, done: (store.marking('r').done || []).length };
}

module.exports = { guardedSpec, guardedNet, scoreLabel, keyOf, guardRun, memoSoundness, frameGuard, oracleGuard };

if ( require.main === module ) {
	(async () => {
		const g = await guardRun();
		console.log('[1+2 guard]  blamed=%d  done=%j  failed=%j  bad reached downstream label: %s',
			g.blamed, g.done, g.failed, g.badReachedLabel);
		const m = await memoSoundness();
		console.log('[3 memo]     scoreCalls=%d (bad×2 not cached + ok cached once) blamed=%d memoHits=%d done=%d', m.scoreCalls, m.blamed, m.memoHits, m.done);
		const f = await frameGuard();
		console.log('[4 G1]       blamed=%d reason=%s', f.blamed, f.reason);
		console.log('[5 G2]       no oracle → blamed=%d ; oracle ✓ → done=%d',
			(await oracleGuard()).blamed, (await oracleGuard(() => true)).done);
	})().catch(( e ) => { console.error(e); process.exit(1); });
}
