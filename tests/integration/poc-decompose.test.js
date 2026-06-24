'use strict';
/**
 * PoC M1 — the universal `_substrate` grammar STABILIZES a canned trip end-to-end (no
 * LLM): decompose -> answer the atomic leaves -> reactive bottom-up Rollup -> the
 * Claim / Verification / Trusted defeasance chain. This proves the authored grammar
 * RUNS on the engine, a step beyond M0 (which only proved it validates).
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M1).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');                                        // sets __SERVER__
const { runTripDecompose } = require('../../examples/poc/trip-decompose.js');
console.log = console.info = console.warn = () => {};

test('the universal grammar decomposes, answers, rolls up a trip, then casts the Claim chain', async () => {
	const g = await runTripDecompose({ maxDepth: 1 });
	const f = ( id ) => g._objById[id]._etty._;
	const segs = Object.keys(g._objById).filter(( id ) => f(id).Segment);

	// decompose: root judged compound -> Expansion emits 3 sub-step segments
	assert.equal(f('root').complexityClass, 'compound', 'root judged compound (LLM verdict on a distinct fact)');
	assert.ok(f('root').Expansion, 'root expanded (Compound -> Expansion)');
	assert.equal(f('root').expandedInto.length, 3, 'root tiled into 3 sub-steps');

	// the children are atomic leaves (depth floor), each answered
	const leaves = segs.filter(( id ) => f(id).Atomic);
	assert.equal(leaves.length, 3, 'three atomic leaves');
	for ( const id of leaves ) assert.ok(f(id).Answered && f(id).answer, id + ' answered');
	assert.ok(!f('root').Atomic, 'the compound root is NOT atomic');

	// reactive bottom-up synthesis: each child reported (G-Set), root rolled up once
	assert.equal(f('root').answeredBy.length, 3, 'all children reported (race-free {__push} fan-in)');
	assert.deepEqual([...f('root').answeredBy].sort(), [...f('root').expandedInto].sort(), 'answeredBy == children');
	assert.ok(f('root').Rollup && f('root').Answered, 'root rolled up IN stabilization (completion-gated)');
	assert.equal(f('root').answer, '{DONE[Book flights] + DONE[Arrange lodging] + DONE[Plan local transport]}', 'bounded fold of all leaves');

	// the Claim defeasance chain casts on the answered root
	assert.ok(f('root').Claim, 'Claim cast (an answered task is verifiable)');
	assert.equal(f('root').claimVerdict, 'pass', 'Verification wrote a SIBLING verdict (never overwrote the answer)');
	assert.ok(f('root').Verification && !f('root').Refuted, 'verified, not refuted — the defeasance gate held');
	assert.ok(f('root').Trusted, 'Trusted cast (confBand snapped high)');
	// the verdict is a sibling: the answer fact is intact alongside it
	assert.ok(typeof f('root').answer === 'string' && f('root').answer.length > 0, 'the answer survives verification (sibling fact)');
});
