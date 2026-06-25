'use strict';
/**
 * LIVE end-to-end of an `LLM::complete` concept + the canonicalization barrier against a real local
 * model. GATED: skipped unless LLM_LIVE=1 (so the normal suite stays offline/deterministic). Run:
 *   LLM_LIVE=1 LLM_API=openai LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-nvfp4-mtp \
 *     node --test --test-force-exit tests/integration/llm-live.test.js
 * Proves: the concept casts, the reply's free text is snapped to a DECLARED enum (tracked discrete
 * fact), the prose lands untracked, and a stable FactsDigest is written — the K1 barrier on a real model.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createLLMProvider, makeAsk } = require('../../lib/providers/llm.js');

console.log = console.info = console.warn = () => {};
const LIVE = !!process.env.LLM_LIVE;

const tree = { common: { childConcepts: {
	Classify: {
		_id: 'Classify', _name: 'Classify', require: ['text'], provider: ['LLM::complete'],
		prompt: {
			system: 'You classify the sentiment of a text. Reply ONLY a JSON object, nothing else.',
			user  : 'Text: "${text}"\nReply exactly: {"sentiment":"positive|negative|neutral","prose":"one short reason"}',
			maxTokens: 1024,
			facts : { sentiment: { enum: ['positive', 'negative', 'neutral'] } }
		}
	}
} } };

test('LLM::complete snaps a real model reply to the declared enum (canonicalization barrier)', { skip: !LIVE && 'set LLM_LIVE=1 (+ LLM_API/LLM_BASE/LLM_MODEL) to run against a live model' }, async () => {
	Graph._providers = Object.assign({}, Graph._providers, createLLMProvider({ ask: makeAsk({}) })); // api/base/model from env
	const cfg = { label: 'llm-live', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
	const seed = { lastRev: 0, nodes: [{ _id: 'n', Node: true, text: 'I absolutely love this product, it works perfectly and made my day.' }], segments: [] };

	const g = new Graph(seed, cfg, tree);
	await nextStable(g);
	const n = g._objById['n']._etty._;

	process.stderr.write('\n[live] sentiment=' + JSON.stringify(n.sentiment) + ' prose=' + JSON.stringify(String(n.Prose || '').slice(0, 80)) + '\n');
	assert.equal(n.Classify, true, 'the concept cast');
	assert.ok(['positive', 'negative', 'neutral'].includes(n.sentiment), 'reply snapped to the declared enum (tracked discrete fact)');
	assert.equal(n.sentiment, 'positive', 'a clearly positive text classifies positive');
	assert.ok(typeof n.ClassifyFactsDigest === 'string' && n.ClassifyFactsDigest.length, 'a stable facts digest was written');
	assert.ok(!('llmError' in n), 'no backend error');
});
