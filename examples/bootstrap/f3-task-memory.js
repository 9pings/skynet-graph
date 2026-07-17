/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP F3 — TASK MEMORY THAT REOPENS: the runnable, minimal face of README feature **F3**.
 * (The full four-act version on real data is `examples/integrated-demo/run.js --replay`; this file is the
 * same mechanism, small enough to read in one sitting.)
 *
 * THE PROBLEM: every agent to-do list only ever TICKS boxes. When the fact a finished step rested on turns
 * out to be wrong, the box stays ticked and the number goes stale. Vector/episodic memory has the same
 * failure class — measured here serving a stale answer 12/12 times on a policy drift.
 *
 * THE GUARANTEE SHOWN, and there are two DIFFERENT drifts because they behave differently on purpose:
 *   1. DRIFT-A, a CORRECTED value → the step re-derives itself at **0 model calls**. The old result was
 *      retracted and recomputed from the new premise; the task never needed to reopen because the answer
 *      simply followed.
 *   2. DRIFT-B, a WITHDRAWN value → the step **REOPENS, with the reason**. Nothing can be recomputed, so
 *      the graph prefers A HOLE to a stale number, and `plan_sync` emits a typed `reopen` op the host
 *      applies to its own task list. That op is the differentiator: checked twice against the market, no
 *      agent tool reopens a task whose premise drifted.
 *
 * THE IDIOM (worth stealing — it is what makes the above work, and it is all in the `ensure`):
 *   ensure: [ '$premise != null',                                  ← (a) withdrawn → stay OPEN
 *             '$used_premise == null || $premise == $used_premise' ]  ← (b) changed → uncast → re-derive
 *   provider writes the result AND `used_premise` (what it derived FROM); `cleaner` resets `used_*` and
 *   deposits a typed CONSTAT (what fell, why, at which revision). No rollback code anywhere.
 *
 * Deterministic, no GPU, no model:  node examples/bootstrap/f3-task-memory.js
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { recordConstat } = require('../../lib/providers/constat.js');
const { diffPlanToTaskOps } = require('../../lib/authoring/core/task-mirror.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

const cast = ( g, id, k ) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = ( g, id, k ) => g._objById[id] && g._objById[id]._etty._[k];
async function settle( g ) {
	for ( let i = 0; i < 80; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r) );
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('the mission graph did not settle');
}

// how many times the derivation actually ran — the "0 model calls" claim has to be COUNTED, not asserted.
const fires = { margin: 0, pct: 0 };

// ── one concept per task step. `margin` derives from the report's cells; `pct` derives from `margin`
//    (a composition — so a drift has to cascade THROUGH it, which is the interesting part).
const STEP = ( id, premises, compute ) => ({
	_id: 'Step_' + id, _name: 'Step_' + id,
	require: ['isReport'],
	ensure : premises.flatMap(( p ) => ['$' + p + ' != null', '$used_' + p + ' == null || $' + p + ' == $used_' + p] ),
	provider: ['Demo::step', id],
	cleaner : ['Demo::reset', id],
	constat : { claimKey: 'r_' + id, because: premises.join(',') },
	_compute: compute, _premises: premises,
});
const CONCEPTS = {
	Step_margin: STEP('margin', ['revenue', 'costs'], ( v ) => v.revenue - v.costs),
	Step_pct   : STEP('pct', ['r_margin', 'revenue'], ( v ) => Math.round(v.r_margin / v.revenue * 100)),
};

// the PLAN the host mirrors: a step is done iff its concept is currently cast.
const PLAN = [
	{ id: 'margin', title: 'compute the margin', needs: [] },
	{ id: 'pct', title: 'compute the margin %', needs: ['margin'] },
];
const snapshotPlan = ( g ) => ({ steps: PLAN.map(( s ) => {
	const done = cast(g, 'report', 'Step_' + s.id);
	const lessons = (fact(g, 'mem', 'lessons') || []).filter(( l ) => l.kind === 'Step_' + s.id );
	const last = lessons[lessons.length - 1];
	return { id: s.id, title: s.title, needs: s.needs, status: done ? 'done' : 'open',
		reason: !done && last ? 'premise drifted: ' + last.retractedBecause + ' (rev ' + last.atRev + ')' : undefined };
}) });

function boot() {
	Graph._providers = { Demo: {
		// derive: read the CURRENT premises, compute, and record what we derived FROM (`used_*`).
		step( g, c, scope, argz, cb ) {
			const spec = CONCEPTS['Step_' + argz[0]];
			fires[argz[0]]++;
			const v = {};
			for ( const p of spec._premises ) v[p] = scope.getRef(p);
			const tpl = { $_id: '_parent', ['Step_' + argz[0]]: true, ['r_' + argz[0]]: spec._compute(v) };
			for ( const p of spec._premises ) tpl['used_' + p] = v[p];        // ← the "what I derived from" stamp
			cb(null, tpl);
		},
		// retract: clear the stamps (so a re-derivation can fire) + deposit the typed CONSTAT (the reason).
		reset( g, c, scope, argz, cb ) {
			const spec = CONCEPTS['Step_' + argz[0]];
			const tpl = { $_id: '_parent', ['r_' + argz[0]]: null };
			for ( const p of spec._premises ) tpl['used_' + p] = null;
			cb(null, [tpl, recordConstat(g, c, scope, c._schema.constat)]);
		},
	} };
	return new Graph(
		{ lastRev: 0, segments: [], freeNodes: [{ _id: 'mem', lessons: [] }],
			nodes: [{ _id: 'report', isReport: true, revenue: 913, costs: 400 }] },
		{ label: 'f3', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts: CONCEPTS } });
}

