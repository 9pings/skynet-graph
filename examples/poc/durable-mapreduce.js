'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * POC — the FOLD-BACK / cardinality JOIN: map ∘ reduce END TO END on the durable executor (the conception's
 * JTMS-at-merge point, study §4B/§9.3 — "map = an unordered FAN-OUT + a cardinality JOIN"). This is the first
 * concrete sub-rung toward §11 kill-criterion #6 (soundness under composition): a method that fans a collection
 * out, processes each element, and REDUCES the results back to one value, run durably + crash-resumably.
 *
 * Demonstrated, MEASURED, with negative controls:
 *   1. SOUNDNESS (= open-the-box)   — the durable folded result EQUALS a plain JS map-then-reduce (the composition
 *                                     is correct, not just green). The go/no-go shape of #6 at the map-reduce level.
 *   2. ORDER-INDEPENDENCE           — the fold is deterministic under a non-deterministic SCHEDULE: a commutative
 *                                     monoid (sum) gives the same value at batch=1 vs batch=N; a NON-commutative one
 *                                     (concat) is made deterministic by the element-index (_i) sort. Non-det
 *                                     throughput, deterministic BELIEF (the §12.3 line).
 *   3. AMORTIZATION                 — a recurrent stream replays per-element bodies (projected key) AND a micro-TASK
 *                                     fold (keyed on the collected siblings) at 0 calls; a novel element/group pays.
 *   4. CROSS-RESTART                — the durable memo (incl. the task-fold) replays across a process restart.
 *   5. CRASH-RESUME of a half-complete JOIN — a fuel-cut mid-fan-in is recovered (parked contributions are
 *                                     committed, not rolled back; an in-flight body/fold token re-runs) → the same
 *                                     total, no work lost or double-counted.
 *
 * Run: `node examples/poc/durable-mapreduce.js`.
 */
const { createMemoryCheckpointStore, createSqliteCheckpointStore } = require('../../lib/durable/checkpoint-store.js');
const { compileMethod } = require('../../lib/durable/xlate.js');
const { runFlow } = require('../../lib/durable/interpreter.js');
const { digest } = require('../../lib/providers/canonicalize.js');

// ── the per-element score (the body micro-task) — score(n) = n*n; pure fn of the element → the key is sound ──────
function score( n ) { return n * n; }

// ── METHOD A: map → score each → SUM the scores (a pure, commutative MONOID fold) ──────────────────────────────
const specSum = { name: 'sumScores', methods: { sumScores: {
	map: { over: 'items', elemKey: 'n', body: [{ task: 'T::score' }], reduce: { monoid: 'sum', key: 'score', into: 'total' } },
} } };
const netSum = compileMethod(specSum);

// ── METHOD B: map → score each → CONCAT the scores (a NON-commutative monoid; _i-sorted = deterministic) ────────
const specCat = { name: 'catScores', methods: { catScores: {
	map: { over: 'items', elemKey: 'n', body: [{ task: 'T::score' }], reduce: { monoid: 'concat', key: 'score', into: 'scores' } },
} } };
const netCat = compileMethod(specCat);

// ── METHOD C: map → score each → reduce via a micro-TASK (a small-LLM reconciliation, not pure logic) ───────────
const specTask = { name: 'reconcile', methods: { reconcile: {
	map: { over: 'items', elemKey: 'n', body: [{ task: 'T::score' }], reduce: { task: 'T::reconcile' } },
} } };
const netTask = compileMethod(specTask);

// the per-element body memo key — projected to the TRACKED fact the body reads (n). Sound (a superset of the
// task's reads) yet ignores incidental fields (record id) → a recurrent element replays. (The DEFAULT key would
// be sound but conservative; projecting is the K1 amortization discipline, like durable-flow.js.)
const keyOf = ( tr, t ) => digest({ task: tr.task, n: (t.payload || {}).n });
// the FOLD memo key — projected (like keyOf) to what the fold READS (the element scores), dropping incidental
// fields (the record id). The default fold key is the FULL siblings (sound but conservative — it would re-key on
// the incidental id, so a related record's fold would pay); projecting is the K1 amortization discipline.
const foldKeyOf = ( tr, sibs ) => digest({ fold: tr.reduce.task, scores: sibs.map(( s ) => s.score) });

