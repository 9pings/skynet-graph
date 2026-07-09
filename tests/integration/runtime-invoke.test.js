'use strict';
/**
 * Runtime BOUNDED INVOKE (roadmap P1) — the cross-instance invoke that crosses back ONLY the declared frontier
 * alphabet Σ_sep, not the whole snapshot. The KG-PROXY kill-gate (WIP/experiments/2026-07-09-kg-proxy) proved the
 * constat holds host-side by composing extract+spawnGraph+mergeSlice; P1 promotes the bounded return INTO the runtime
 * (`invoke`), so merge traffic is O(|frontier|), independent of the child's size. The method EXECUTES on the worker
 * (a separate instance, JSON round-trip) and only its output crosses back. ZERO-CORE (protocol.js is outside lib/graph/).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
console.log = console.info = console.warn = () => {};

// a method concept that RUNS on the worker (casts Hot from the frozen input temp) + a big internal SCRATCH that the
// bounded invoke must NOT cross back.
const TREE = { common: { childConcepts: {
	Hot: { _id: 'Hot', _name: 'Hot', require: ['Segment'], ensure: ['$originNode:temp >= 100'] },
} } };
const seed = ( temp ) => ({ lastRev: 0,
	nodes: [ { _id: 'IN', Node: true, temp: temp }, { _id: 'OUT', Node: true },
		{ _id: 'scratch1', internal: 'x'.repeat(300) }, { _id: 'scratch2', internal: 'y'.repeat(300) } ],
	segments: [ { _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' } ] });

test('invoke crosses back ONLY Σ_sep (the method ran on the worker; the scratch never crosses)', async () => {
	const res = await Graph.invokeGraph({ conceptMap: TREE, seed: seed(120), boundedFrom: 's', boundedKeys: ['Hot'] });
	assert.deepEqual(res.summary, { Hot: true }, 'only the declared frontier fact Hot crosses — the method executed on the worker');
	assert.ok(!/scratch|internal/.test(JSON.stringify(res.summary)), 'no worker-internal scratch crosses the bounded invoke');
	assert.ok(res.writeFootprint.includes('Hot'), 'the write-footprint reports the output the body touched (G1)');
	assert.ok(!res.writeFootprint.includes('internal'), 'the footprint is the focus object, never the scratch bodies');
});

test('cold path — the method does NOT cast Hot at temp<100; the bounded summary is empty of Hot', async () => {
	const res = await Graph.invokeGraph({ conceptMap: TREE, seed: seed(50), boundedFrom: 's', boundedKeys: ['Hot'] });
	assert.deepEqual(res.summary, {}, 'Hot is absent (ensure temp>=100 false) → nothing in Σ_sep crosses');
});

test('Σ_sep is a HARD bound — a key outside boundedKeys never crosses even if present on the object', async () => {
	// declare an EMPTY alphabet: even though `s` carries Hot=true, nothing crosses.
	const res = await Graph.invokeGraph({ conceptMap: TREE, seed: seed(120), boundedFrom: 's', boundedKeys: [] });
	assert.deepEqual(res.summary, {}, 'boundedKeys=[] → the interface is severed, nothing crosses');
	assert.ok(res.writeFootprint.includes('Hot'), 'but the write-footprint still reports what the body actually touched');
});

test('contrast — dispatch() returns the WHOLE snapshot (scratch leaks): the O(N) the bounded invoke avoids', async () => {
	const snap = await Graph.spawnGraph({ conceptMap: TREE, seed: seed(120) });
	assert.ok(/scratch|internal/.test(snap.graph), 'the full dispatch crosses the entire serialized child incl. scratch');
	const s = JSON.parse(snap.graph).conceptMaps.find(( o ) => o._id === 's' );
	assert.equal(s.Hot, true, 'same computation, same result — invoke just crops the return to Σ_sep');
});
