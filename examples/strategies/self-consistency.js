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

// The host's job: run the model k times, snap each reply to a vote class. Here the k replies are scripted
// so the run is deterministic — in production these come from k sampled completions (temp > 0).
const paths = ( classes ) => classes.map(( c, i ) => ({ _id: 'path' + i, isThought: true, answerClass: c }));

async function main() {
	// ── 1. a clear majority DECIDES ────────────────────────────────────────────────────────────────
	// the ledger node declares the vote: k paths expected, a verdict needs a margin of ≥ 2 over the runner-up
	const a = bootStrategy('self-consistency', {
		nodes: [
			{ _id: 'ledger', isDecision: true, threshold: 2, k: 5, votes: [] },
			...paths(['A', 'A', 'A', 'B', 'C']),          // A=3, B=1, C=1 → margin 3−1 = 2
		],
	});
	await a.settle();
	console.log('votes   →', JSON.stringify(a.fact('ledger', 'votes')));
	console.log('decided →', JSON.stringify({ consensus: a.fact('ledger', 'consensus'), margin: a.fact('ledger', 'margin'), verdict: a.fact('ledger', 'verdict') }));
	assert.equal(a.fact('ledger', 'verdict'), 'A', 'margin 2 ≥ threshold 2 → the majority is admitted');
	assert.equal(a.cast('path0', 'Vote'), true, 'each path cast Vote — it rode the kernel Thought concept');
	a.close();

	// ── 2. THE BOUND (the negative control): a tie is UNDECIDED, never coin-flipped ────────────────
	const b = bootStrategy('self-consistency', {
		nodes: [
			{ _id: 'ledger', isDecision: true, threshold: 2, k: 4, votes: [] },
			...paths(['A', 'A', 'B', 'B']),               // A=2, B=2 → margin 0
		],
	});
	await b.settle();
	console.log('tie     →', JSON.stringify({ margin: b.fact('ledger', 'margin'), verdict: b.fact('ledger', 'verdict') }));
	assert.equal(b.fact('ledger', 'verdict'), 'UNDECIDED', 'below the margin bound → no fabricated verdict');
	b.close();

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
	console.log('abstain →', JSON.stringify({ votes: c.fact('ledger', 'votes'), decided: c.cast('ledger', 'Decide'), verdict: c.fact('ledger', 'verdict') }));
	assert.equal(c.cast('path4', 'Vote'), false, 'no answerClass → no Vote: an abstention is never a class');
	assert.equal(c.fact('ledger', 'votes').length, 4, 'only the 4 parsable paths tallied');
	assert.equal(c.cast('ledger', 'Decide'), false, '4/5 of the declared pool → the gate stays shut');
	assert.equal(c.fact('ledger', 'verdict'), undefined, 'no verdict invented from an incomplete pool');
	c.close();

	console.log('STRATEGY OK — a majority decides at margin ≥ threshold; a tie is UNDECIDED; an abstention never becomes a vote');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
