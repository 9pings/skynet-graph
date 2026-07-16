'use strict';
/**
 * debug-provider — the structural debugging provider for the distillation kill-gate (B-thin).
 * Verifies it emits a MULTI-OBJECT decomposition patch whose typed content (fixKind/role) is a
 * FUNCTION of the typed bugClass (so the cast is signature-determined → crystallizable), with the
 * free text on an UNTRACKED prose key. Deterministic (injected ask), no LLM.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDebugProvider } = require('../../plugins/learning/lib/debug-provider.js');

// deterministic classify table: bugClass determines fixKind (the K1 signature → content function)
const FIX = { 'off-by-one': 'adjust-bound', 'null-deref': 'guard-null', 'wrong-branch': 'fix-cond' };
const stubAsk = async () => JSON.stringify({ bugClass: 'off-by-one', hypothesis: 'loop overruns', fix: 'use < not <=' });
const classify = ( raw ) => ({ bugClass: raw.bugClass, fixKind: FIX[raw.bugClass] || 'unknown' });

function scopeFor( id, origin, target ) {
	return { _: { _id: id, originNode: origin, targetNode: target, Bug: true, failingTest: 't1' } };
}

test('debugStep emits a MULTI-OBJECT decomposition patch with typed facts determined by bugClass', async () => {
	const { AI } = makeDebugProvider({ ask: stubAsk, parseJSON: JSON.parse, classify });
	const patch = await new Promise(( res ) => AI.debugStep({}, { _name: 'DebugStep' }, scopeFor('B1', 'X', 'Y'), [], ( e, t ) => res(t)));
	assert.ok(Array.isArray(patch) && patch.length > 1, 'multi-object patch (not a flat length-1 fact patch)');
	const head = patch[0];
	assert.equal(head.$_id, '_parent');
	assert.equal(head.DebugStep, true, 'cast marker set (provider-cast gotcha)');
	assert.equal(head.Decomposed, true, 'distinct durable re-fire guard set');
	assert.equal(head.bugClass, 'off-by-one', 'bugClass snapped to the typed fact');
	assert.equal(head.fixKind, 'adjust-bound', 'fixKind is a FUNCTION of bugClass (signature-determined content)');
	const nodes = patch.filter(( o ) => o.Node), segs = patch.filter(( o ) => o.Segment);
	assert.equal(nodes.length, 2, 'hypothesis + localize intermediate nodes');
	assert.equal(segs.length, 3, 'three child segments chaining origin -> h -> l -> target');
	assert.equal(segs[0].originNode, 'X');
	assert.equal(segs[2].targetNode, 'Y', 'frontier endpoints wired');
	assert.equal(typeof head.debugProse, 'string', 'free text on the UNTRACKED prose key');
});

test('debugStep: a DIFFERENT bugClass yields a DIFFERENT typed fixKind (content tracks the signature)', async () => {
	const askNull = async () => JSON.stringify({ bugClass: 'null-deref', hypothesis: 'deref before check', fix: 'guard' });
	const { AI } = makeDebugProvider({ ask: askNull, parseJSON: JSON.parse, classify });
	const patch = await new Promise(( res ) => AI.debugStep({}, { _name: 'DebugStep' }, scopeFor('B2', 'P', 'Q'), [], ( e, t ) => res(t)));
	assert.equal(patch[0].bugClass, 'null-deref');
	assert.equal(patch[0].fixKind, 'guard-null', 'fixKind = f(bugClass)');
	assert.equal(patch.find(( o ) => o.Node && o.role === 'hypothesis').fixKind, 'guard-null', 'the hypothesis node carries the typed fixKind');
});

test('debugStep: an out-of-vocab bugClass is dropped by the canon barrier (not written as a raw fact)', async () => {
	const askWeird = async () => JSON.stringify({ bugClass: 'cosmic-ray', hypothesis: 'x', fix: 'y' });
	const classifyPass = ( raw ) => ({ bugClass: raw.bugClass, fixKind: 'adjust-bound' });
	const { AI } = makeDebugProvider({ ask: askWeird, parseJSON: JSON.parse, classify: classifyPass });
	const patch = await new Promise(( res ) => AI.debugStep({}, { _name: 'DebugStep' }, scopeFor('B3', 'P', 'Q'), [], ( e, t ) => res(t)));
	assert.notEqual(patch[0].bugClass, 'cosmic-ray', 'out-of-vocab is NOT written verbatim as a tracked fact (canon barrier)');
});
