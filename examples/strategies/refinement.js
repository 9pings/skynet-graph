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
 * doc/CAPABILITIES.md F5). Pass in a score from something that is not the drafter.
 *
 * Its sibling gate is `reflexion.js` — same family, binary verdict instead of a band.
 * Deterministic, no model:  node examples/strategies/refinement.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');

// an attempt = a kernel Thought carrying a raw score (from the EXTERNAL judge) + its round counter
const attempt = ( id, score, round, maxRounds ) => ({ _id: id, isThought: true, score, round, maxRounds: maxRounds == null ? 3 : maxRounds });

async function main() {
	// ── 1. the band snap + the two signals ────────────────────────────────────────────────────────
	const s = bootStrategy('refinement', {
		nodes: [
			attempt('r0', 0.40, 0),      // low  + budget left → Refine
			attempt('r1', 0.60, 1),      // mid  + budget left → Refine
			attempt('r2', 0.90, 2),      // high               → Accept
		],
	});
	await s.settle();
	for ( const id of ['r0', 'r1', 'r2'] )
		console.log(id, '→', JSON.stringify({ score: s.fact(id, 'score'), band: s.fact(id, 'scoreBand'), accept: s.cast(id, 'Accept'), refine: s.cast(id, 'Refine') }));
	assert.equal(s.fact('r0', 'scoreBand'), 'low');
	assert.equal(s.fact('r2', 'scoreBand'), 'high', 'the kernel Score brick snapped 0.9 → high');
	assert.equal(s.cast('r2', 'Accept'), true, 'the high band is what the gate reads — not 0.9');
	assert.equal(s.cast('r0', 'Refine'), true, 'below threshold with budget → keep going');
	assert.equal(s.cast('r0', 'Accept'), false, 'a low attempt is never accepted');
	s.close();

	// ── 2. THE BOUND (the negative control): the loop terminates on its own ────────────────────────
	// round == maxRounds and still low: NEITHER gate casts. Nothing to accept, nothing left to spend —
	// the round budget is encoded as a null-guard in the grammar, so there is no runaway refinement.
	const b = bootStrategy('refinement', { nodes: [attempt('last', 0.40, 3, 3)] });
	await b.settle();
	console.log('budget spent →', JSON.stringify({ band: b.fact('last', 'scoreBand'), accept: b.cast('last', 'Accept'), refine: b.cast('last', 'Refine') }));
	assert.equal(b.cast('last', 'Accept'), false, 'not accepted — the band never reached high');
	assert.equal(b.cast('last', 'Refine'), false, 'and not refined either — the budget is spent');
	b.close();

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
	console.log('loop    →', JSON.stringify({ drafts, stoppedAt: id, band: loop.fact(id, 'scoreBand'), accepted: loop.cast(id, 'Accept') }));
	assert.equal(loop.cast(id, 'Accept'), true, 'the loop ran until the external judge banded it high');
	assert.equal(drafts, 3, 'it took 3 drafts — and the grammar, not the host, decided that');
	loop.close();

	console.log('STRATEGY OK — accept keys on a snapped band (never a raw float); the round budget bounds the loop by construction');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
