'use strict';
/**
 * Reason-loop — the packaged `AI::*` provider set that drives `concepts/_substrate` end-to-end
 * (lib/providers/reason-loop.js). Unit-level: each provider fn is exercised with an INJECTED
 * mock `ask` (no network) and minimal graph/concept/scope stubs, asserting the EXACT markers
 * its concept gates on (the load-bearing part — they must match the `concepts/_substrate` gates,
 * mirroring the proven trip markers in tests/integration/poc-decompose.test.js).
 *
 * Hermetic: the "LLM" is an injected constant/dispatch reply; no engine boot.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { createReasonLoop } = require('../../lib/providers/reason-loop.js');

// drive one provider fn to its cb and resolve with the returned template.
function run( fn, { graph = {}, concept = {}, scope, argz = null } = {} ) {
	return new Promise(( res ) => fn(graph, concept, scope, argz, ( _e, tpl ) => res(tpl)));
}

test('createReasonLoop without an ask throws (ask is REQUIRED)', () => {
	assert.throws(() => createReasonLoop({}), /ask/);
	assert.throws(() => createReasonLoop(), /ask/);
});

// ── seedTask (the Intake→Task bridge) ───────────────────────────────────────────────────────
test('seedTask: seeds a root Task segment carrying the question, with NO rawText (no re-intake)', async () => {
	const { AI } = createReasonLoop({ ask: async () => 'x' });
	const tpl = await run(AI.seedTask, { scope: { _: { _id: 't', rawText: 'do X' } } });
	assert.ok(Array.isArray(tpl), 'seedTask returns an array template');

	const parent = tpl.find(( t ) => t.$_id === '_parent');
	assert.ok(parent && parent.ToTask === true, '_parent self-flags ToTask (provider-cast-marker gotcha)');

	const start = tpl.find(( t ) => t._id === 't_start');
	const goal  = tpl.find(( t ) => t._id === 't_goal');
	assert.ok(start && start.Node === true, 't_start is a fresh Node');
	assert.ok(goal && goal.Node === true, 't_goal is a fresh Node');

	const task = tpl.find(( t ) => t._id === 't_task');
	assert.ok(task && task.Segment === true, 't_task is a Segment');
	assert.equal(task.originNode, 't_start');
	assert.equal(task.targetNode, 't_goal');
	assert.equal(task.depth, 0);
	assert.equal(task.label, 'do X', 'label carries the question');
	assert.equal('rawText' in task, false, 'the seeded task carries NO rawText (it would re-trigger Intake — a runaway)');
});

// ── evalComplexity ──────────────────────────────────────────────────────────────────────────
test('evalComplexity: depth floor — at maxDepth returns atomic WITHOUT calling ask', async () => {
	let called = 0;
	const { AI } = createReasonLoop({ ask: async () => { called++; return '{}'; }, maxDepth: 1 });
	const tpl = await run(AI.evalComplexity, { scope: { _: { _id: 't', label: 'x', depth: 1 } } });
	assert.equal(tpl.EvalComplexity, true);
	assert.equal(tpl.complexityClass, 'atomic');
	assert.equal(called, 0, 'the depth floor short-circuits — no model call');
});

test('evalComplexity: a snappable class is canon-snapped (compound)', async () => {
	const { AI } = createReasonLoop({ ask: async () => '{"complexityClass":"compound"}', maxDepth: 3 });
	const tpl = await run(AI.evalComplexity, { scope: { _: { _id: 't', label: 'x', depth: 0 } } });
	assert.equal(tpl.EvalComplexity, true);
	assert.equal(tpl.complexityClass, 'compound');
	assert.ok(!tpl.strategiesExhausted, 'a clean snap is not exhausted');
});

test('evalComplexity: an un-snappable class → strategiesExhausted, NO complexityClass', async () => {
	const oob = createReasonLoop({ ask: async () => '{"complexityClass":"weird"}', maxDepth: 3 });
	const t1 = await run(oob.AI.evalComplexity, { scope: { _: { _id: 't', label: 'x', depth: 0 } } });
	assert.equal(t1.EvalComplexity, true);
	assert.equal(t1.strategiesExhausted, true);
	assert.equal(t1.complexityClass, undefined, 'no class when the reply cannot be snapped to the enum');

	// a non-JSON reply reaches the same exhausted state (via the catch path)
	const garbage = createReasonLoop({ ask: async () => 'not json at all', maxDepth: 3 });
	const t2 = await run(garbage.AI.evalComplexity, { scope: { _: { _id: 't', label: 'x', depth: 0 } } });
	assert.equal(t2.EvalComplexity, true);
	assert.equal(t2.strategiesExhausted, true);
	assert.equal(t2.complexityClass, undefined);
});

// ── expand (the AND hyper-edge) ─────────────────────────────────────────────────────────────
test('expand: steps → _parent Expansion + expandedInto + child segments (parentSeg, +1 depth)', async () => {
	const { AI } = createReasonLoop({ ask: async () => '{"steps":["a","b"]}' });
	const scope = { _: { _id: 't', label: 'x', originNode: 'o', targetNode: 'g', depth: 0 } };
	const tpl = await run(AI.expand, { scope });

	const parent = tpl.find(( t ) => t.$_id === '_parent');
	assert.equal(parent.Expansion, true);
	assert.deepEqual(parent.expandedInto, ['t_s0', 't_s1'], 'two child ids, derived from the base id');

	const segs = tpl.filter(( t ) => t.Segment === true);
	assert.equal(segs.length, 2, 'two child Segments');
	for ( const s of segs ) {
		assert.equal(s.parentSeg, 't', 'each child carries parentSeg = the base id (stigmergic fan-in target)');
		assert.equal(s.depth, 1, 'child depth = parent depth + 1');
	}
	assert.equal(segs[0].label, 'a');
	assert.equal(segs[1].label, 'b');
	assert.equal('rawText' in segs[0], false, 'children carry label only (no rawText → no re-intake)');
});

test('expand: no steps → Expansion + strategiesExhausted (no children)', async () => {
	const { AI } = createReasonLoop({ ask: async () => '{"steps":[]}' });
	const scope = { _: { _id: 't', label: 'x', originNode: 'o', targetNode: 'g', depth: 0 } };
	const tpl = await run(AI.expand, { scope });
	assert.equal(tpl.Expansion, true);
	assert.equal(tpl.strategiesExhausted, true);
	assert.equal(tpl.expandedInto, undefined, 'no children when nothing could be decomposed');
});

// ── answer (Answered is the concept applyMutations, NOT the provider) ────────────────────────
test('answer: plain text → Answer + answer; the provider does NOT set Answered', async () => {
	const { AI } = createReasonLoop({ ask: async () => '  the answer text  ' });
	const tpl = await run(AI.answer, { scope: { _: { _id: 't', label: 'x' } } });
	assert.equal(tpl.$_id, '_parent');
	assert.equal(tpl.Answer, true);
	assert.equal(tpl.answer, 'the answer text', 'the prose is trimmed');
	assert.equal(tpl.Answered, undefined, 'Answered is set by the concept applyMutations, not the provider');
});

// ── reportUp (race-free stigmergic fan-in, no LLM) ──────────────────────────────────────────
test('reportUp: pushes self-id into parentSeg.answeredBy and self-flags ReportUp', async () => {
	const { AI } = createReasonLoop({ ask: async () => 'x' });
	const tpl = await run(AI.reportUp, { scope: { _: { _id: 't_s0', parentSeg: 't' } } });
	assert.ok(Array.isArray(tpl));

	const push = tpl.find(( t ) => t.$$_id === 't');
	assert.ok(push, 'targets the parent segment by LITERAL id ($$_id)');
	assert.deepEqual(push.answeredBy, { __push: 't_s0' }, 'race-free {__push} fan-in of the self id');

	const parent = tpl.find(( t ) => t.$_id === '_parent');
	assert.equal(parent.ReportUp, true);
});

// ── rollup (bounded bottom-up synthesis) ────────────────────────────────────────────────────
test('rollup: gathers child answers via graph.getEtty and synthesizes → Rollup + answer', async () => {
	const answers = { k1: 'A1', k2: 'A2' };
	const graph = { getEtty: ( id ) => ({ _: { answer: answers[id] } }) };
	const { AI } = createReasonLoop({ ask: async () => 'SYNTH' });
	const scope = { _: { _id: 't', label: 'x', expandedInto: ['k1', 'k2'] } };
	const tpl = await run(AI.rollup, { graph, scope });
	assert.equal(tpl.$_id, '_parent');
	assert.equal(tpl.Rollup, true);
	assert.equal(tpl.answer, 'SYNTH');
});

// ── confidence (a SNAPPED band, fail-closed) ────────────────────────────────────────────────
test('confidence: a snappable band → Confidence + confBand', async () => {
	const { AI } = createReasonLoop({ ask: async () => '{"confBand":"high"}' });
	const tpl = await run(AI.confidence, { scope: { _: { _id: 't', label: 'x', answer: 'a' } } });
	assert.equal(tpl.Confidence, true);
	assert.equal(tpl.confBand, 'high');
});

test('confidence: an out-of-band reply fails CLOSED to low', async () => {
	const { AI } = createReasonLoop({ ask: async () => '{"confBand":"weird"}' });
	const tpl = await run(AI.confidence, { scope: { _: { _id: 't', label: 'x', answer: 'a' } } });
	assert.equal(tpl.Confidence, true);
	assert.equal(tpl.confBand, 'low', 'OOB snaps to low (fail-closed), never a wrong band');
});
