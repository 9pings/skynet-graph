'use strict';
/**
 * dag-decompose — the model-driven TYPED DAG DECOMPOSE (lib/authoring/dag-decompose.js). Realizes the study
 * WIP/2026-07-08-etude-decoupage-de-tache.md §6.1 (the decompose PROMPT + grammar-constrained decoding → a typed
 * needs/produces DAG) that context-project/plan-loop execute. DETERMINISTIC: a stub grammar-capable `ask` is
 * injected, so the mapping + the K1 canon-snap + the plan-loop wiring are exercised without a model.
 *
 *   1 CONTRACT   — a stub DAG output maps to the plan-loop leaf contract (produces→request.id, needs→readsExtra).
 *   2 GRAMMAR    — the ask is called WITH a JSON-Schema grammar whose stepKind is the CLOSED enum (the K1 barrier).
 *   3 FAIL-CLOSED— an out-of-vocab stepKind rides kindMiss + the raw surface (never a minted false class).
 *   4 DEGRADE    — a malformed (non-JSON) backend reply degrades to ONE atomic leaf, never a crash.
 *   5 ROADMAP    — leavesToRoadmap yields produces/needs; an external readsExtra is dropped (context, not a gate).
 *   6 END-TO-END — decompose + plan-loop: the emitted DAG is served through the projection (projected, converged,
 *                  a consumer's context completed with its producer's value). NEG: an independent output → not projected.
 *   7 REFUSE     — a CYCLIC emitted DAG is a typed refusal at plan-loop (propose freely, validate hard, refuse cleanly).
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDagDecompose, leavesToRoadmap, keyOf } = require('../../lib/authoring/dag-decompose.js');
const { createPlanLoop } = require('../../lib/combos/plan-loop.js');

const KINDS = ['retrieve', 'compute', 'compare', 'summarize'];
// a stub grammar-capable ask that returns a FIXED JSON DAG and records the grammar it was handed.
function stubAsk( payload, sink ) {
	return async ( req ) => { if ( sink ) sink.grammar = req.grammar; return typeof payload === 'string' ? payload : JSON.stringify(payload); };
}
const CHAIN_DAG = [
	{ produces: 'glossary', stepKind: 'retrieve',  instruction: 'define the terms', needs: [] },
	{ produces: 'model',    stepKind: 'compute',   instruction: 'build the model from the glossary', needs: ['glossary'] },
	{ produces: 'report',   stepKind: 'summarize', instruction: 'summarize the model', needs: ['model'] },
];

test('1 CONTRACT — a DAG output maps to the plan-loop leaf contract', async () => {
	const decompose = makeDagDecompose({ ask: stubAsk(CHAIN_DAG), stepKinds: KINDS });
	const leaves = await decompose('build a doc');
	assert.equal(leaves.length, 3);
	assert.deepEqual(leaves.map(( l ) => l.request.id ), ['glossary', 'model', 'report'], 'produces → request.id (the write key)');
	assert.deepEqual(leaves.map(( l ) => l.request.kind ), ['retrieve', 'compute', 'summarize'], 'stepKind canon-snapped');
	assert.deepEqual(leaves[1].readsExtra, ['glossary'], 'needs → readsExtra');
	assert.deepEqual(leaves[2].readsExtra, ['model']);
	assert.deepEqual(leaves[0].readsExtra, [], 'a root has no readsExtra');
});

test('2 GRAMMAR — the ask is handed a JSON-Schema whose stepKind is the closed enum (the K1 barrier)', async () => {
	const sink = {};
	await makeDagDecompose({ ask: stubAsk(CHAIN_DAG, sink), stepKinds: KINDS })('t');
	assert.ok(sink.grammar && sink.grammar.jsonSchema, 'grammar-constrained decode requested');
	assert.deepEqual(sink.grammar.jsonSchema.items.properties.stepKind.enum, KINDS, 'stepKind constrained to the closed enum at decode');
});

test('3 FAIL-CLOSED — an out-of-vocab stepKind rides kindMiss + the raw surface', async () => {
	const decompose = makeDagDecompose({ ask: stubAsk([{ produces: 'x', stepKind: 'teleport', instruction: 'do', needs: [] }]), stepKinds: KINDS });
	const l = (await decompose('t'))[0];
	assert.equal(l.request.kind, null, 'no typed class minted for an out-of-vocab kind');
	assert.equal(l.request.kindMiss, true); assert.equal(l.request.kindRaw, 'teleport');
});

test('4 DEGRADE — a malformed backend reply degrades to one atomic leaf', async () => {
	const decompose = makeDagDecompose({ ask: stubAsk('sorry I cannot help with that'), stepKinds: KINDS });
	const leaves = await decompose('the whole task');
	assert.equal(leaves.length, 1); assert.deepEqual(leaves[0].readsExtra, []);
	assert.equal(leaves[0].nl, 'the whole task', 'the single leaf carries the whole task');
});

test('5 ROADMAP — leavesToRoadmap yields produces/needs; an external readsExtra is dropped', async () => {
	const leaves = await makeDagDecompose({ ask: stubAsk(CHAIN_DAG.concat([{ produces: 'extra', stepKind: 'compute', instruction: 'x', needs: ['nonexistent'] }])), stepKinds: KINDS })('t');
	const roadmap = leavesToRoadmap(leaves);
	const byId = Object.fromEntries(roadmap.map(( s ) => [s.id, s] ));
	assert.deepEqual(byId.model.needs, ['glossary'], 'intra-plan need kept');
	assert.deepEqual(byId.extra.needs, [], 'external readsExtra (no producer) dropped — context, not a gate');
});

test('6 END-TO-END — the emitted DAG is served through the projection (context completed)', async () => {
	const order = [], seen = {};
	const serveLeaf = async ( leaf ) => { order.push(leaf.request.id); seen[leaf.request.id] = Object.assign({}, leaf.inputs); return leaf.request.id + '<' + Object.keys(leaf.inputs || {}).join('+') + '>'; };
	const r = await createPlanLoop({ decompose: makeDagDecompose({ ask: stubAsk(CHAIN_DAG), stepKinds: KINDS }), serveLeaf }).run('build a doc');
	assert.equal(r.projected, true, 'the emitted DAG has real dependencies → the projection path was taken');
	assert.equal(r.converged, true); assert.equal(r.refusal, null);
	const pos = Object.fromEntries(order.map(( id, i ) => [id, i] ));
	assert.ok(pos.glossary < pos.model && pos.model < pos.report, 'served in emergent dependency order');
	assert.equal(seen.model.glossary, 'glossary<>', 'model was served WITH glossary\'s value completed (context projection)');
	// NEG: a fully independent decompose → the flat fast path (no projection)
	const flat = await createPlanLoop({ decompose: makeDagDecompose({ ask: stubAsk([{ produces: 'a', stepKind: 'compute', instruction: 'x', needs: [] }, { produces: 'b', stepKind: 'compute', instruction: 'y', needs: [] }]), stepKinds: KINDS }), serveLeaf: async ( l ) => l.request.id }).run('t');
	assert.equal(flat.projected, false, 'no intra-plan dependency → direct serve (no projection)');
});

test('7 REFUSE — a cyclic emitted DAG is a typed refusal at plan-loop', async () => {
	const cyclic = [{ produces: 'a', stepKind: 'compute', instruction: 'x', needs: ['b'] }, { produces: 'b', stepKind: 'compute', instruction: 'y', needs: ['a'] }];
	const r = await createPlanLoop({ decompose: makeDagDecompose({ ask: stubAsk(cyclic), stepKinds: KINDS }), serveLeaf: async ( l ) => l.request.id }).run('t');
	assert.equal(r.refusal, 'CYCLE', 'the model proposed a cycle → validated hard → refused cleanly (never a silent wedge)');
});

test('8 keyOf — produces keys are normalized to stable typed ids', () => {
	assert.equal(keyOf('Engine Model'), 'engine_model');
	assert.equal(keyOf('  API-surface!! '), 'api_surface');
	assert.equal(keyOf(''), 'part');
});
