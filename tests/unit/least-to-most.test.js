'use strict';
/**
 * least-to-most — a Tier-0 strategy plugin on reason-kernel (the jasperan catalog, design §9.2 #3):
 * ranked sub-problems, release order EMERGENT from the dataflow (Ready hop-watches prev:Solved),
 * order-guarded solving (Solved requires Ready), ledger audit, completion counter-gate. Structural,
 * 0-model — the host solves each released step; these tests prove the deposited control flow.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

const LM_DIR = path.join(__dirname, '..', '..', 'plugins', 'least-to-most');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('least-to-most graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

function boot(nodes) {
	const lm = definePlugin(LM_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([lm]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes, segments: [] },
		{ label: 'l2m-test', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	return g;
}
const plan = ( k ) => ({ _id: 'ledger', isPlan: true, k, solved: [] });
const step = (id, rank, prev, o) => Object.assign({ _id: id, isThought: true, rank, text: 't' }, prev ? { prev } : {}, o);

test('resolves reason-kernel first; the chain rides Thought + Ledger', () => {
	const cfg = resolvePlugins([definePlugin(LM_DIR, [loadPlugin(RK_DIR)])]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'least-to-most']);
	assert.equal(typeof cfg.providers.Ledger.tally, 'function');
});

test('the release order EMERGES: only rank 0 is Ready until its solution lands, then the chain cascades', async () => {
	const g = boot([plan(3), step('s0', 0), step('s1', 1, 's0'), step('s2', 2, 's1')]);
	await settle(g);
	assert.equal(cast(g, 's0', 'Ready'), true, 'the easiest step is released first');
	assert.equal(cast(g, 's1', 'Ready'), false, 's1 waits on s0 (hop-watched)');
	assert.equal(cast(g, 's2', 'Ready'), false);
	// the host solves s0 → the watcher fires → s1 releases; s2 still waits
	await new Promise((res) => g.ingest({ s0: { answer: 'a0' } }, res));
	await settle(g);
	assert.equal(cast(g, 's0', 'Solved'), true);
	assert.equal(cast(g, 's1', 'Ready'), true, 's0 Solved re-armed s1 — the dataflow IS the scheduler');
	assert.equal(cast(g, 's2', 'Ready'), false, 's2 still gated on s1');
	assert.deepEqual(fact(g, 'ledger', 'solved'), ['s0'], 'the audit records the emergent order');
});

test('the ORDER GUARD: an out-of-order answer is structurally refused (Solved requires Ready)', async () => {
	const g = boot([plan(2), step('s0', 0), step('s1', 1, 's0', { answer: 'early!' })]);   // s1 answered BEFORE s0
	await settle(g);
	assert.equal(cast(g, 's1', 'Solved'), false, 's1 has an answer but was never released — refused, not admitted');
	assert.deepEqual(fact(g, 'ledger', 'solved'), [], 'nothing tallied out of order');
	// solve s0 → s1 releases → its (pre-written) answer NOW counts
	await new Promise((res) => g.ingest({ s0: { answer: 'a0' } }, res));
	await settle(g);
	assert.deepEqual(fact(g, 'ledger', 'solved'), ['s0', 's1'], 'the ladder order held: s0 then s1');
	assert.equal(cast(g, 'ledger', 'Complete'), true, 'all k solved → the composition gate opens');
});

test('NEG — the completion gate never opens on partial coverage', async () => {
	const g = boot([plan(2), step('s0', 0, null, { answer: 'a0' }), step('s1', 1, 's0')]);
	await settle(g);
	assert.deepEqual(fact(g, 'ledger', 'solved'), ['s0']);
	assert.equal(cast(g, 'ledger', 'Complete'), false, '1/2 — no faked completion');
});

test('re-run determinism (full chain)', async () => {
	const run = async () => {
		const g = boot([plan(3), step('s0', 0, null, { answer: 'a' }), step('s1', 1, 's0', { answer: 'b' }), step('s2', 2, 's1', { answer: 'c' })]);
		await settle(g);
		return JSON.stringify(fact(g, 'ledger', 'solved')) + '/' + cast(g, 'ledger', 'Complete');
	};
	assert.equal(await run(), await run());
	assert.equal(await run(), '["s0","s1","s2"]/true', 'the cascade solves the whole chain in rank order');
});
