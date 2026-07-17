/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — SOCRATIC: probe a claim with bounded questions, distill each answer into an insight,
 * synthesize ONLY once every declared question has actually landed.
 *
 * THE GUARANTEE SHOWN: the synthesis gate is a COVERAGE COUNTER-GATE. Declare 3 probes and answer 2, and
 * `Synthesize` does not open — you cannot conclude over questions you skipped. Coverage is counted, never
 * asserted. And the follow-up regress is bounded twice over: a depth budget, plus a one-follow-up-per-
 * question null-guard, so "why? / but why?" cannot run forever.
 *
 * WHO ASKS: the host (its model, its prompts). This plugin is the deposited control flow + the audit trail.
 * Tier-0 — pure grammar, zero JS.
 *
 * Deterministic, no model:  node examples/strategies/socratic.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');

// a probe = a kernel Thought carrying the question; the host later writes `answer` + the distilled `insight`
const probe = ( id, o ) => Object.assign({ _id: id, isThought: true, question: 'q?', depth: 0, maxDepth: 2 }, o);

async function main() {
	// ── 1. full coverage → the synthesis gate opens ────────────────────────────────────────────────
	const s = bootStrategy('socratic', {
		nodes: [
			{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },      // the inquiry declares its probes
			probe('q1', { answer: 'a1', insight: 'i1' }),
			probe('q2', { answer: 'a2', insight: 'i2' }),
		],
	});
	await s.settle();
	console.log('insights →', JSON.stringify(s.fact('ledger', 'insights')), '| synthesize:', s.cast('ledger', 'Synthesize'));
	assert.equal(s.cast('q1', 'Insight'), true, 'an answered probe distilled and tallied');
	assert.equal(s.cast('ledger', 'Synthesize'), true, '2/2 → conclude');
	s.close();

	// ── 2. THE COUNTER-GATE (the negative control): one silent question blocks the conclusion ──────
	const partial = bootStrategy('socratic', {
		nodes: [
			{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },
			probe('q1', { answer: 'a1', insight: 'i1' }),
			probe('q2', {}),                                                    // never answered
		],
	});
	await partial.settle();
	console.log('partial  →', JSON.stringify({ insights: partial.fact('ledger', 'insights'), synthesize: partial.cast('ledger', 'Synthesize') }));
	assert.equal(partial.cast('q2', 'Answered'), false);
	assert.equal(partial.cast('ledger', 'Synthesize'), false, '1/2 → no conclusion over a skipped probe');
	partial.close();

	// ── 3. the gate is LIVE: answer the missing probe and the conclusion opens itself ──────────────
	// no re-run, no re-plan — the host writes the late answer and the coverage gate re-evaluates natively.
	await partial_reopen();

	// ── 4. THE REGRESS BOUND: one follow-up per question, and only under the depth budget ──────────
	const deep = bootStrategy('socratic', {
		nodes: [
			{ _id: 'ledger', isInquiry: true, expected: 9, insights: [] },
			probe('q-can', { answer: 'a', insight: 'i', depth: 0, maxDepth: 2 }),                  // room to dig
			probe('q-max', { answer: 'a', insight: 'i', depth: 2, maxDepth: 2 }),                  // at the budget
			probe('q-done', { answer: 'a', insight: 'i', depth: 0, maxDepth: 2, followedUp: 1 }),  // already dug once
		],
	});
	await deep.settle();
	for ( const id of ['q-can', 'q-max', 'q-done'] ) console.log(id.padEnd(8), '→ Deeper:', deep.cast(id, 'Deeper'));
	assert.equal(deep.cast('q-can', 'Deeper'), true, 'under the depth budget → dig');
	assert.equal(deep.cast('q-max', 'Deeper'), false, 'at maxDepth → no infinite "but why?"');
	assert.equal(deep.cast('q-done', 'Deeper'), false, 'the null-guard: one follow-up per question');
	deep.close();

	console.log('STRATEGY OK — synthesis gated on counted coverage (a skipped probe blocks it); the follow-up regress is doubly bounded');
}

async function partial_reopen() {
	const g = bootStrategy('socratic', {
		nodes: [
			{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },
			probe('q1', { answer: 'a1', insight: 'i1' }),
			probe('q2', {}),
		],
	});
	await g.settle();
	assert.equal(g.cast('ledger', 'Synthesize'), false, 'precondition: blocked at 1/2');
	await g.ingest({ q2: { answer: 'a2', insight: 'i2' } });                   // the host finally asks q2
	await g.settle();
	console.log('reopened →', JSON.stringify({ insights: g.fact('ledger', 'insights').slice().sort(), synthesize: g.cast('ledger', 'Synthesize') }));
	assert.equal(g.cast('ledger', 'Synthesize'), true, 'the late answer opened the gate — no orchestration code');
	g.close();
}
main().catch(( e ) => { console.error(e); process.exit(1); });
