'use strict';
/**
 * PARITY — the plugin-form reasoning vs the PRE-REFACTOR lib-form (what existed before combos/providers were
 * extracted into plugins). Two comparisons:
 *
 *   (1) self-consistency: the new Tier-0 plugin (Vote → Ledger::tally → Ledger::decide) vs the old
 *       `lib/providers/verify.js` `majority()` / `Vote::tally` (the k-of-n consensus that shipped before).
 *       On the same votes they pick the SAME consensus; the plugin ADDS the K1 margin decidability gate
 *       (UNDECIDED below the bound) the old majority lacked — the improvement, made explicit.
 *
 *   (2) critical-mind: `Graph.combos.createCriticalMind` still IS the (relocated) plugin combo — the public
 *       surface is unchanged, and its behaviour is covered verbatim by the unchanged `critique.test.js`.
 *
 * The pre-refactor tests themselves (critique / dialectic-grammar / verification / aggregation) remain green
 * — this file adds the head-to-head the "compare with the pre-refactor tests" request asks for.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');
const { majority } = require('../../lib/providers/verify.js');   // the PRE-REFACTOR self-consistency core

const SC_DIR = path.join(__dirname, '..', '..', 'plugins', 'self-consistency');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('parity graph did not settle');
}
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

// the NEW plugin's decision on a vote array
async function pluginDecide(votes, threshold) {
	const cfg = resolvePlugins([definePlugin(SC_DIR, [loadPlugin(RK_DIR)])]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: [
			{ _id: 'ledger', isDecision: true, threshold, k: votes.length, votes: [] },
			...votes.map((v, i) => ({ _id: 'p' + i, isThought: true, answerClass: v })),
		], segments: [] },
		{ label: 'parity', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	await settle(g);
	return { consensus: fact(g, 'ledger', 'consensus'), margin: fact(g, 'ledger', 'margin'), verdict: fact(g, 'ledger', 'verdict') };
}

test('SC parity: the plugin picks the SAME consensus as the pre-refactor verify.js majority()', async () => {
	const clearWinners = [
		['A', 'A', 'A', 'B', 'C'],
		['A', 'A', 'A', 'A', 'B'],
		['X', 'Y', 'X', 'X', 'Y', 'X'],
		['5', '5', '8'],
	];
	for (const votes of clearWinners) {
		const old = majority(votes);                       // the shipped-before k-of-n winner
		const plug = await pluginDecide(votes, 2);
		assert.equal(plug.consensus, old.value, `same consensus on [${votes}] (old=${old.value}, plugin=${plug.consensus})`);
	}
});

test('SC delta: the plugin ADDS the decidability bound — a tie the old majority would "win", the plugin calls UNDECIDED', async () => {
	const votes = ['A', 'A', 'B', 'B'];                    // a tie
	const old = majority(votes);
	assert.equal(old.agree, 2, 'the old majority still returns a "winner" with agree=2 (no margin notion)');
	const plug = await pluginDecide(votes, 2);
	assert.equal(plug.margin, 0, 'the plugin sees margin 0');
	assert.equal(plug.verdict, 'UNDECIDED', 'and abstains — the K1 margin bound the old form lacked');
	assert.equal(plug.consensus, old.value, 'yet the plurality reported still agrees');
});

test('SC parity: agreement holds at the boundary (margin exactly = threshold → decides the majority)', async () => {
	const votes = ['A', 'A', 'A', 'B'];                    // A=3, B=1, margin 2
	const old = majority(votes);
	const plug = await pluginDecide(votes, 2);
	assert.equal(plug.consensus, old.value, 'consensus agrees');
	assert.equal(plug.verdict, old.value, 'at margin == threshold the plugin decides the same majority the old form reported');
});

test('C9 surface parity: Graph.combos.createCriticalMind IS the relocated plugin combo (behaviour = unchanged critique.test)', () => {
	const facade = require('../../lib/index.js').combos.createCriticalMind;
	const pluginCombo = require('../../plugins/critical-mind/combo.js').createCriticalMind;
	assert.equal(facade, pluginCombo, 'the public combo === the plugin combo — one implementation, relocated not rewritten');
});
