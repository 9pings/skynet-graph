'use strict';
/**
 * §6.1 compete provider — the DOMINANCE GATE at the provider level (the mechanism behind the crystallise neg-controls).
 * Confirms the two refusal mechanisms are DISTINCT (so the integration neg-controls are not vacuous):
 *   • clean Pareto dominance (front.length===1) → a MULTI-OBJECT structural patch (minable → crystallisable);
 *   • a Pareto TIE (front.length>1)            → a FLAT head marker only (the miner skips it → the tie-gate);
 *   • the FLIP inputs both emit STRUCTURE (each a clean dominance) but a DIFFERENT winner → so the crystallise
 *     refusal there is `signatureDetermined` (two templates / one signature), NOT the flat-skip.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeCompeteProvider } = require('../../lib/authoring/compete.js');

const CRITERIA = { cost: { dir: 'min' } };
function decompFor( s ) { return ( base, o, t ) => [{ _id: base + '_w', Node: true, strategy: s }, { _id: base + '_c0', Segment: true, originNode: o, targetNode: base + '_w', parentSeg: base }]; }
const cands = ( costs ) => ['quick', 'refactor', 'rewrite'].map(( s ) => ({ id: s, cost: costs[s], decomp: decompFor(s) }));
const scopeFor = ( costs ) => ({ _: { _id: 'B1', originNode: 'X', targetNode: 'Y', taskClass: 'fast', __costs: costs } });
function run( costs ) {
	const { Compete } = makeCompeteProvider({ propose: ( s ) => cands(s._.__costs), criteria: CRITERIA, discriminantKey: 'taskClass' });
	return new Promise(( res ) => Compete.compete({}, { _name: 'Compete' }, scopeFor(costs), [], ( e, t ) => res(t)));
}

test('clean dominance → a MULTI-OBJECT structural patch (the winner decomposition), frontSize 1', async () => {
	const patch = await run({ quick: 1, refactor: 3, rewrite: 5 });            // quick strictly dominates
	assert.ok(Array.isArray(patch) && patch.length > 1, 'a multi-object patch (minable), not a flat marker');
	assert.equal(patch[0].$_id, '_parent');
	assert.equal(patch[0].Compete, true, 'cast marker set (provider-cast gotcha)');
	assert.equal(patch[0].Competed, true, 'distinct durable re-fire guard set');
	assert.equal(patch[0].frontSize, 1, 'a clean Pareto dominator → frontSize 1');
	const win = patch.filter(( o ) => o.strategy)[0];
	assert.equal(win.strategy, 'quick', 'the dominating strategy is the emitted decomposition');
});

test('NEG — a Pareto TIE → a FLAT head marker only (the miner skips it: the tie-gate)', async () => {
	const patch = await run({ quick: 1, refactor: 3, rewrite: 1 });            // quick & rewrite tie (both 1)
	assert.ok(!Array.isArray(patch), 'a flat length-1 fact patch (skipped by the structural miner)');
	assert.equal(patch.Competed, true, 'still casts (bounded, no divergence)');
	assert.equal(patch.frontSize, 2, 'the Pareto front has 2 non-dominated candidates → a tie, no clean winner');
	assert.equal(patch.strategy, undefined, 'no winner decomposition emitted on a tie');
});

test('the FLIP inputs each emit STRUCTURE (clean dominance) but a DIFFERENT winner → crystallise refusal is determinacy, not flat-skip', async () => {
	const e1 = await run({ quick: 1, refactor: 3, rewrite: 5 });               // quick wins
	const e2 = await run({ quick: 5, refactor: 3, rewrite: 1 });               // rewrite wins
	assert.ok(Array.isArray(e1) && Array.isArray(e2), 'BOTH flip instances emit a minable structural patch (each a clean dominance)');
	assert.equal(e1.filter(( o ) => o.strategy)[0].strategy, 'quick');
	assert.equal(e2.filter(( o ) => o.strategy)[0].strategy, 'rewrite');
	assert.notEqual(e1.filter(( o ) => o.strategy)[0].strategy, e2.filter(( o ) => o.strategy)[0].strategy,
		'same premise, two winner templates → it is `signatureDetermined` (K1) that refuses, not the flat-skip');
});
