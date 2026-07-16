'use strict';
/**
 * socratic — a Tier-0 strategy plugin on reason-kernel (the jasperan catalog, design §9.2 #8):
 * bounded question→answer→insight chains, insights TALLIED on the kernel ledger, synthesis gated on
 * full coverage (counter-gate), follow-ups depth-bounded. Structural, 0-model — the host owns the
 * asks; these tests prove the deposited control flow + audit + the negative controls.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

const SO_DIR = path.join(__dirname, '..', '..', 'plugins', 'socratic');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('socratic graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

function boot(nodes) {
	const so = definePlugin(SO_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([so]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes, segments: [] },
		{ label: 'socratic-test', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	return g;
}
const q = (id, o) => Object.assign({ _id: id, isThought: true, question: 'q?', depth: 0, maxDepth: 2 }, o);

test('resolves reason-kernel first; the inquiry set rides the kernel Thought + Ledger', () => {
	const cfg = resolvePlugins([definePlugin(SO_DIR, [loadPlugin(RK_DIR)])]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'socratic']);
	assert.equal(typeof cfg.providers.Ledger.tally, 'function');
});

test('answered questions tally their insight; the synthesis counter-gate opens ONLY at full coverage', async () => {
	const g = boot([
		{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },
		q('q1', { answer: 'a1', insight: 'i1' }),
		q('q2', { answer: 'a2', insight: 'i2' }),
	]);
	await settle(g);
	assert.equal(cast(g, 'q1', 'Insight'), true, 'q1 distilled and tallied');
	assert.deepEqual(fact(g, 'ledger', 'insights').slice().sort(), ['q1', 'q2'], 'both ids on the audit ledger');
	assert.equal(cast(g, 'ledger', 'Synthesize'), true, 'coverage complete → the synthesis gate opens');
});

test('NEG — an unanswered question structurally blocks the synthesis (coverage is never faked)', async () => {
	const g = boot([
		{ _id: 'ledger', isInquiry: true, expected: 2, insights: [] },
		q('q1', { answer: 'a1', insight: 'i1' }),
		q('q2', {}),                                                        // never answered
	]);
	await settle(g);
	assert.equal(cast(g, 'q2', 'Answered'), false);
	assert.deepEqual(fact(g, 'ledger', 'insights'), ['q1']);
	assert.equal(cast(g, 'ledger', 'Synthesize'), false, '1/2 insights → no synthesis signal');
});

test('Deeper — ONE bounded follow-up per answered question; depth budget + null-guard hold', async () => {
	const g = boot([
		{ _id: 'ledger', isInquiry: true, expected: 9, insights: [] },
		q('q-can', { answer: 'a', insight: 'i', depth: 0, maxDepth: 2 }),          // under budget → Deeper
		q('q-max', { answer: 'a', insight: 'i', depth: 2, maxDepth: 2 }),          // at budget → no regress
		q('q-done', { answer: 'a', insight: 'i', depth: 0, maxDepth: 2, followedUp: 1 }),   // already followed up
	]);
	await settle(g);
	assert.equal(cast(g, 'q-can', 'Deeper'), true, 'under the depth budget → the follow-up signal casts');
	assert.equal(cast(g, 'q-max', 'Deeper'), false, 'at maxDepth → bounded, no Socratic regress');
	assert.equal(cast(g, 'q-done', 'Deeper'), false, 'followedUp null-guard: one follow-up per question');
});

test('re-run determinism', async () => {
	const run = async () => {
		const g = boot([{ _id: 'ledger', isInquiry: true, expected: 1, insights: [] }, q('q1', { answer: 'a', insight: 'i' })]);
		await settle(g);
		return cast(g, 'ledger', 'Synthesize') + '/' + JSON.stringify(fact(g, 'ledger', 'insights'));
	};
	assert.equal(await run(), await run());
});
