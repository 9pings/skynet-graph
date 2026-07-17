/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — SELF-CONSISTENCY: k independent reasoning paths → a vote ledger → a margin gate.
 *
 * THE GUARANTEE SHOWN: the majority answer wins ONLY when it wins by enough. A 3-vs-1 majority decides;
 * a 2-vs-2 tie renders an honest **UNDECIDED** instead of coin-flipping the tie into a confident answer.
 * That bound is the whole point — it is the measured decidability rule, not a nicety.
 *
 * WHO DOES WHAT: the HOST runs the model k times and snaps each answer to a discrete `answerClass`
 * (the canonicalization barrier: vote on typed classes, never on prose). The PLUGIN tallies and decides.
 * Tier-0 — pure grammar, zero JS: there is no code of ours to trust in the decision.
 *
 * Deterministic, no model, no GPU:  node examples/strategies/self-consistency.js
 * Live counterpart: the `self_consistency` MCP tool (`sg mcp`) samples the k paths for real.
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');
const { exchange, of, liveBanner } = require('./_live.js');

// The host's job: run the model k times, snap each reply to a vote class. Here the k replies are scripted
// so the run is deterministic — in production these come from k sampled completions (temp > 0).
const paths = ( classes ) => classes.map(( c, i ) => ({ _id: 'path' + i, isThought: true, answerClass: c }));

async function main() {
	title('ASK THE MODEL 5 TIMES — AND ONLY BELIEVE A CLEAR WINNER');
	say('Running a model several times and taking the majority answer is a well-known trick.');
	say('The catch nobody handles: what if the majority is 2 votes against 2? Most code picks one');
	say('anyway. This one refuses — and saying "I do not know" is the whole point.');
	gap();
	liveBanner();

	// ── the REAL thing: 5 real runs of a real question on a real model ────────────────────────────
	gap();
	beat(0, 'We ask a real model the corn-stalk word problem below, five separate times. Run 1 of 5:');
	exchange('self-consistency', 0, 'note the salt — "attempt 1 of 5". Without it a local model pins its');
	say('         random seed and returns FIVE IDENTICAL answers: a vote that means nothing.');
	say('         (that one was found by running it on a real GPU, not by thinking about it.)');
	const live = of('self-consistency').map(( e ) => (String(e.reply).match(/ANSWER:\s*([\d.]+)/) || [])[1] );
	gap();
	// the five recorded answers go to the REAL plugin: the kernel ledger tallies, the margin gate decides
	const lv = bootStrategy('self-consistency', {
		nodes: [ { _id: 'ledger', isDecision: true, threshold: 2, k: live.length, votes: [] }, ...paths(live) ],
	});
	await lv.settle();
	val('the 5 real answers', live.join(' · '));
	val('the graph says', lv.fact('ledger', 'verdict') + ' — margin ' + lv.fact('ledger', 'margin') + ' over the runner-up');
	assert.equal(lv.fact('ledger', 'verdict'), '84', 'the recorded runs agree on 84 (3 fields × 4 rows × 7 stalks)');
	lv.close();
	good('unanimous, so it answers. Below is what happens when they are NOT');
	gap();
	say('  The rest of this run is scripted, to show the cases a single real question cannot:');

	// ── 1. a clear majority DECIDES ────────────────────────────────────────────────────────────────
	// the ledger node declares the vote: k paths expected, a verdict needs a margin of ≥ 2 over the runner-up
	const a = bootStrategy('self-consistency', {
		nodes: [
			{ _id: 'ledger', isDecision: true, threshold: 2, k: 5, votes: [] },
			...paths(['A', 'A', 'A', 'B', 'C']),          // A=3, B=1, C=1 → margin 3−1 = 2
		],
	});
	await a.settle();
	beat(1, 'Five runs come back:  A · A · A · B · C');
	val('winner', 'A, with 3 votes');
	val('lead over runner-up', a.fact('ledger', 'margin') + ' votes — we asked for at least 2');
	good('answer: A. It won by enough, so it is believed');
	assert.equal(a.fact('ledger', 'verdict'), 'A', 'margin 2 ≥ threshold 2 → the majority is admitted');
	assert.equal(a.cast('path0', 'Vote'), true, 'each path cast Vote — it rode the kernel Thought concept');
	a.close();
	gap();

	// ── 2. THE BOUND (the negative control): a tie is UNDECIDED, never coin-flipped ────────────────
	const b = bootStrategy('self-consistency', {
		nodes: [
			{ _id: 'ledger', isDecision: true, threshold: 2, k: 4, votes: [] },
			...paths(['A', 'A', 'B', 'B']),               // A=2, B=2 → margin 0
		],
	});
	await b.settle();
	beat(2, 'Four runs come back:  A · A · B · B');
	val('lead over runner-up', b.fact('ledger', 'margin') + ' votes — a dead heat');
	bad('answer: I DO NOT KNOW. No coin is flipped, no winner is invented');
	assert.equal(b.fact('ledger', 'verdict'), 'UNDECIDED', 'below the margin bound → no fabricated verdict');
	b.close();
	gap();

	// ── 3. ABSTENTION: a path that produced no class never votes — and never gets invented ─────────
	// This is a MEASURED failure mode, not a hypothetical: on a live GPU run, paths whose reply carried no
	// parsable answer line had to be counted as abstentions. A parse failure is NOT a vote class. Here the
	// pool declares k=5 but one path abstained (no `answerClass`), so only 4 votes land — and the Decide
	// gate simply never opens. No verdict is fabricated from an incomplete pool; the caller must decide
	// what to do (re-sample, or re-declare k over the valid votes — what the `self_consistency` MCP tool does).
	const c = bootStrategy('self-consistency', {
		nodes: [
			{ _id: 'ledger', isDecision: true, threshold: 2, k: 5, votes: [] },
			...paths(['A', 'A', 'A', 'B']),
			{ _id: 'path4', isThought: true },            // the model rambled: no parsable class → no vote
		],
	});
	await c.settle();
	beat(3, 'Five runs — but one of them rambled and gave no usable answer at all.');
	val('usable votes', c.fact('ledger', 'votes').length + ' out of the 5 we asked for');
	bad('the rambling run does NOT get counted as a vote for anything');
	bad('and with an incomplete set, no answer is announced at all');
	say('       (this is not hypothetical: on a real GPU run, a model whose reply had no');
	say('        readable answer line had to be counted as an abstention.)');
	assert.equal(c.cast('path4', 'Vote'), false, 'no answerClass → no Vote: an abstention is never a class');
	assert.equal(c.fact('ledger', 'votes').length, 4, 'only the 4 parsable paths tallied');
	assert.equal(c.cast('ledger', 'Decide'), false, '4/5 of the declared pool → the gate stays shut');
	assert.equal(c.fact('ledger', 'verdict'), undefined, 'no verdict invented from an incomplete pool');
	c.close();

	finish('a clear winner is believed; a tie says "I do not know"; a junk answer is never a vote.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
