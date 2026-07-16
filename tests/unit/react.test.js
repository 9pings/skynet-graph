'use strict';
/**
 * react — a Tier-0 strategy plugin on reason-kernel (the jasperan catalog, design §9.2 #11): the
 * Thought→Action→Observation loop as grammar. The distinctive structural claims: NeedsAction is a
 * LIVE signal (uncasts on the observation landing — the ensure-fall as a native worklist), the
 * trajectory tallies on the kernel ledger, and Continue has THREE independent stops (budget,
 * terminal answer, one-successor null-guard). 0-model; the tools are the host's.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

const RE_DIR = path.join(__dirname, '..', '..', 'plugins', 'react');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('react graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

function boot(nodes, sessionExtra) {
	const re = definePlugin(RE_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([re]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: [Object.assign({ _id: 'ledger', isReactSession: true, maxRounds: 3, trace: [] }, sessionExtra || {})].concat(nodes), segments: [] },
		{ label: 'react-test', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	return g;
}
const step = (id, round, o) => Object.assign({ _id: id, isThought: true, round, text: 'think' }, o);

test('resolves reason-kernel first (react-loop rides Thought + Ledger)', () => {
	const cfg = resolvePlugins([definePlugin(RE_DIR, [loadPlugin(RK_DIR)])]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'react-loop'], 'plugin identity = the npm name (react is taken)');
	assert.equal(typeof cfg.providers.Ledger.tally, 'function');
});

test('NeedsAction is a LIVE worklist: casts on a pending typed action, UNCASTS when the observation lands', async () => {
	const g = boot([step('t0', 0, { actionTool: 'search', actionInput: 'q' })]);
	await settle(g);
	assert.equal(cast(g, 't0', 'NeedsAction'), true, 'a pending tool call is a cast signal');
	assert.equal(cast(g, 't0', 'Observed'), false);
	// the host executes the tool and writes the observation → the ensure FALLS → the signal retires itself
	await new Promise((res) => g.ingest({ t0: { observation: 'found it' } }, res));
	await settle(g);
	assert.equal(cast(g, 't0', 'NeedsAction'), false, 'the signal UNCAST on the ensure-fall — a native worklist');
	assert.equal(cast(g, 't0', 'Observed'), true, 'the step entered the trace');
	assert.deepEqual(fact(g, 'ledger', 'trace'), ['t0'], 'the trajectory is the audit');
});

test('Continue: the bounded next-step signal — budget stop + one-successor null-guard', async () => {
	const g = boot([
		step('t0', 0, { actionTool: 'x', observation: 'o0' }),                  // observed, budget left → Continue
		step('t1', 3, { actionTool: 'x', observation: 'o1' }),                  // round == maxRounds → budget stop
		step('t2', 1, { actionTool: 'x', observation: 'o2', continued: 1 }),    // already spawned its successor
	]);
	await settle(g);
	assert.equal(cast(g, 't0', 'Continue'), true, 'observed + budget + no successor → continue');
	assert.equal(cast(g, 't1', 'Continue'), false, 'the round budget is the stop — no runaway loop');
	assert.equal(cast(g, 't2', 'Continue'), false, 'the continued null-guard — no forking');
});

test('the terminal answer stops the loop STRUCTURALLY: finalAnswer on the session → Done casts, Continue goes off', async () => {
	const g = boot([step('t0', 0, { actionTool: 'x', observation: 'o' })], { finalAnswer: '42' });
	await settle(g);
	assert.equal(cast(g, 'ledger', 'Done'), true, 'the session is terminal');
	assert.equal(cast(g, 't0', 'Continue'), false, 'no continuation past the final answer ($$ledger:finalAnswer)');
});

test('NEG — a pure-thought step (no actionTool) never signals an action; an unobserved step never enters the trace', async () => {
	const g = boot([step('t0', 0), step('t1', 1, { actionTool: 'x' })]);
	await settle(g);
	assert.equal(cast(g, 't0', 'NeedsAction'), false, 'pure reasoning steps are legitimate — no forced tool call');
	assert.deepEqual(fact(g, 'ledger', 'trace'), [], 'nothing observed → nothing traced');
	assert.equal(cast(g, 'ledger', 'Done'), false);
});

test('re-run determinism (act → observe → continue)', async () => {
	const run = async () => {
		const g = boot([step('t0', 0, { actionTool: 'x' })]);
		await settle(g);
		await new Promise((res) => g.ingest({ t0: { observation: 'o' } }, res));
		await settle(g);
		return [cast(g, 't0', 'NeedsAction'), cast(g, 't0', 'Continue'), JSON.stringify(fact(g, 'ledger', 'trace'))].join('/');
	};
	assert.equal(await run(), await run());
});