async function main() {
	const g = boot();
	await settle(g);

	title('A FINISHED TASK THAT UN-FINISHES ITSELF');
	say('Every to-do list in the world only ever ticks boxes. But what happens when the number a');
	say('finished task was built on turns out to be wrong? The box stays ticked, and the answer');
	say('quietly rots. Watch this one un-tick itself instead.');
	gap();

	// ── the task list, first sync: both steps derived and done ─────────────────────────────────────
	let sync = diffPlanToTaskOps(snapshotPlan(g), null);
	beat(1, 'A report says revenue 913, costs 400. Two tasks compute the margin, then the margin %.');
	val('margin', fact(g, 'report', 'r_margin') + '  (913 − 400)');
	val('margin %', fact(g, 'report', 'r_pct') + ' %');
	good('both tasks are ticked off on your own to-do list');
	assert.equal(fact(g, 'report', 'r_margin'), 513, '913 − 400');
	assert.equal(fact(g, 'report', 'r_pct'), 56, 'and the composition on top of it');
	assert.equal(sync.ops.filter(( o ) => o.op === 'complete' ).length, 2, 'both tasks reported done to the host');
	gap();

	// ── DRIFT-A — a CORRECTED premise: everything downstream re-derives, at 0 model calls ──────────
	const before = { margin: fires.margin, pct: fires.pct };
	await new Promise(( res ) => g.ingest({ report: { revenue: 1000 } }, res) );   // an erratum lands: 913 → 1000
	await settle(g);
	beat(2, 'An erratum arrives: revenue was not 913, it was 1000. We change that one number.');
	val('margin', fact(g, 'report', 'r_margin') + '  — updated itself');
	val('margin %', fact(g, 'report', 'r_pct') + ' %  — and so did the one built on top of it');
	good('both re-did themselves. No model was called. Nobody was told to recompute');
	good('nothing to un-tick: the answers simply followed the correction');
	assert.equal(fact(g, 'report', 'r_margin'), 600, 'the margin followed the corrected premise — nobody recomputed it by hand');
	assert.equal(fact(g, 'report', 'r_pct'), 60, 'and the COMPOSITION followed too: the cascade went through r_margin');
	assert.ok(fires.margin > before.margin && fires.pct > before.pct, 're-derived — and the count proves it ran');

	sync = diffPlanToTaskOps(snapshotPlan(g), sync.mirror);
	assert.deepEqual(sync.ops, [], 'a recomputable drift needs NO host action: the tasks stayed done, correctly');
	gap();

	// ── DRIFT-B — a WITHDRAWN premise: nothing to recompute → the tasks REOPEN, with the reason ────
	await new Promise(( res ) => g.ingest({ report: { costs: null } }, res) );     // the figure is withdrawn entirely
	await settle(g);
	beat(3, 'Worse news: the costs figure is withdrawn entirely. Nothing can be recomputed now.');
	bad('the margin is now a HOLE — not the stale 600 it used to say');
	bad('and the margin %, which was built on it, went with it');
	assert.equal(cast(g, 'report', 'Step_margin'), false, 'the step retracted — its premise is gone');
	assert.equal(fact(g, 'report', 'r_margin'), null, 'THE POINT: a HOLE, not the stale 600');
	assert.equal(cast(g, 'report', 'Step_pct'), false, 'and the composition retracted in cascade — no orphan derived value');

	const constats = fact(g, 'mem', 'lessons');
	assert.ok(constats.length >= 2, 'each retraction deposited a TYPED record: what fell, why, at which revision');

	sync = diffPlanToTaskOps(snapshotPlan(g), sync.mirror);
	const reopens = sync.ops.filter(( o ) => o.op === 'reopen' );
	gap();
	beat(4, 'And here is what lands on YOUR to-do list, unprompted:');
	for ( const o of reopens ) note('re-open "' + o.id + '" — ' + o.reason);
	good('both tasks un-ticked themselves — including the one that only depended on it indirectly');
	good('and each says WHY, and as of when. Not just a status flip');
	assert.equal(reopens.length, 2, 'BOTH done tasks reopened at the host — including the one that only depended INDIRECTLY');
	assert.match(reopens[0].reason, /premise drifted/, 'and each reopen carries the reason, not just a status flip');

	// ── idempotence: syncing the same state again says nothing (a delta, not a resend) ─────────────
	const again = diffPlanToTaskOps(snapshotPlan(g), sync.mirror);
	assert.deepEqual(again.ops, [], 'same state twice → empty delta');
	good('ask again and it says nothing new — it only ever tells you what CHANGED');
	g.destroy && g.destroy();

	finish('correct a number and the work redoes itself for free; withdraw one and the finished task un-finishes itself, with the reason.', 'BOOTSTRAP OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