function makeRunTask() {
	const counts = {};
	const runTask = ( task, t ) => {
		counts[task] = (counts[task] || 0) + 1;
		const p = t.payload || {};
		if ( task === 'T::score' )     return { payload: { score: score(p.n) } };
		if ( task === 'T::reconcile' ) {                                   // fold the collected element results
			const sc = (p._siblings || []).map(( s ) => s.score);
			return { payload: { count: sc.length, max: Math.max.apply(null, sc), sum: sc.reduce(( a, b ) => a + b, 0) } };
		}
		return {};
	};
	const total = () => Object.values(counts).reduce(( a, b ) => a + b, 0);
	return { runTask, counts, total };
}

// the open-the-box reference: plain JS map-then-reduce (the soundness oracle for #1).
function openBoxSum( items ) { return items.map(score).reduce(( a, b ) => a + b, 0); }
function openBoxCat( items ) { return items.map(score); }

// 1+2 — soundness (= open-the-box) + order-independence (batch=1 vs batch=N; commutative + non-commutative).
async function soundAndOrder() {
	const items = [3, 1, 4, 1, 5, 9, 2, 6];                               // intentionally unsorted + a repeat
	const out = {};
	for ( const batch of [1, 3, 32] ) {                                  // vary the SCHEDULE
		const s = createMemoryCheckpointStore(); s.ensureRun('r', netSum); s.inject('r', [{ id: 'x', items }]);
		const c = await runFlow(s, 'r', netSum, { runTask: makeRunTask().runTask, keyOf, batch });
		out['sum_b' + batch] = { total: s.marking('r').done[0].payload.total, joins: c.joins, folds: c.folds };
		const sc = createMemoryCheckpointStore(); sc.ensureRun('r', netCat); sc.inject('r', [{ id: 'x', items }]);
		await runFlow(sc, 'r', netCat, { runTask: makeRunTask().runTask, keyOf, batch });
		out['cat_b' + batch] = sc.marking('r').done[0].payload.scores;
	}
	return { items, openSum: openBoxSum(items), openCat: openBoxCat(items), out };
}

// 3 — amortization of BOTH layers: per-element bodies replay (projected key) AND the micro-task fold replays
// (keyed on the collected siblings). A repeated GROUP costs 0; a novel element/group pays.
async function amortize() {
	const stream = [
		{ id: 'a', items: [1, 2, 3] },                                  // cold: 3 score + 1 reconcile
		{ id: 'b', items: [1, 2, 3] },                                  // identical group → 3 bodies + 1 fold all replay (0)
		{ id: 'c', items: [2, 3, 4] },                                  // 2,3 bodies replay; 4 new (+1); novel group → fold pays (+1)
	];
	const s = createMemoryCheckpointStore(); s.ensureRun('r', netTask); s.inject('r', stream);
	const tk = makeRunTask();
	const c = await runFlow(s, 'r', netTask, { runTask: tk.runTask, keyOf, foldKeyOf });
	const done = s.marking('r').done;
	const byRec = ( id ) => done.find(( t ) => t.recordId === id).payload;
	return { counts: tk.counts, taskCalls: tk.total(), memoHits: c.memoHits, joins: c.joins, folds: c.folds,
		results: { a: byRec('a'), b: byRec('b'), c: byRec('c') } };
}

// 4 — the durable memo (incl. the TASK fold) replays across a process restart.
async function crossRestart( file ) {
	let s = createSqliteCheckpointStore({ file });
	const t1 = makeRunTask(); s.ensureRun('r', netTask); s.inject('r', [{ id: 'a', items: [1, 2, 3] }]);
	await runFlow(s, 'r', netTask, { runTask: t1.runTask, keyOf, foldKeyOf });
	const warmCalls = t1.total();                                       // 3 score + 1 reconcile = 4
	s.close();                                                          // ── restart ──
	s = createSqliteCheckpointStore({ file });
	const t2 = makeRunTask(); s.inject('r', [{ id: 'b', items: [1, 2, 3] }]);   // identical group, fresh process
	await runFlow(s, 'r', netTask, { runTask: t2.runTask, keyOf, foldKeyOf });
	const replayCalls = t2.total();                                     // 0 — bodies AND fold replay across the restart
	const total = s.marking('r').done.find(( t ) => t.recordId === 'b').payload.sum;
	s.close();
	return { warmCalls, replayCalls, total };
}

