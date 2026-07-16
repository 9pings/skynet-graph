'use strict';
/**
 * self-consistency as a PLUGIN and the SECOND client of reason-kernel (design combos-as-grammar §9.5).
 * It proves what the provider-only critical-mind→reason-kernel dep could not: GRAMMAR interdependence
 * (SC's `Vote` require the kernel's `Thought` concept — a crossCorpus edge) AND subsumption of the
 * kernel's Ledger (votes tallied via `Ledger::tally`) + decidability margin (`Ledger::decide`).
 *
 * Structural, 0-model (like dialectic-grammar.test): k paths are hand-seeded with an answerClass; the
 * grammar tallies the votes and decides by the SAME margin bound. The live SC::solve LLM path is exercised
 * separately (GPU). The decision node IS the ledger node — Decide reads scope._.votes (the proven pattern).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

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
	throw new Error('self-consistency graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

// Boot self-consistency CARRYING its reason-kernel dep (the npm shape) and resolving the object graph.
function bootSC(seedNodes, opts) {
	opts = opts || {};
	const sc = definePlugin(SC_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins(opts.plugins || [sc]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: seedNodes, segments: [] },
		{ label: 'sc-test', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	return { g, cfg };
}

// k paths that voted A,A,A,B,C — margin (top A=3) − (runner-up B=1) = 2.
const paths = (classes) => classes.map((c, i) => ({ _id: 'path' + i, isThought: true, answerClass: c }));

test('self-consistency resolves reason-kernel FIRST (2nd client, crossCorpus interdependence)', () => {
	const sc = definePlugin(SC_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([sc]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'self-consistency'], 'kernel resolves before its dependent');
	assert.deepEqual(Object.keys(cfg.conceptMap).sort(), ['kernel', 'selfconsistency'], 'both concept sets merged');
	assert.equal(typeof cfg.providers.Ledger.tally, 'function', 'Ledger from the kernel');
});

test('k paths → votes tallied via Ledger::tally → mechanical verdict at margin ≥ threshold', async () => {
	const { g } = bootSC([
		{ _id: 'ledger', isDecision: true, threshold: 2, k: 5, votes: [] },
		...paths(['A', 'A', 'A', 'B', 'C']),   // A=3, B=1, C=1 → margin 2
	]);
	await settle(g);
	assert.equal(cast(g, 'path0', 'Vote'), true, 'a path cast Vote — its Thought (kernel) was required and present');
	assert.deepEqual(fact(g, 'ledger', 'votes'), ['A', 'A', 'A', 'B', 'C'], 'answerClasses tallied into ledger.votes');
	assert.equal(cast(g, 'ledger', 'Decide'), true, 'Decide fired once all k votes were in');
	assert.equal(fact(g, 'ledger', 'consensus'), 'A', 'majority is A');
	assert.equal(fact(g, 'ledger', 'margin'), 2, 'margin = 3 − 1');
	assert.equal(fact(g, 'ledger', 'verdict'), 'A', 'verdict A — margin 2 ≥ threshold 2');
});

test('NEGATIVE control — a sub-threshold margin decides UNDECIDED (the decidability bound)', async () => {
	const { g } = bootSC([
		{ _id: 'ledger', isDecision: true, threshold: 2, k: 4, votes: [] },
		...paths(['A', 'A', 'B', 'B']),        // A=2, B=2 → margin 0
	]);
	await settle(g);
	assert.equal(fact(g, 'ledger', 'margin'), 0, 'a tie');
	assert.equal(fact(g, 'ledger', 'verdict'), 'UNDECIDED', 'no fake verdict below the margin bound');
});

test('NEGATIVE control — the kernel dep is LOAD-BEARING: booted WITHOUT it, Vote never casts', async () => {
	// boot ONLY self-consistency's grammar (no reason-kernel): Thought concept + Ledger providers absent →
	// Vote's `require: ["Thought", …]` is unsatisfiable. (resolvePlugins([sc]) alone would throw on the
	// unresolved dep — which is itself the point; here we prove the GRAMMAR edge is load-bearing.)
	const scOnly = loadPlugin(SC_DIR);
	Graph._providers = {};                             // no Ledger providers either
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: [{ _id: 'ledger', isDecision: true, threshold: 2, k: 3, votes: [] }, ...paths(['A', 'A', 'B'])], segments: [] },
		{ label: 'sc-nokernel', isMaster: true, autoMount: true, conceptSets: ['selfconsistency'], bagRefManagers: {}, logLevel: 'error' },
		{ selfconsistency: scOnly.concepts.selfconsistency }
	);
	await settle(g);
	assert.equal(cast(g, 'path0', 'Vote'), false, 'Vote cannot cast — Thought (kernel concept) is absent');
	assert.deepEqual(fact(g, 'ledger', 'votes'), [], 'nothing tallied without the kernel');
});

test('resolvePlugins([self-consistency]) alone THROWS on the unresolved kernel dep (deps are real)', () => {
	assert.throws(() => resolvePlugins([loadPlugin(SC_DIR)]), /unresolved dependency: reason-kernel/i);
});

test('re-run determinism (structural, 0-model): identical verdict twice', async () => {
	const run = async () => {
		const { g } = bootSC([{ _id: 'ledger', isDecision: true, threshold: 2, k: 5, votes: [] }, ...paths(['A', 'A', 'A', 'B', 'C'])]);
		await settle(g);
		return fact(g, 'ledger', 'verdict') + '/' + fact(g, 'ledger', 'margin');
	};
	assert.equal(await run(), await run(), 'deterministic verdict/margin');
});

// ── the MCP exposure (the strategy surface: params/tools — never a model-name suffix) ────────────────

test('MCP self_consistency tool — k sampled paths, host snap, abstention rule, the PLUGIN decides', async () => {
	const { defaultTools } = require('../../lib/sg/mcp.js');
	assert.ok(!defaultTools({}).some(( t ) => t.name === 'self_consistency' ), 'absent without a wired backend');
	const replies = ['thinking...\nANSWER: 42', 'ANSWER: 42.0', 'blah\nANSWER: 41', 'garbage with no final line', 'ANSWER: 42.'];
	let calls = 0;
	const ask = async ( q ) => {
		assert.equal(q.temperature, 0.7, 'default sampling temperature');
		assert.match(String(q.user), /what is 6\*7/);
		return replies[calls++];
	};
	const tool = defaultTools({ critiqueAsk: ask }).find(( t ) => t.name === 'self_consistency' );
	assert.ok(tool && tool.inputSchema.required.includes('question'));
	const r = await tool.call({ question: 'what is 6*7?' });
	assert.equal(calls, 5, 'k=5 paths sampled by default');
	assert.equal(r.abstained, 1, 'the no-ANSWER-line path ABSTAINED (a parse-failure is not a vote class)');
	assert.deepEqual(r.votes, ['42', '42', '41', '42'], 'numeric snap: 42.0 and "42." canonicalize to 42');
	assert.equal(r.verdict, '42');
	assert.equal(r.consensus, '42');
	assert.equal(r.agree, 3);
	assert.equal(r.margin, 2);
	assert.equal(r.total, 4, 'the plugin decided over the VALID votes only');
	assert.equal(r.advice, null);
});

test('MCP self_consistency — a tie is UNDECIDED (the margin bound), never coin-flipped; typed advice', async () => {
	const { defaultTools } = require('../../lib/sg/mcp.js');
	const replies = ['ANSWER: alpha', 'ANSWER: beta', 'ANSWER: Alpha', 'ANSWER: beta'];   // case-snap → 2 vs 2
	let i = 0;
	const tool = defaultTools({ critiqueAsk: async () => replies[i++] }).find(( t ) => t.name === 'self_consistency' );
	const r = await tool.call({ question: 'q?', k: 4 });
	assert.deepEqual(r.votes, ['alpha', 'beta', 'alpha', 'beta'], 'class snap lowercases');
	assert.equal(r.verdict, 'UNDECIDED');
	assert.equal(r.margin, 0);
	assert.match(r.advice, /margin bound/);
});

test('MCP self_consistency — NEG: all paths abstain → typed refusal, never a fabricated vote', async () => {
	const { defaultTools } = require('../../lib/sg/mcp.js');
	const tool = defaultTools({ critiqueAsk: async () => 'no final line here' }).find(( t ) => t.name === 'self_consistency' );
	const r = await tool.call({ question: 'q?', k: 3 });
	assert.equal(r.verdict, 'UNDECIDED');
	assert.equal(r.abstained, 3);
	assert.match(r.error, /abstained/);
	assert.match(r.advice, /maxTokens/, 'the advice names the measured cause (thinking eats the budget)');
});

test('MCP self_consistency — temperature 0 is announced as vacuous (k identical paths)', async () => {
	const { defaultTools } = require('../../lib/sg/mcp.js');
	const tool = defaultTools({ critiqueAsk: async () => 'ANSWER: same' }).find(( t ) => t.name === 'self_consistency' );
	const r = await tool.call({ question: 'q?', k: 3, temperature: 0 });
	assert.equal(r.verdict, 'same', 'unanimity still decides');
	assert.match(r.advice, /vacuous/, 'but the payload SAYS the vote is vacuous at temp 0');
});
