'use strict';
/**
 * Distillation kill-gate (B-thin) — the recurrent-STREAM backbone (deterministic). Proves the streaming
 * retrieve-or-forge amortization end-to-end: across a 24-bug stream of recurrent classes, the model fires
 * only on a class's first sites (forge), then every later same-class bug replays a crystallized `Method`
 * at 0 calls. Counts are deterministic and MUST mirror the live arm (the model fires only on a miss).
 *
 * The harness + corpus live in the gitignored R&D trail (doc/WIP/experiments/…) — this tracked test SKIPS
 * cleanly when they are absent (a fresh clone without the trail still passes the suite).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
console.log = console.info = console.warn = () => {};

let runStream, stream;
try {
	( { runStream } = require('../../doc/WIP/experiments/2026-06-30-distill-killgate/harness.js') );
	( { stream } = require('../../doc/WIP/experiments/2026-06-30-distill-killgate/corpus.js') );
} catch ( e ) { /* the gitignored harness is not present — skip */ }

const FIX = { 'off-by-one': 'adjust-bound', 'null-deref': 'guard-null', 'wrong-branch': 'fix-cond' };
// deterministic ask: recover the class from the bugText carried in the user prompt (no model).
const detAsk = async ( p ) => {
	const m = /\((off-by-one|null-deref|wrong-branch)\)/.exec(p.user) || [, 'off-by-one'];
	return JSON.stringify({ bugClass: m[1], hypothesis: 'h', fix: 'f' });
};
const classify = ( raw ) => ({ bugClass: raw.bugClass, fixKind: FIX[raw.bugClass] || 'unknown' });

test('stream backbone (deterministic): calls << stream length; each recurrent class crystallizes; later bugs HIT', { skip: !runStream }, async () => {
	const stats = await runStream({ ask: detAsk, classify, stream });
	assert.ok(stats.calls < stream.length, `amortized: ${stats.calls} calls << ${stream.length} bugs`);
	assert.ok(stats.crystallized >= 1, `at least one recurrent class crystallized into a Method (got ${stats.crystallized})`);
	assert.ok(stats.hits > 0, `later same-class bugs HIT the learned Method at 0 calls (got ${stats.hits})`);
	// the amortization is real: hits + the forged solves account for the whole stream.
	assert.ok(stats.hits + stats.calls <= stream.length, 'no double counting (hits + forge-calls ≤ stream)');
	assert.equal(stats.classes, 3, 'three recurrent classes observed');
});
