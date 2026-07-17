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

	// ── the task list, first sync: both steps derived and done ─────────────────────────────────────
	let sync = diffPlanToTaskOps(snapshotPlan(g), null);
	console.log('derived →', JSON.stringify({ margin: fact(g, 'report', 'r_margin'), pct: fact(g, 'report', 'r_pct') }), '| fires:', JSON.stringify(fires));
	console.log('sync 1  →', sync.ops.map(( o ) => o.op + ':' + o.id ).join(', '));
	assert.equal(fact(g, 'report', 'r_margin'), 513, '913 − 400');
	assert.equal(fact(g, 'report', 'r_pct'), 56, 'and the composition on top of it');
	assert.equal(sync.ops.filter(( o ) => o.op === 'complete' ).length, 2, 'both tasks reported done to the host');

	// ── DRIFT-A — a CORRECTED premise: everything downstream re-derives, at 0 model calls ──────────
	const before = { margin: fires.margin, pct: fires.pct };
	await new Promise(( res ) => g.ingest({ report: { revenue: 1000 } }, res) );   // an erratum lands: 913 → 1000
	await settle(g);
	console.log('drift-A →', JSON.stringify({ margin: fact(g, 'report', 'r_margin'), pct: fact(g, 'report', 'r_pct') }),
		'| re-derivations:', JSON.stringify({ margin: fires.margin - before.margin, pct: fires.pct - before.pct }));
	assert.equal(fact(g, 'report', 'r_margin'), 600, 'the margin followed the corrected premise — nobody recomputed it by hand');
	assert.equal(fact(g, 'report', 'r_pct'), 60, 'and the COMPOSITION followed too: the cascade went through r_margin');
	assert.ok(fires.margin > before.margin && fires.pct > before.pct, 're-derived — and the count proves it ran');

	sync = diffPlanToTaskOps(snapshotPlan(g), sync.mirror);
	console.log('sync 2  →', JSON.stringify(sync.ops), '← nothing to reopen: the values simply followed');
	assert.deepEqual(sync.ops, [], 'a recomputable drift needs NO host action: the tasks stayed done, correctly');

	// ── DRIFT-B — a WITHDRAWN premise: nothing to recompute → the tasks REOPEN, with the reason ────
	await new Promise(( res ) => g.ingest({ report: { costs: null } }, res) );     // the figure is withdrawn entirely
	await settle(g);
	console.log('drift-B →', JSON.stringify({ marginCast: cast(g, 'report', 'Step_margin'), margin: fact(g, 'report', 'r_margin'), pctCast: cast(g, 'report', 'Step_pct') }));
	assert.equal(cast(g, 'report', 'Step_margin'), false, 'the step retracted — its premise is gone');
	assert.equal(fact(g, 'report', 'r_margin'), null, 'THE POINT: a HOLE, not the stale 600');
	assert.equal(cast(g, 'report', 'Step_pct'), false, 'and the composition retracted in cascade — no orphan derived value');

	const constats = fact(g, 'mem', 'lessons');
	console.log('constat →', JSON.stringify(constats.map(( l ) => ({ what: l.kind, why: l.retractedBecause, rev: l.atRev }) )));
	assert.ok(constats.length >= 2, 'each retraction deposited a TYPED record: what fell, why, at which revision');

	sync = diffPlanToTaskOps(snapshotPlan(g), sync.mirror);
	const reopens = sync.ops.filter(( o ) => o.op === 'reopen' );
	console.log('sync 3  →', reopens.map(( o ) => 'reopen:' + o.id + ' — ' + o.reason ).join('\n           '));
	assert.equal(reopens.length, 2, 'BOTH done tasks reopened at the host — including the one that only depended INDIRECTLY');
	assert.match(reopens[0].reason, /premise drifted/, 'and each reopen carries the reason, not just a status flip');

	// ── idempotence: syncing the same state again says nothing (a delta, not a resend) ─────────────
	const again = diffPlanToTaskOps(snapshotPlan(g), sync.mirror);
	assert.deepEqual(again.ops, [], 'same state twice → empty delta');
	console.log('sync 4  → [] (idempotent — the mirror only ever speaks about CHANGES)');
	g.destroy && g.destroy();

	console.log('BOOTSTRAP OK — a corrected premise re-derives at 0 model calls; a withdrawn one leaves a HOLE and REOPENS the dependent tasks, with the reason');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
