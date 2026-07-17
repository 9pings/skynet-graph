/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — REFLEXION: attempt → an EXTERNAL critique verdict → accept, or revise, within a budget.
 *
 * Same family as `refinement.js`, second accept gate: a BINARY verdict (`CORRECT` / anything else) instead
 * of a score band. Use it when your judge is a test run, an oracle, or a reviewer model that answers
 * pass/fail rather than a number.
 *
 * THE GUARANTEE SHOWN — and it is a refusal, which is the interesting part: **an unjudged attempt fires
 * NOTHING**. The gate requires a `critiqueVerdict` that came from outside; the plugin ships no path where
 * the drafting model grades its own draft. That is not an oversight, it is the measured result: the
 * self-audit was tested three times and refuted (a low-quant judge scoring itself lands at chance —
 * docs/CAPABILITIES.md F5). The refusal is enforced by the grammar, so it cannot be forgotten.
 *
 * Deterministic, no model:  node examples/strategies/reflexion.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// an attempt + the verdict an EXTERNAL critic returned about it
const judged = ( id, verdict, round, maxRounds ) => ({ _id: id, isThought: true, critiqueVerdict: verdict, round, maxRounds: maxRounds == null ? 3 : maxRounds });

async function main() {
	title('NOBODY MARKS THEIR OWN HOMEWORK');
	say('Same idea as the draft-and-improve loop, but the judge answers pass/fail instead of a');
	say('score — a test suite, a checker, a reviewer.');
	gap();
	say('The interesting part of this one is what it REFUSES. A draft that nobody judged does');
	say('nothing at all: it is not assumed fine, and the model that wrote it is never allowed to');
	say('grade it. That is not an oversight to fix later — letting a model judge its own work was');
	say('tried three times and landed at about coin-flip accuracy. So the path does not exist.');
	gap();

	// ── 1. the binary gate ────────────────────────────────────────────────────────────────────────
	const s = bootStrategy('refinement', {                                   // the reflexion set ships in the refinement plugin
		nodes: [
			judged('v-ok', 'CORRECT', 1),                                       // the critic passed it → done
			judged('v-ko', 'FLAWED', 1),                                        // the critic failed it → revise
		],
	});
	await s.settle();
	beat(1, 'Two drafts come back from the reviewer:');
	note('the reviewer said PASS  → accepted, we are done');
	note('the reviewer said FAIL  → back to the drawing board');
	assert.equal(s.cast('v-ok', 'Correct'), true, 'an external CORRECT verdict accepts');
	assert.equal(s.cast('v-ok', 'Revise'), false, 'an accepted attempt does not revise');
	assert.equal(s.cast('v-ko', 'Revise'), true, 'a flawed attempt with budget revises');
	s.close();
	gap();

	// ── 2. THE REFUSAL (the negative control): no external verdict, no gate ────────────────────────
	// An attempt nobody judged sits inert. It is not "assumed fine", and it is not self-graded. The host
	// must go get a verdict from something that is not the drafter.
	const raw = bootStrategy('refinement', { nodes: [{ _id: 'v-raw', isThought: true, round: 0, maxRounds: 3 }] });
	await raw.settle();
	beat(2, 'And a third draft that nobody has reviewed at all.');
	bad('not accepted — nobody vouched for it');
	bad('not sent back either — and above all, it did not grade itself');
	say('       (it just sits there until a real reviewer looks at it. That is the point.)');
	assert.equal(raw.cast('v-raw', 'Correct'), false, 'never accepted without an EXTERNAL verdict');
	assert.equal(raw.cast('v-raw', 'Revise'), false, 'and never self-graded into a revision either');
	raw.close();
	gap();

	// ── 3. THE BOUND: flawed at the last round → the loop terminates ───────────────────────────────
	const last = bootStrategy('refinement', { nodes: [judged('v-last', 'FLAWED', 3, 3)] });
	await last.settle();
	beat(3, 'A draft still failing on the last allowed round?');
	bad('the loop is over. No accept, no retry — the budget is spent');
	assert.equal(last.cast('v-last', 'Correct'), false);
	assert.equal(last.cast('v-last', 'Revise'), false, 'the budget is spent — bounded by construction');
	last.close();
	gap();

	// ── 4. the loop, driven for real ───────────────────────────────────────────────────────────────
	// The production shape: while Revise casts, the host re-drafts and asks the EXTERNAL critic again.
	const critic = ['FLAWED', 'FLAWED', 'CORRECT'];                          // a scripted test-run / reviewer
	const loop = bootStrategy('refinement', { nodes: [judged('a0', critic[0], 0, 3)] });
	await loop.settle();
	let id = 'a0', round = 0, drafts = 1;
	while ( loop.cast(id, 'Revise') ) {
		round++;
		const next = 'a' + round;
		await loop.ingest({ [next]: { isThought: true, round, maxRounds: 3, critiqueVerdict: critic[round] } });
		await loop.settle();
		id = next; drafts++;
	}
	beat(4, 'The real loop: write → get reviewed → rewrite, until the reviewer passes it.');
	val('drafts written', drafts);
	val('stopped because', 'the reviewer finally said PASS');
	assert.equal(loop.cast(id, 'Correct'), true, 'the loop ran until the external critic passed it');
	assert.equal(drafts, 3);
	loop.close();

	finish('a draft nobody reviewed goes nowhere — and no model is ever its own reviewer.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
