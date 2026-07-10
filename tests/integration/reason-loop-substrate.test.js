'use strict';
/**
 * Combos P1.a — the packaged `AI::*` reason-loop + the `Intake::type` front door drive the REAL
 * `concepts/_substrate` grammar end-to-end (no LLM: a canned mock-ask dispatches on the system
 * prompt). Two cases, mirroring the proven smoke scripts:
 *
 *  1. ANSWER path  — a typed question crosses Intake, `Intake/ToTask.json` bridges it into a root
 *     Task Segment, the loop decomposes → answers the leaves → rolls up → casts the Claim/Trusted
 *     chain (the same shape as tests/integration/poc-decompose.test.js, but LLM-driven).
 *  2. REFUSAL path — an out-of-vocab intake stays `untyped`, names the required miss on
 *     `IntakeMissing`, ToTask does NOT cast, and NO task is ever seeded (a visible typed refusal).
 *
 * Boot pattern mirrors tests/integration/poc-decompose.test.js (buildConceptTree + new Graph with
 * conceptSets:['_substrate'] + an onStabilize settle gate).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Graph = require('../_boot.js');                                    // sets __SERVER__, returns Graph
const { buildConceptTree } = require('../../lib/authoring/concepts');
const { createReasonLoop } = require('../../lib/providers/reason-loop.js');
const { createIntake } = require('../../lib/providers/intake.js');

const SUBSTRATE = path.join(__dirname, '..', '..', 'concepts', '_substrate');

// boot the _substrate grammar on `seed`, wired with the reason-loop + intake providers driven by
// `mockAsk`. Resolves once `readyWhen(g)` holds (a stabilize gate), rejects on timeout.
function boot( { mockAsk, seed, readyWhen, label } ) {
	Graph._providers = Object.assign({},
		createReasonLoop({ ask: mockAsk, maxDepth: 1 }),
		createIntake({ ask: mockAsk }));
	const tree = buildConceptTree(SUBSTRATE);
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error(label + ' timed out')), 20000);
		let done = false;
		const g = new Graph(seed, {
			label, isMaster: true, autoMount: true, conceptSets: ['_substrate'], bagRefManagers: {}, logLevel: 'error',
			onStabilize() {
				if ( done || !readyWhen(g) ) return;
				done = true; clearTimeout(timer); resolve(g);
			}
		}, { _substrate: tree });
	});
}

// the ANSWER-path mock: dispatches on the concept's system prompt (from scratchpad/smoke2.js).
async function answerAsk( { system } ) {
	const s = String(system || '');
	if ( /inbound message kind/i.test(s) ) return '{"kind":"question","prose":"restated"}';
	if ( /complexityClass/.test(s) )        return '{"complexityClass":"compound"}';
	if ( /"steps"/.test(s) )                return '{"steps":["find country","recall capital"]}';
	if ( /confBand/.test(s) )               return '{"confBand":"high"}';
	if ( /Synthesize/i.test(s) )            return 'SYNTHESIS';
	return 'ANSWER';
}

// the REFUSAL-path mock: an out-of-vocab `kind` → required miss → untyped (from scratchpad/smoke-refuse.js).
async function refuseAsk( { system } ) {
	if ( /inbound message kind/i.test(String(system)) ) return '{"kind":"gibberish","prose":"x"}';
	return 'ANSWER';
}

test('ANSWER path: intake → ToTask bridge → decompose → answer leaves → rollup → Claim/Trusted chain', async () => {
	const g = await boot({
		label   : 'reason-answer',
		mockAsk : answerAsk,
		seed    : { lastRev: 0, nodes: [{ _id: 'q', rawText: 'What is the capital of France?' }], segments: [] },
		// settle when the compound task reached the terminal Trusted state (its whole sub-tree is done by then).
		readyWhen: ( g ) => g._objById['q_task'] && g._objById['q_task']._etty._.Trusted
	});
	const f = ( id ) => g._objById[id]._etty._;

	// intake: the prose node crossed the front door and the bridge cast.
	assert.equal(f('q').IntakeStatus, 'typed', 'the question is a clean, typed intake');
	assert.ok(f('q').Intake, 'Intake cast');
	assert.ok(f('q').ToTask, 'the Intake→Task bridge cast on the typed intake');

	// the root Task Segment was seeded and judged compound.
	assert.ok(g._objById['q_task'], 'q_task was seeded by AI::seedTask');
	assert.ok(f('q_task').Task && f('q_task').Segment, 'q_task is a Task Segment');
	assert.equal(f('q_task').complexityClass, 'compound', 'the LLM verdict, snapped to the enum');
	assert.ok(f('q_task').Expansion, 'a compound task expands');
	assert.equal(f('q_task').expandedInto.length, 2, 'tiled into 2 sub-steps (the mock returned 2 steps)');

	// the leaves answered.
	const leaves = f('q_task').expandedInto;
	assert.equal(leaves.length, 2);
	for ( const id of leaves ) {
		assert.ok(g._objById[id], id + ' exists');
		assert.ok(f(id).Answer && f(id).Answered, id + ' is answered');
		assert.ok(f(id).answer != null && String(f(id).answer).length > 0, id + ' carries a non-null answer');
	}

	// the compound rolled up (bottom-up synthesis, completion-gated).
	assert.ok(f('q_task').Rollup && f('q_task').Answered, 'q_task rolled up in stabilization');
	assert.ok(f('q_task').answer != null && String(f('q_task').answer).length > 0, 'q_task carries the synthesized answer');
	assert.equal(f('q_task').answeredBy.length, 2, 'both children reported (race-free {__push} fan-in)');

	// the Claim defeasance chain casts and reaches Trusted (confBand high).
	assert.ok(f('q_task').Claim, 'Claim cast (an answered task is verifiable)');
	assert.ok(f('q_task').Verification && !f('q_task').Refuted, 'verified, not refuted — the defeasance gate held');
	assert.equal(f('q_task').confBand, 'high', 'confidence snapped to the high band');
	assert.ok(f('q_task').Trusted, 'Trusted cast (confBand high)');
});

test('REFUSAL path: an out-of-vocab intake stays untyped, names the miss, seeds no task', async () => {
	const g = await boot({
		label   : 'reason-refuse',
		mockAsk : refuseAsk,
		seed    : { lastRev: 0, nodes: [{ _id: 'q', rawText: 'zzz?' }], segments: [] },
		// settle once the intake ran (IntakeStatus written); nothing downstream can fire on an untyped intake.
		readyWhen: ( g ) => g._objById['q']._etty._.IntakeStatus != null
	});
	const f = g._objById['q']._etty._;

	assert.equal(f.IntakeStatus, 'untyped', 'a required out-of-vocab key makes the intake untyped');
	assert.ok(Array.isArray(f.IntakeMissing) && f.IntakeMissing.indexOf('kind') !== -1,
		'IntakeMissing names the decision-bearing required miss (kind)');
	assert.ok(!f.ToTask, 'the bridge does NOT cast on an untyped intake');
	assert.equal(g._objById['q_task'], undefined, 'no task is seeded — a visible typed refusal, not a silent seed');
});
