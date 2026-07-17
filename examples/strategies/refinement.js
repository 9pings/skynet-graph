/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — ITERATIVE REFINEMENT: draft → score → accept, or refine again, within a round budget.
 *
 * THE GUARANTEE SHOWN: the accept gate keys on a SNAPPED BAND (`scoreBand == 'high'`), never on a raw
 * float — the canonicalization barrier (K1). And the loop is BOUNDED by construction: at the last round a
 * still-bad attempt neither accepts nor refines, so it terminates without a `while` loop to get wrong.
 *
 * WHO SCORES: the host — an EXTERNAL judge (a judge model, an oracle, a test suite). This plugin ships no
 * self-scoring path on purpose: the generator judging itself is the REFUTED self-audit (measured; see
 * docs/CAPABILITIES.md F5). Pass in a score from something that is not the drafter.
 *
 * Its sibling gate is `reflexion.js` — same family, binary verdict instead of a band.
 * Deterministic, no model:  node examples/strategies/refinement.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// an attempt = a kernel Thought carrying a raw score (from the EXTERNAL judge) + its round counter
const attempt = ( id, score, round, maxRounds ) => ({ _id: id, isThought: true, score, round, maxRounds: maxRounds == null ? 3 : maxRounds });

async function main() {
	title('DRAFT, GET MARKED, TRY AGAIN — WITH A HARD STOP');
	say('Write a draft, have it scored, improve it, repeat. Two things usually go wrong: the loop');
	say('runs forever, and the score is a made-up decimal nobody can defend. Here the marks are');
	say('coarse on purpose (bad / okay / good), and the loop is over when the budget is spent.');
	gap();
	say('IMPORTANT: the score comes from someone ELSE — a test suite, a checker, another model.');
	say('This never lets a model mark its own homework. That was tried, and it scored about as');
	say('well as guessing, so the door is closed rather than left ajar.');
	gap();

	// ── 1. the band snap + the two signals ────────────────────────────────────────────────────────
	const s = bootStrategy('refinement', {
		nodes: [
			attempt('r0', 0.40, 0),      // low  + budget left → Refine
			attempt('r1', 0.60, 1),      // mid  + budget left → Refine
			attempt('r2', 0.90, 2),      // high               → Accept
		],
	});
	await s.settle();
	beat(1, 'Three drafts come back marked by the external judge:');
	for ( const [ id, human ] of [['r0', 'a weak draft'], ['r1', 'a middling draft'], ['r2', 'a strong draft']] ) {
		const band = { low: 'BAD', mid: 'OKAY', high: 'GOOD' }[s.fact(id, 'scoreBand')];
		note(human.padEnd(18) + 'marked ' + band.padEnd(6) + '→ ' + (s.cast(id, 'Accept') ? 'accepted, we are done' : 'not good enough, try again'));
	}
	good('the decision reads the coarse mark, never the raw decimal behind it');
	assert.equal(s.fact('r0', 'scoreBand'), 'low');
	assert.equal(s.fact('r2', 'scoreBand'), 'high', 'the kernel Score brick snapped 0.9 → high');
	assert.equal(s.cast('r2', 'Accept'), true, 'the high band is what the gate reads — not 0.9');
	assert.equal(s.cast('r0', 'Refine'), true, 'below threshold with budget → keep going');
	assert.equal(s.cast('r0', 'Accept'), false, 'a low attempt is never accepted');
	s.close();
	gap();

	// ── 2. THE BOUND (the negative control): the loop terminates on its own ────────────────────────
	// round == maxRounds and still low: NEITHER gate casts. Nothing to accept, nothing left to spend —
	// the round budget is encoded as a null-guard in the grammar, so there is no runaway refinement.
	const b = bootStrategy('refinement', { nodes: [attempt('last', 0.40, 3, 3)] });
	await b.settle();
	beat(2, 'Last allowed round, and the draft is still bad. Now what?');
	bad('not accepted — it never got good enough');
	bad('and not retried either — the budget is gone. The loop is simply over');
	say('       (there is no "while" loop here to get wrong. Running out IS the stop.)');
	assert.equal(b.cast('last', 'Accept'), false, 'not accepted — the band never reached high');
	assert.equal(b.cast('last', 'Refine'), false, 'and not refined either — the budget is spent');
	b.close();
	gap();

	// ── 3. the loop, driven for real: the HOST is the only thing that writes ───────────────────────
	// Read this as the production shape. There is no strategy object to call: while Refine casts, the host
	// re-drafts and writes the next attempt; the grammar decides when to stop. Here a scripted judge
	// improves the draft each round (in production: your judge model / test run).
	const judge = [0.3, 0.55, 0.85];                                          // round 0, 1, 2 — an EXTERNAL score
	const loop = bootStrategy('refinement', { nodes: [attempt('a0', judge[0], 0, 3)] });
	await loop.settle();
	let id = 'a0', round = 0, drafts = 1;
	while ( loop.cast(id, 'Refine') ) {                                       // the gate IS the loop condition
		round++;
		const next = 'a' + round;
		await loop.ingest({ [next]: { isThought: true, round, maxRounds: 3, score: judge[round] } });
		await loop.settle();
		id = next; drafts++;
	}
	beat(3, 'The real loop: draft → get marked → improve, until the judge says it is good.');
	val('drafts written', drafts);
	val('stopped because', 'the external judge finally marked it GOOD');
	good('we never decided when to stop — we just kept going while it said "not yet"');
	assert.equal(loop.cast(id, 'Accept'), true, 'the loop ran until the external judge banded it high');
	assert.equal(drafts, 3, 'it took 3 drafts — and the grammar, not the host, decided that');
	loop.close();

	finish('somebody else marks the work, the marks are coarse, and the loop cannot run forever.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