// 5 — crash mid fan-in at an ARBITRARY point: `batch>maxSteps` leases a batch but processes only `fuel` of them,
// so a fuel-cut leaves real IN-FLIGHT (leased) tokens — and, for the right cut, some siblings already PARKED
// (joined, committed) while others are recovered. Resume must combine committed-parked + recovered-in-flight to
// finish the join correctly. SOUND for ANY cut: same total, no work lost or duplicated (the memo + the
// idempotent join). Returns the per-cut result so the test can SWEEP every fuel value.
async function crashResume( file, fuel ) {
	const items = [1, 2, 3, 4, 5];
	// baseline: uninterrupted — the correct total + the exact (memoized) call count.
	const base = createMemoryCheckpointStore(); base.ensureRun('b', netSum); base.inject('b', [{ id: 'x', items }]);
	const tb = makeRunTask(); await runFlow(base, 'b', netSum, { runTask: tb.runTask, keyOf });
	const baselineTotal = base.marking('b').done[0].payload.total, baselineCalls = tb.total();

	let s = createSqliteCheckpointStore({ file }); s.ensureRun('c', netSum); s.inject('c', [{ id: 'x', items }]);
	const t1 = makeRunTask();
	await runFlow(s, 'c', netSum, { runTask: t1.runTask, keyOf, batch: 8, maxSteps: fuel });   // fuel-cut mid-flow
	const mid = s.stats('c');
	s.close();                                                          // ── crash ──
	s = createSqliteCheckpointStore({ file });
	const rb = s.rollbackInflight('c');                                 // orphan-scan: reset only IN-FLIGHT (leased)
	const t2 = makeRunTask();
	await runFlow(s, 'c', netSum, { runTask: t2.runTask, keyOf });      // resume to completion
	const resumedTotal = s.marking('c').done[0].payload.total, st = s.stats('c');
	const totalCalls = t1.total() + t2.total();
	s.close();
	return { fuel, baselineTotal, baselineCalls, resumedTotal, midLeased: mid.leased, midJoined: mid.joined,
		midDone: mid.done, reset: rb.reset.length, done: st.done, failed: st.failed, totalCalls };
}

// 6 — C-FAIL: a map child that fails (a contract violation OR an erroring task) must NOT hang its join. Fail-fast:
// the whole group fails (the record fails cleanly), never a silent partial fold (the "no wrong derivation" line).
// A guarded score∈[0,100] body; one out-of-range element violates → the group fails-fast (regression: it used to hang).
const guardedSum = { name: 'guardedSum', methods: { guardedSum: { map: { over: 'items', elemKey: 'n',
	body: [{ task: 'T::gscore', contract: { write: ['score'], post: ['score>=0 && score<=100'], effect: 'pure' } }],
	reduce: { monoid: 'sum', key: 'score', into: 'total' } } } } };
const guardedNet = compileMethod(guardedSum);

async function failFast( makeStore, items, mode ) {
	const store = makeStore(); store.ensureRun('r', guardedNet); store.inject('r', [{ id: 'rec', items }]);
	const runTask = ( task, t ) => {
		if ( mode === 'throw' && t.payload.n < 0 ) throw new Error('boom on ' + t.payload.n);   // an erroring task
		return { payload: { score: t.payload.n } };                                             // no clamp → >100 violates the guard
	};
	const c = await runFlow(store, 'r', guardedNet, { runTask, keyOf: ( tr, t ) => 'g:' + t.payload.n });
	const st = store.stats('r');
	const done = store.marking('r').done || [];
	return { blamed: c.blamed, joins: c.joins, folds: c.folds, done: st.done, failed: st.failed, joined: st.joined,
		total: done[0] && done[0].payload ? done[0].payload.total : undefined };
}

module.exports = { specSum, specCat, specTask, netSum, netCat, netTask, keyOf, foldKeyOf, makeRunTask, score,
	openBoxSum, openBoxCat, soundAndOrder, amortize, crossRestart, crashResume, guardedNet, failFast };

if ( require.main === module ) {
	(async () => {
		const so = await soundAndOrder();
		console.log('[sound] openSum=%d  executor sum @b1/b3/b32 = %d/%d/%d  (match=%s)',
			so.openSum, so.out.sum_b1.total, so.out.sum_b3.total, so.out.sum_b32.total,
			[so.out.sum_b1, so.out.sum_b3, so.out.sum_b32].every(( x ) => x.total === so.openSum));
		console.log('[order] concat @b1==@b32==openBox:', JSON.stringify(so.out.cat_b1) === JSON.stringify(so.openCat)
			&& JSON.stringify(so.out.cat_b32) === JSON.stringify(so.openCat));
		const a = await amortize();
		console.log('[amortize] taskCalls=%d (naive=12: 9 bodies+3 folds)  memoHits=%d  folds=%d', a.taskCalls, a.memoHits, a.folds);
	})();
}
