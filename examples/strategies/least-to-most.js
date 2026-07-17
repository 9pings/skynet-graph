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
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');
const { exchange, of, liveBanner } = require('./_live.js');

const plan = ( k ) => ({ _id: 'ledger', isPlan: true, k, solved: [] });          // the ladder declares its k rungs
const step = ( id, rank, prev, o ) => Object.assign({ _id: id, isThought: true, rank, text: 't' }, prev ? { prev } : {}, o);

async function main() {
	title('SOLVE THE EASY PART FIRST — AND YOU CANNOT CHEAT THE ORDER');
	say('Break a hard problem into an easy-to-hard ladder, and solve each rung knowing the ones');
	say('below it. The usual way needs a scheduler telling each step when to run. There is no');
	say('scheduler here, and skipping ahead is not merely discouraged — it is impossible.');
	gap();
	liveBanner();
	gap();
	beat(0, 'THE classic for this one: the widget trap. Most people say 100 minutes. It is 5.');
	exchange('least-to-most', 0, 'asked whole — and this model is not fooled: it says 5, which is right');
	say('         (worth saying plainly: no win for us here. It did not need the ladder.)');
	gap();
	beat(1, 'The ladder anyway — easiest rung first, and each rung only gets its own small job:');
	exchange('least-to-most', 1, 'rung 1: one machine, one widget. Nothing before it');
	exchange('least-to-most', 2, 'rung 2: handed rung 1\'s answer, and nothing else');
	good('same answer, 5 — but now every step is one you can check on its own');
	say('         That is the trade: not a smarter answer, an inspectable one. On the long');
	say('         chained problems it IS the difference (see the head-to-head demo: 336 vs 354).');
	gap();
	say('  And here is the part that has no model in it at all — the order running itself:');

	// ── 1. the chain releases itself, one rung at a time ──────────────────────────────────────────
	const s = bootStrategy('least-to-most', { nodes: [plan(3), step('s0', 0), step('s1', 1, 's0'), step('s2', 2, 's1')] });
	await s.settle();
	beat(1, 'Three rungs, easiest first. Which are open for work right now?');
	val('open', 'only the easiest one. The other two are not open yet');
	assert.equal(s.cast('s0', 'Ready'), true, 'only the easiest rung is released');
	assert.equal(s.cast('s1', 'Ready'), false, 's1 waits on s0');

	await s.ingest({ s0: { answer: 'a0' } });                                    // the host solves the released rung
	await s.settle();
	beat(2, 'We answer the easy one. Nothing else is touched.');
	good('the next rung opened BY ITSELF — nothing scheduled it');
	val('still closed', 'the third rung — it waits on the second');
	assert.equal(s.cast('s1', 'Ready'), true, 's0 Solved re-armed s1 — the dataflow IS the scheduler');
	assert.equal(s.cast('s2', 'Ready'), false, 's2 still gated on s1');
	s.close();
	gap();

	// ── 2. THE ORDER GUARD (the negative control): an early answer is refused, then honoured in turn ──
	const g = bootStrategy('least-to-most', { nodes: [plan(2), step('s0', 0), step('s1', 1, 's0', { answer: 'early!' })] });
	await g.settle();
	beat(3, 'Now someone answers rung 2 EARLY, before rung 1 is done.');
	bad('refused. The answer sits there, uncounted — it was not its turn');
	say('       (a scheduler you write can be bypassed. A rule that says "not before your turn" cannot.)');
	assert.equal(g.cast('s1', 'Solved'), false, 's1 HAS an answer but was never released → refused, not admitted');
	assert.deepEqual(g.fact('ledger', 'solved'), [], 'nothing tallied out of order');

	await g.ingest({ s0: { answer: 'a0' } });                                    // s0 solved → s1 releases → its answer NOW counts
	await g.settle();
	beat(4, 'We answer rung 1. Rung 2 opens — and its early answer NOW counts.');
	good('both rungs done, in the right order, and the order is on the record');
	good('the whole thing is complete — so the parts can be put back together');
	assert.deepEqual(g.fact('ledger', 'solved'), ['s0', 's1'], 'the ladder order held — the audit records the emergent order');
	assert.equal(g.cast('ledger', 'Complete'), true, 'all k rungs → the composition gate opens');
	g.close();
	gap();

	// ── 3. THE COUNTER-GATE: partial coverage never completes ──────────────────────────────────────
	const p = bootStrategy('least-to-most', { nodes: [plan(2), step('s0', 0, null, { answer: 'a0' }), step('s1', 1, 's0')] });
	await p.settle();
	beat(5, 'And if one rung is left unanswered?');
	bad('never "complete". You cannot assemble an answer out of a half-done ladder');
	assert.equal(p.cast('ledger', 'Complete'), false, '1/2 → no faked completion');
	p.close();
	gap();

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
	say('The whole ladder, driven for real. We only ever answer what is open — we never');
	say('decide the order. Each rung is solved knowing exactly the ones below it:');
	for ( const o of order ) {
		const m = o.match(/^(s\d)\(saw:(\d)\)$/);
		note('rung ' + (Number(m[1][1]) + 1) + ' — answered knowing '
			+ (m[2] === '0' ? 'nothing before it' : m[2] === '1' ? 'the rung below it' : 'the ' + m[2] + ' rungs below it'));
	}
	good('complete — every rung, in order, none skipped');
	assert.deepEqual(order, ['s0(saw:0)', 's1(saw:1)', 's2(saw:2)'], 'each rung was solved seeing exactly its priors');
	assert.equal(L.cast('ledger', 'Complete'), true);
	L.close();

	finish('the order runs itself, and answering out of turn is refused — not just discouraged.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
