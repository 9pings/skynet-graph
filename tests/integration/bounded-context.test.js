'use strict';
/**
 * FLAGSHIP bounded-context map-reduce (study 2026-06-26). The graph as bounded working memory: a
 * document is sharded into segments, each leaf processed with ONLY its own shard (the bounded call),
 * the reduce done via the race-free {__push} reactive synthesis. This locks the mechanism that the
 * real-LLM run (examples/poc/bounded-context.js, EXTRACTOR=llm) measured: 100% recall, every call
 * ~one shard. Deterministic (stub extractor) so it runs in the suite without an LLM.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');                                   // sets __SERVER__ for the engine
const { buildDoc, runEngine, recallOf, maxCallTokens } = require('../../examples/poc/bounded-context.js');

test('the engine recovers EVERY planted fact, with each call bounded to ~one shard', async () => {
	const doc = buildDoc();                                // N sections, one planted code each
	assert.ok(doc.sections.length >= 8, 'a multi-shard document');
	const found = await runEngine(doc);

	assert.equal(recallOf(doc, found), 1, 'engine map-reduce recovers 100% of the codes across shards');

	const maxCall = maxCallTokens();
	const docTokens = Math.ceil(doc.text.length / 4);
	assert.ok(maxCall < docTokens / 3, `max per-call context (${maxCall} tok) is bounded well under the whole doc (${docTokens} tok)`);
});
