'use strict';
/**
 * M1 — the ALWAYS-ON MASTER LOOP (2026-06-27). One controller climbing the cost-ladder
 * MATCH→RETRIEVE(recall)→FORGE→ESCALATE per problem, with the mount policy picking the regime and
 * drift→deopt descending the mount-rank to the K1 floor. Every arm is exercised, with negative controls
 * (a drifted premise RE-DERIVES — never replays the stale method; the escalate floor never caches).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMasterLoop } = require('../../lib/authoring/master-loop.js');
const { createMountController } = require('../../lib/authoring/mount.js');
const { createRecallIndex } = require('../../lib/authoring/recall.js');

// a typed problem: { oKind, tKind, variant }. structure = {oKind,tKind} (the method class); content = {variant}.
const signature = ( p ) => ({ structure: { oKind: p.oKind, tKind: p.tKind }, content: { variant: p.variant } });

function counters() {
	const n = { forge: 0, reForge: 0 };
	const forge = async ( p ) => { n.forge++; return { result: `M(${p.oKind}->${p.tKind}|${p.variant})`, cost: 1, signals: { reliability: 0.9, depth: 1, readOnlyFrontier: true } }; };
	const reForge = async ( p ) => { n.reForge++; return { result: `M(${p.oKind}->${p.tKind}|${p.variant})*`, cost: 1 }; };
	return { n, forge, reForge };
}
const mk = ( extra ) => createMasterLoop(Object.assign({ signature, mount: createMountController({ thresholds: { maxDeopt: 2 } }) }, extra));

test('FORGE then MATCH: a novel problem forges; the exact repeat replays at 0 calls', async () => {
	const { n, forge, reForge } = counters();
	const loop = mk({ forge, reForge });
	const a = await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(a.arm, 'forge'); assert.equal(a.cost, 1); assert.equal(n.forge, 1);
	const b = await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(b.arm, 'match'); assert.equal(b.cost, 0); assert.equal(n.forge, 1, 'no new forge on the exact repeat');
});

test('RECALL-PARTIAL: a same-structure / different-content problem reuses the skeleton, re-forges the diff', async () => {
	const { n, forge, reForge } = counters();
	const loop = mk({ forge, reForge });
	await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });           // forge
	const r = await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v2' }); // same structure {A,B}, new content
	assert.equal(r.arm, 'recall-partial', 'recall surfaced the A→B method; verify → partial reuse');
	assert.deepEqual(r.reForged, ['variant'], 'only the differing content is re-forged');
	assert.equal(n.forge, 1, 'no full forge'); assert.equal(n.reForge, 1, 'one partial re-forge');
});

test('RECALL-FULL: a shared index but a fresh cache (eviction/restart) replays at 0 calls', async () => {
	const { n, forge, reForge } = counters();
	const index = createRecallIndex();
	const loop1 = mk({ forge, reForge, index });
	await loop1.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });          // forge → index + loop1.cache
	// a new loop sharing the INDEX but with a FRESH cache (= a cold process that reloaded the recall index).
	const loop2 = mk({ forge, reForge, index, cache: new Map() });
	const r = await loop2.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(r.arm, 'recall-full', 'exact method recovered from the index without the cache');
	assert.equal(r.cost, 0); assert.equal(n.forge, 1, 'no re-forge — the method was recalled in full');
});

test('DRIFT → RE-DERIVE (never a stale replay), and K drifts pin the method to the ESCALATE floor', async () => {
	const { n, forge, reForge } = counters();
	const loop = mk({ forge, reForge });   // maxDeopt = 2
	await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });           // forge (cached + indexed)
	assert.equal(n.forge, 1);

	// DRIFT #1: a premise changed → invalidate cache AND index; the re-solve RE-DERIVES (no stale replay).
	loop.drift({ oKind: 'A', tKind: 'B', variant: 'v1' });
	const r1 = await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(r1.arm, 'forge', 'after drift the method is re-derived, not recalled stale');
	assert.equal(n.forge, 2);

	// DRIFT #2 → reaches maxDeopt → ESCALATE floor: always forges, never caches.
	loop.drift({ oKind: 'A', tKind: 'B', variant: 'v1' });
	const r2 = await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(r2.arm, 'escalate', 'pinned to the K1 stay-in-LLM floor after K deopts');
	const r3 = await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(r3.arm, 'escalate'); assert.equal(r3.cost, 1, 'the floor never caches — every call pays (absorbing)');
});

test('the LADDER amortizes a recurrent stream (match/recall dominate forge)', async () => {
	const { n, forge, reForge } = counters();
	const loop = mk({ forge, reForge });
	const stream = [
		{ oKind: 'A', tKind: 'B', variant: 'v1' }, { oKind: 'A', tKind: 'B', variant: 'v1' },   // forge, match
		{ oKind: 'A', tKind: 'B', variant: 'v2' },                                              // recall-partial
		{ oKind: 'C', tKind: 'D', variant: 'v1' }, { oKind: 'C', tKind: 'D', variant: 'v1' }    // forge, match
	];
	for ( const p of stream ) await loop.solve(p);
	assert.equal(loop.stats.match, 2);
	assert.equal(loop.stats.recallPartial, 1);
	assert.equal(loop.stats.forge, 2, 'only the two genuinely-novel structures paid a full forge');
	assert.ok(loop.stats.cost < stream.length, 'total model cost < naive (one forge per problem)');
});
