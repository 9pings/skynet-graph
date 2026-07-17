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
 * doc/CAPABILITIES.md F5). The refusal is enforced by the grammar, so it cannot be forgotten.
 *
 * Deterministic, no model:  node examples/strategies/reflexion.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');

// an attempt + the verdict an EXTERNAL critic returned about it
const judged = ( id, verdict, round, maxRounds ) => ({ _id: id, isThought: true, critiqueVerdict: verdict, round, maxRounds: maxRounds == null ? 3 : maxRounds });

async function main() {
	// ── 1. the binary gate ────────────────────────────────────────────────────────────────────────
	const s = bootStrategy('refinement', {                                   // the reflexion set ships in the refinement plugin
		nodes: [
			judged('v-ok', 'CORRECT', 1),                                       // the critic passed it → done
			judged('v-ko', 'FLAWED', 1),                                        // the critic failed it → revise
		],
	});
	await s.settle();
	console.log('passed  →', JSON.stringify({ correct: s.cast('v-ok', 'Correct'), revise: s.cast('v-ok', 'Revise') }));
	console.log('failed  →', JSON.stringify({ correct: s.cast('v-ko', 'Correct'), revise: s.cast('v-ko', 'Revise') }));
	assert.equal(s.cast('v-ok', 'Correct'), true, 'an external CORRECT verdict accepts');
	assert.equal(s.cast('v-ok', 'Revise'), false, 'an accepted attempt does not revise');
	assert.equal(s.cast('v-ko', 'Revise'), true, 'a flawed attempt with budget revises');
	s.close();

	// ── 2. THE REFUSAL (the negative control): no external verdict, no gate ────────────────────────
	// An attempt nobody judged sits inert. It is not "assumed fine", and it is not self-graded. The host
	// must go get a verdict from something that is not the drafter.
	const raw = bootStrategy('refinement', { nodes: [{ _id: 'v-raw', isThought: true, round: 0, maxRounds: 3 }] });
	await raw.settle();
	console.log('unjudged→', JSON.stringify({ correct: raw.cast('v-raw', 'Correct'), revise: raw.cast('v-raw', 'Revise') }));
	assert.equal(raw.cast('v-raw', 'Correct'), false, 'never accepted without an EXTERNAL verdict');
	assert.equal(raw.cast('v-raw', 'Revise'), false, 'and never self-graded into a revision either');
	raw.close();

	// ── 3. THE BOUND: flawed at the last round → the loop terminates ───────────────────────────────
	const last = bootStrategy('refinement', { nodes: [judged('v-last', 'FLAWED', 3, 3)] });
	await last.settle();
	assert.equal(last.cast('v-last', 'Correct'), false);
	assert.equal(last.cast('v-last', 'Revise'), false, 'the budget is spent — bounded by construction');
	last.close();

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
	console.log('loop    →', JSON.stringify({ drafts, stoppedAt: id, accepted: loop.cast(id, 'Correct') }));
	assert.equal(loop.cast(id, 'Correct'), true, 'the loop ran until the external critic passed it');
	assert.equal(drafts, 3);
	loop.close();

	console.log('STRATEGY OK — accept requires an EXTERNAL verdict; an unjudged attempt fires nothing (no self-audit path)');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
