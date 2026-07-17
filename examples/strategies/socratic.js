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
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// a probe = a kernel Thought carrying the question; the host later writes `answer` + the distilled `insight`
const probe = ( id, o ) => Object.assign({ _id: id, isThought: true, question: 'q?', depth: 0, maxDepth: 2 }, o);

async function main() {
	title('INTERROGATE A CLAIM — AND NEVER CONCLUDE OVER A QUESTION YOU SKIPPED');
	say('Poke at an idea with questions, then sum up what you learned. The failure mode is that');
	say('you ask three questions, get bored after two, and write the conclusion anyway. Here the');
	say('conclusion is simply not available until every question you declared has an answer.');
	gap();

	// ── 1. full coverage → the synthesis gate opens ────────────────────────────────────────────────
	const s = bootStrategy('socratic', {
		nodes: [
			{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },      // the inquiry declares its probes
			probe('q1', { answer: 'a1', insight: 'i1' }),
			probe('q2', { answer: 'a2', insight: 'i2' }),
		],
	});
	await s.settle();
	beat(1, 'We declare 2 questions, and we answer both.');
	val('answered', '2 of 2');
	good('the conclusion is unlocked');
	assert.equal(s.cast('q1', 'Insight'), true, 'an answered probe distilled and tallied');
	assert.equal(s.cast('ledger', 'Synthesize'), true, '2/2 → conclude');
	s.close();
	gap();

	// ── 2. THE COUNTER-GATE (the negative control): one silent question blocks the conclusion ──────
	const partial = bootStrategy('socratic', {
		nodes: [
			{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },
			probe('q1', { answer: 'a1', insight: 'i1' }),
			probe('q2', {}),                                                    // never answered
		],
	});
	await partial.settle();
	beat(2, 'Same 2 questions — but this time we quietly skip the second one.');
	val('answered', '1 of 2');
	bad('no conclusion. Not "a weaker conclusion" — none at all');
	assert.equal(partial.cast('q2', 'Answered'), false);
	assert.equal(partial.cast('ledger', 'Synthesize'), false, '1/2 → no conclusion over a skipped probe');
	partial.close();
	gap();

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
	say('"But why?" can go on forever. Two separate limits stop it:');
	const rule = ( when, then ) => when.padEnd(42) + '→ ' + then;
	good(rule('a question with room left to dig', 'you may dig once'));
	bad(rule('a question already dug as deep as allowed', 'stop'));
	bad(rule('a question that was already followed up', 'stop. One follow-up each, no more'));
	assert.equal(deep.cast('q-can', 'Deeper'), true, 'under the depth budget → dig');
	assert.equal(deep.cast('q-max', 'Deeper'), false, 'at maxDepth → no infinite "but why?"');
	assert.equal(deep.cast('q-done', 'Deeper'), false, 'the null-guard: one follow-up per question');
	deep.close();

	finish('you cannot conclude over a question you skipped, and "but why?" cannot run forever.', 'STRATEGY OK');
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
	beat(3, 'We go back and answer the one we skipped.');
	good('the conclusion unlocks itself. Nothing was re-planned or re-run');
	assert.equal(g.cast('ledger', 'Synthesize'), true, 'the late answer opened the gate — no orchestration code');
	g.close();
	gap();
}
main().catch(( e ) => { console.error(e); process.exit(1); });
