/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — LEAST-TO-MOST: rank sub-problems easiest→hardest, solve them in that order, each with the
 * previous solutions in hand.
 *
 * THE GUARANTEE SHOWN — two things you would otherwise write a scheduler for, and neither is code here:
 *   1. THE RELEASE ORDER EMERGES. Nothing schedules anything. `Ready` casts on a step when the previous
 *      step is `Solved` — a chain of hop-watched gates. Solve step 0 and step 1 releases itself.
 *   2. THE ORDER GUARD IS STRUCTURAL. `Solved` requires `Ready`, so an answer that arrives out of order is
 *      REFUSED, not silently accepted. Below, step 1 is pre-answered before step 0 is even released: its
 *      answer sits there, uncounted, until its turn actually comes. A scheduler you write can be bypassed;
 *      a precondition in the grammar cannot.
 *
 * WHO SOLVES: the host (its model), one released step at a time. Tier-0 — pure grammar, zero JS.
 * Deterministic, no model:  node examples/strategies/least-to-most.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');

const plan = ( k ) => ({ _id: 'ledger', isPlan: true, k, solved: [] });          // the ladder declares its k rungs
const step = ( id, rank, prev, o ) => Object.assign({ _id: id, isThought: true, rank, text: 't' }, prev ? { prev } : {}, o);

async function main() {
	// ── 1. the chain releases itself, one rung at a time ──────────────────────────────────────────
	const s = bootStrategy('least-to-most', { nodes: [plan(3), step('s0', 0), step('s1', 1, 's0'), step('s2', 2, 's1')] });
	await s.settle();
	console.log('start   → ready:', ['s0', 's1', 's2'].filter(( id ) => s.cast(id, 'Ready') ));
	assert.equal(s.cast('s0', 'Ready'), true, 'only the easiest rung is released');
	assert.equal(s.cast('s1', 'Ready'), false, 's1 waits on s0');

	await s.ingest({ s0: { answer: 'a0' } });                                    // the host solves the released rung
	await s.settle();
	console.log('s0 done → ready:', ['s0', 's1', 's2'].filter(( id ) => s.cast(id, 'Ready') ), '| solved:', JSON.stringify(s.fact('ledger', 'solved')));
	assert.equal(s.cast('s1', 'Ready'), true, 's0 Solved re-armed s1 — the dataflow IS the scheduler');
	assert.equal(s.cast('s2', 'Ready'), false, 's2 still gated on s1');
	s.close();

	// ── 2. THE ORDER GUARD (the negative control): an early answer is refused, then honoured in turn ──
	const g = bootStrategy('least-to-most', { nodes: [plan(2), step('s0', 0), step('s1', 1, 's0', { answer: 'early!' })] });
	await g.settle();
	console.log('early   →', JSON.stringify({ s1solved: g.cast('s1', 'Solved'), solved: g.fact('ledger', 'solved') }));
	assert.equal(g.cast('s1', 'Solved'), false, 's1 HAS an answer but was never released → refused, not admitted');
	assert.deepEqual(g.fact('ledger', 'solved'), [], 'nothing tallied out of order');

	await g.ingest({ s0: { answer: 'a0' } });                                    // s0 solved → s1 releases → its answer NOW counts
	await g.settle();
	console.log('in turn →', JSON.stringify({ solved: g.fact('ledger', 'solved'), complete: g.cast('ledger', 'Complete') }));
	assert.deepEqual(g.fact('ledger', 'solved'), ['s0', 's1'], 'the ladder order held — the audit records the emergent order');
	assert.equal(g.cast('ledger', 'Complete'), true, 'all k rungs → the composition gate opens');
	g.close();

	// ── 3. THE COUNTER-GATE: partial coverage never completes ──────────────────────────────────────
	const p = bootStrategy('least-to-most', { nodes: [plan(2), step('s0', 0, null, { answer: 'a0' }), step('s1', 1, 's0')] });
	await p.settle();
	assert.equal(p.cast('ledger', 'Complete'), false, '1/2 → no faked completion');
	p.close();

	// ── 4. the ladder, driven for real ─────────────────────────────────────────────────────────────
	// The production shape: solve whatever is Ready, with the prior answers in context; repeat until
	// Complete. The host never decides the ORDER — it just answers what the graph released.
	const L = bootStrategy('least-to-most', { nodes: [plan(3), step('s0', 0), step('s1', 1, 's0'), step('s2', 2, 's1')] });
	await L.settle();
	const order = [];
	for ( let guard = 0; guard < 10 && !L.cast('ledger', 'Complete'); guard++ ) {
		const ready = ['s0', 's1', 's2'].filter(( id ) => L.cast(id, 'Ready') && !L.cast(id, 'Solved') );
		if ( !ready.length ) break;
		for ( const id of ready ) {
			const context = L.fact('ledger', 'solved');                            // what the host feeds the model: the prior rungs
			order.push(id + '(saw:' + context.length + ')');
			await L.ingest({ [id]: { answer: 'solved-with-' + context.length + '-priors' } });
		}
		await L.settle();
	}
	console.log('driven  →', order.join(' → '), '| complete:', L.cast('ledger', 'Complete'));
	assert.deepEqual(order, ['s0(saw:0)', 's1(saw:1)', 's2(saw:2)'], 'each rung was solved seeing exactly its priors');
	assert.equal(L.cast('ledger', 'Complete'), true);
	L.close();

	console.log('STRATEGY OK — the release order emerges from the dataflow; an out-of-order answer is structurally refused');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
