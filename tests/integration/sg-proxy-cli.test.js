'use strict';
// `sg proxy` — the real-model wiring for C6 (the local-first proxy cache). Deterministic (stub chat backends,
// no GPU): the FRONTIER adapter turns a chat ask into a question-answerer; the SESSION runner measures the
// economy (frontier calls saved) over a recurring stream; a durable --store persists the stock cross-instance
// so a fresh proxy replays covered queries at 0 frontier calls; a stub local model gives SEMANTIC coverage.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProxyCache, makeFrontierAsk, makeLocalCoverage } = require('../../lib/factories/proxy-cache.js');
const { runProxySession, formatProxyReport } = require('../../lib/sg/proxy-run.js');

// a stub CHAT backend ({system,user}) -> text, call-counted — stands in for an embedded gguf / an endpoint.
function stubChat() {
	const calls = { n: 0, seen: [] };
	const ask = async ( { system, user } ) => { calls.n++; calls.seen.push({ system, user }); return 'A:' + user; };
	return { ask, calls };
}

test('makeFrontierAsk — adapts a CHAT ask into a (query)->answer (query is the user turn, answer-directly system)', async () => {
	const c = stubChat();
	const frontierAsk = makeFrontierAsk(c.ask);
	const a = await frontierAsk('capital of france?');
	assert.equal(a, 'A:capital of france?', 'the query is passed as the user turn, the chat reply is the answer');
	assert.equal(c.calls.n, 1);
	assert.match(c.calls.seen[0].system, /answer the question directly/i, 'a neutral answer-directly system prompt is applied');
	// a custom system prompt is honored (a domain host tightens it)
	const tightened = makeFrontierAsk(c.ask, { system: 'SQL only.' });
	await tightened('list users');
	assert.equal(c.calls.seen[1].system, 'SQL only.');
});

test('makeFrontierAsk — rejects a non-function backend (fail-closed wiring)', () => {
	assert.throws(() => makeFrontierAsk(null), /needs a chat ask/);
});

test('runProxySession — a recurring session: repeats served LOCAL, economy = frontier calls saved', async () => {
	const c = stubChat();
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(c.ask), retention: true });
	const queries = ['a', 'b', 'c', 'a', 'b', 'a'];   // 3 distinct, then repeat 2 of them
	const streamed = [];
	const { results, metrics, saved } = await runProxySession({ proxy: px, queries, onAnswer: ( r ) => streamed.push(r.source) });

	assert.equal(results.length, 6);
	assert.equal(c.calls.n, 3, 'only the 3 DISTINCT queries hit the frontier');
	assert.equal(metrics.frontier, 3);
	assert.equal(metrics.local, 3, 'the 3 repeats were served from the stock');
	assert.equal(metrics.coverage, 0.5);
	assert.equal(saved, 3, 'saved = frontier calls avoided = local hits');
	assert.deepEqual(streamed, ['frontier', 'frontier', 'frontier', 'local', 'local', 'local'], 'onAnswer streams provenance in order');
	// the answer is always the frontier ground truth (0 hallucination — the local side serves verified stock).
	assert.equal(results[3].answer, 'A:a');
});

test('runProxySession — a durable --store persists the stock: a FRESH proxy replays covered queries at 0 frontier calls', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-proxy-'));
	const file = path.join(dir, 'stock.json');
	try {
		// session 1 — warm the stock (mirrors the CLI wiring: file store + retention ON).
		const c1 = stubChat();
		const px1 = createProxyCache({ frontierAsk: makeFrontierAsk(c1.ask), store: file, retention: true });
		await runProxySession({ proxy: px1, queries: ['q1', 'q2'] });
		assert.equal(c1.calls.n, 2, 'both distinct queries escalated on the cold session');
		assert.ok(fs.existsSync(file), 'the stock was persisted to disk');

		// session 2 — a FRESH proxy over the SAME file: the persisted stock covers both → 0 frontier calls.
		const c2 = stubChat();
		const px2 = createProxyCache({ frontierAsk: makeFrontierAsk(c2.ask), store: file, retention: true });
		const { metrics, saved } = await runProxySession({ proxy: px2, queries: ['q1', 'q2'] });
		assert.equal(c2.calls.n, 0, 'the fresh proxy served both from the persisted stock — NO new frontier call');
		assert.equal(metrics.local, 2);
		assert.equal(metrics.coverage, 1, 'full coverage on the warm restart');
		assert.equal(saved, 2);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runProxySession — SEMANTIC coverage via a stub local model: a paraphrase hits the stock (0 frontier call)', async () => {
	// a stub local model: canonicalizes a query → a normal form (paraphrases collide); confirms fit = yes.
	const localAsk = async ( { system, user } ) => {
		if ( /keyword/i.test(system) ) return /france/i.test(user) ? 'capital france' : String(user).toLowerCase();
		if ( /does the answer/i.test(system) ) return 'yes';
		return '';
	};
	const c = stubChat();
	const { semanticKey, coverageCheck } = makeLocalCoverage({ localAsk });
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(c.ask), semanticKey, coverageCheck, retention: true });
	const { metrics } = await runProxySession({ proxy: px, queries: ['capital of France?', "what is France's capital city?"] });
	assert.equal(c.calls.n, 1, 'the paraphrase snapped to the same semantic key → one frontier call for both');
	assert.equal(metrics.coverage, 0.5);
});

test('makeLocalCoverage — the default key prompt is the keyword-slot form; keyPrompt/fitPrompt overrides are honored', async () => {
	const { makeLocalCoverage } = require('../../lib/factories/proxy-cache.js');
	const seen = { key: null, fit: null };
	const localAsk = async ( { system } ) => { if ( /reduce the question/i.test(system) || /DOMAIN KEY/.test(system) ) { seen.key = system; return 'k'; } seen.fit = system; return 'yes'; };
	const def = makeLocalCoverage({ localAsk });
	await def.semanticKey('anything');
	assert.match(seen.key, /essential keywords/i, 'default key prompt is the keyword-slot form (the rehabilitated V2)');
	// a domain host tightens the prompts:
	const custom = makeLocalCoverage({ localAsk, keyPrompt: 'DOMAIN KEY: slotify', fitPrompt: 'DOMAIN FIT: ok?' });
	seen.key = null; seen.fit = null;
	await custom.semanticKey('q'); await custom.coverageCheck('q', 'a');
	assert.equal(seen.key, 'DOMAIN KEY: slotify', 'keyPrompt override honored');
	assert.equal(seen.fit, 'DOMAIN FIT: ok?', 'fitPrompt override honored');
});

test('runProxySession — rejects a missing proxy (guard)', async () => {
	await assert.rejects(runProxySession({ queries: ['x'] }), /needs opts\.proxy/);
});

test('formatProxyReport — renders the economy readout (coverage %, calls saved, stock)', async () => {
	const c = stubChat();
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(c.ask), retention: true });
	const { metrics, saved } = await runProxySession({ proxy: px, queries: ['a', 'a'] });
	const rep = formatProxyReport(metrics, saved);
	assert.match(rep, /coverage\s*:\s*50%/, 'coverage rendered as a percentage');
	assert.match(rep, /frontier calls saved: 1/);
	assert.match(rep, /stock\s*:\s*1 entries/);
	assert.equal(formatProxyReport(null, 0), 'proxy: (no metrics)', 'null metrics degrades gracefully');
});
