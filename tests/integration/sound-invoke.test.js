'use strict';
/**
 * sound-invoke (roadmap P4) — the CONSTAT operationalized on the real runtime. End-to-end: a caller extracts a
 * frozen-frontier slice, INVOKES it on a worker (P1, bounded return), then admits the result through
 * `soundInvokeMerge` (P4) = assertPost (G1 frame via the P1 write-footprint · post-holds · G2 oracle) → mergeSlice
 * (assumption-recheck + single-writer) → sequenced commit. A violation REFUSES; a clean admit posts JTMS-visible facts.
 * ZERO-CORE (host-side over the P1 wire + contract.js + extract.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { extractSubgraph } = require('../../lib/authoring/extract.js');
const { soundInvokeMerge } = require('../../lib/authoring/sound-invoke.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

const METHOD_TREE = { common: { childConcepts: {                     // the method body — runs on the worker
	Hot: { _id: 'Hot', _name: 'Hot', require: ['Segment'], ensure: ['$originNode:temp >= 100'] },
} } };
const CALLER_TREE = { common: { childConcepts: {                     // the caller — a downstream that consumes the posted output
	Alert: { _id: 'Alert', _name: 'Alert', require: ['Segment'], ensure: ['$Hot == true'] },
} } };
const CONF = ( l ) => ({ label: l, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' });
const seed = ( temp ) => ({ lastRev: 0,
	nodes: [ { _id: 'IN', Node: true, temp: temp }, { _id: 'OUT', Node: true } ],
	segments: [ { _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' } ] });
const factsOf = ( g, id ) => { const o = g._objById[id]; return (o && o._etty && o._etty._) || {}; };

// caller-side: build the graph, extract the method slice, invoke it on a worker, return { caller, ex, result }.
async function callerInvoke( temp ) {
	const caller = new Graph(seed(temp), CONF('caller'), CALLER_TREE);
	await nextStable(caller);
	const ex = extractSubgraph(caller, 'OUT');                       // interior {OUT, s}, frozen frontier {IN}
	const result = await Graph.invokeGraph({ conceptMap: METHOD_TREE, seed: ex.seed, boundedFrom: 's', boundedKeys: ['Hot'] });
	return { caller, ex, result };
}
const CONTRACT = { read: ['temp'], write: ['Hot'], post: ['$Hot == true'], effect: 'internal' };

test('SOUND admit — contract holds, frame-complete, no drift → merged + JTMS-visible (downstream casts)', async () => {
	const { caller, ex, result } = await callerInvoke(120);
	assert.deepEqual(result.summary, { Hot: true }); assert.deepEqual(result.writeFootprint, ['Hot']);
	const r = soundInvokeMerge(caller, result, ex, { contract: CONTRACT, targetId: 's' });
	assert.equal(r.merged, true, 'a sound result admits');
	await nextStable(caller);
	assert.equal(factsOf(caller, 's').Hot, true, 'the bounded summary is committed onto the caller');
	assert.equal(factsOf(caller, 's').Alert, true, 'and it is JTMS-visible — the caller downstream cast on it');
});

test('POST-VIOLATION — the contract LIES about the result → REFUSED + blame (never committed)', async () => {
	const { caller, ex, result } = await callerInvoke(120);                       // returns Hot:true
	const lying = { read: ['temp'], write: ['Hot'], post: ['$Hot == false'], effect: 'internal' };
	const r = soundInvokeMerge(caller, result, ex, { contract: lying, targetId: 's' });
	assert.equal(r.merged, false); assert.match(r.reason, /post-violation.*post-violated/);
	assert.ok(r.blame && r.blame.by === 'post', 'blame is reported (feeds reviseOnBlame / CEGIS)');
	await nextStable(caller);
	assert.notEqual(factsOf(caller, 's').Hot, true, 'a lying result is NOT committed');
});

test('FRAME violation (G1) — an UNDER-DECLARED write is caught via the P1 write-footprint → REFUSED', async () => {
	const { caller, ex, result } = await callerInvoke(120);                       // footprint ['Hot']
	const underDeclared = { read: ['temp'], write: [], post: ['$Hot == true'], effect: 'internal' };
	const r = soundInvokeMerge(caller, result, ex, { contract: underDeclared, targetId: 's' });
	assert.equal(r.merged, false); assert.match(r.reason, /undeclared-write\(Hot\)/, 'the silent frame hole is the one G1 closes');
});

test('FRONTIER DRIFT — the input premise drifts before admit → the assumption-recheck REFUSES', async () => {
	const { caller, ex, result } = await callerInvoke(120);
	caller.pushMutation([{ $$_id: 'IN', temp: 50 }]); await nextStable(caller);    // the premise the body assumed drifts
	const r = soundInvokeMerge(caller, result, ex, { contract: CONTRACT, targetId: 's' });
	assert.equal(r.merged, false); assert.match(r.reason, /frontier drift/i, 'the dead-premise result is not committed');
	assert.notEqual(factsOf(caller, 's').Hot, true);
});

test('EFFECTING (G2) — an external post needs a ground-truth ORACLE: refused without, admitted with', async () => {
	const eff = { read: ['temp'], write: ['Hot'], post: ['$Hot == true'], effect: 'external' };
	const a = await callerInvoke(120);
	const noOracle = soundInvokeMerge(a.caller, a.result, a.ex, { contract: eff, targetId: 's' });
	assert.equal(noOracle.merged, false); assert.match(noOracle.reason, /effecting-post-unverified|oracle/i);
	const b = await callerInvoke(120);
	const withOracle = soundInvokeMerge(b.caller, b.result, b.ex, { contract: eff, targetId: 's', oracle: () => true });
	assert.equal(withOracle.merged, true, 'a confirmed effecting post admits');
});

test('ONGOING soundness — after a clean admit, a LATER premise drift retracts the posted fact (JTMS)', async () => {
	const { caller, ex, result } = await callerInvoke(120);
	soundInvokeMerge(caller, result, ex, { contract: CONTRACT, targetId: 's' });
	await nextStable(caller);
	assert.equal(factsOf(caller, 's').Alert, true, 'admitted + downstream cast');
	caller.pushMutation([{ $$_id: 's', Hot: false }]); await nextStable(caller);    // the posted premise is retracted
	assert.notEqual(factsOf(caller, 's').Alert, true, 'the posted summaryFact is re-evaluable → the cascade retracts (KG-PROXY C)');
});
