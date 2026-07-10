/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * negotiate — the BOUNDED LLM↔GRAPH DIALOGUE (owner 2026-07-09: "a thinking mode for a model that doesn't think").
 * The model PROPOSES; the graph GATES (assertPost); on a mismatch the graph pushes back with the BLAME (why) + the
 * ADMISSIBLE OPTIONS (the domain values that PASS its own gate — enumerated, not guessed) → serialized as a revision
 * prompt (the §5b LEVER) → the model REVISES → repeat, BOUNDED to K rounds. The invariants:
 *   • 0-FALSE at the dialogue level — a non-gated answer is NEVER returned (converge on a gated one, or refuse).
 *   • HONEST REFUSAL — when NO admissible option exists, the graph refuses (it never FORCES/hallucinates a match).
 *   • TERMINATION — bounded rounds (no oscillation), like the apply-cap/G3 at the dialogue level.
 * = externalized, grounded chain-of-thought: the reasoning lives in the graph's structure, not the model's weights.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeNegotiate, gateFromContract, admissibleOptions } = require('../../lib/authoring/negotiate.js');
console.log = console.info = console.warn = () => {};

const DOMAIN = ['low', 'mid', 'high'];
const bandGate = ( post ) => gateFromContract({ write: ['band'], post: post, effect: 'pure' });

// a cooperative stub "model": round 0 it HALLUCINATES 'high'; once the graph hands it options, it PICKS the first one.
const cooperative = () => async ( input, { options } ) => ({ summary: { band: (options && options.length) ? options[0] : 'high' }, footprint: ['band'] });
// a stubborn hallucinator: ALWAYS 'high', ignores the graph's feedback.
const stubborn = async () => ({ summary: { band: 'high' }, footprint: ['band'] });

test('CONVERGE — model hallucinates, graph refutes + offers options, model revises to a gated MATCH', async () => {
	const gate = bandGate(['band != "high"']);                                   // the "established" constraint: NOT high
	const solve = makeNegotiate({ propose: cooperative(), gate, optionsOf: ( g, c ) => admissibleOptions(gate, 'band', DOMAIN)(c), maxRounds: 4 });
	const r = await solve('classify the band');
	assert.equal(r.ok, true, 'converged');
	assert.equal(r.answer.summary.band, 'low', 'landed on an admissible option (the graph offered [low,mid], model took the first)');
	assert.equal(r.rounds, 2, 'round 0 = high (refused), round 1 = low (gated) — 2 LLM turns');
	assert.equal(r.trace[0].ok, false, 'the hallucination was refused, not admitted');
});

test('HONEST REFUSAL — when NO option matches, the graph refuses; it never forces/hallucinates a match', async () => {
	const gate = bandGate(['band != "high"', 'band != "low"', 'band != "mid"']);  // over-constrained: nothing admissible
	const solve = makeNegotiate({ propose: cooperative(), gate, optionsOf: ( g, c ) => admissibleOptions(gate, 'band', DOMAIN)(c), maxRounds: 4 });
	const r = await solve('...');
	assert.equal(r.ok, false);
	assert.equal(r.refusal, 'no-admissible-option', 'the graph honestly says nothing fits (the "t\'es sûr c\'est pas une halu?" with no match)');
});

test('BOUNDED — a stubborn hallucinator NEVER gets its wrong answer accepted (0-false + termination)', async () => {
	const gate = bandGate(['band != "high"']);
	const solve = makeNegotiate({ propose: stubborn, gate, optionsOf: ( g, c ) => admissibleOptions(gate, 'band', DOMAIN)(c), maxRounds: 3 });
	const r = await solve('...');
	assert.equal(r.ok, false);
	assert.equal(r.refusal, 'max-rounds', 'bounded → terminates, never loops forever');
	assert.ok(r.trace.every(( t ) => t.ok === false ), 'the wrong answer "high" was NEVER admitted (0-false at the dialogue level)');
	assert.equal(r.trace.length, 3, 'exactly K rounds');
});

test('admissibleOptions — the graph enumerates options by TESTING each against its OWN gate (grounded, not guessed)', () => {
	const gate = bandGate(['band != "high"']);
	const opts = admissibleOptions(gate, 'band', DOMAIN)({ summary: { band: 'high' }, footprint: ['band'] });
	assert.deepEqual(opts, ['low', 'mid'], 'the graph returns exactly the domain values its gate admits');
});
