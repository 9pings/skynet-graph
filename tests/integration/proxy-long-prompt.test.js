'use strict';
/**
 * LONG PROMPTS — the C6 proxy stays economical + sound as the prompt grows (owner track (b), 2026-07-06).
 * The K1 barrier's payoff: the memo/dispatch KEY is a TYPED / canonical fact, NOT the raw prompt text, so a
 * query wrapped in a long context collapses to the SAME key as its short core → the stock HITS regardless of
 * length. EXACT-key does not: every long variant is a fresh string → a fresh key → a re-forge. So on long
 * prompts the proxy is economical ONLY through the typed/semantic key. Soundness is length-invariant either
 * way (the frontier answer served on a hit was verified when distilled; a miss escalates — no hallucination).
 * Deterministic: a STUB semanticKey stands in for the local model's canonicalization (the GPU cell measures how
 * well a real small model produces a stable key under length — this locks the combo's GUARANTEE given one). ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { createProxyCache } = require('../../lib/factories/proxy-cache.js');

// a query embedded in a long context block: a big schema/preamble + the real question after a marker + a big
// postamble of column docs. The SHORT core and the LONG variant carry the SAME question.
const CORE = 'how many singers are there';
const pad = ( n, seed ) => Array.from({ length: n }, ( _, i ) => `col_${seed}_${i} TEXT -- description of column ${i} in the schema dump`).join('\n');
const long = ( q ) => `You are given a database. SCHEMA:\n${pad(40, 'a')}\n\nQuestion: ${q}\n\nCOLUMN NOTES:\n${pad(40, 'b')}`;
const shortq = ( q ) => `Question: ${q}`;

// the canonicalizer: pull the text after "Question:" up to the next blank line, normalized → length-invariant.
// (a deterministic stand-in for the local model's keyword-slot key; the GPU cell measures the real model's stability.)
const semanticKey = async ( q ) => {
	const m = String(q).match(/question:\s*([^\n]*)/i);
	return (m ? m[1] : String(q)).trim().toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
};

function countingFrontier() {
	const calls = [];
	const ask = async ( query ) => { calls.push(String(query)); return `ANSWER(${await semanticKey(query)})`; };  // ground truth, keyed on the core
	return { ask, calls };
}

test('EXACT-key proxy — a long-context variant MISSES → re-forges (exact-key is NOT length-robust)', async () => {
	const fr = countingFrontier();
	const px = createProxyCache({ frontierAsk: fr.ask });                 // no semanticKey → exact-key = the raw string
	const a1 = await px.answer(shortq(CORE));
	const a2 = await px.answer(long(CORE));                              // same question, long context
	assert.equal(fr.calls.length, 2, 'exact-key: the long variant is a new string → a 2nd frontier call');
	assert.equal(a1.source, 'frontier');
	assert.equal(a2.source, 'frontier', 'the long variant did NOT hit the stock');
});

test('SEMANTIC-key proxy — the long-context variant HITS at 0 frontier calls (the typed key is length-invariant)', async () => {
	const fr = countingFrontier();
	const px = createProxyCache({ frontierAsk: fr.ask, semanticKey });
	const a1 = await px.answer(shortq(CORE));                           // miss → 1 frontier call, stock enriched
	assert.equal(fr.calls.length, 1, 'first ask forges once');
	assert.equal(a1.source, 'frontier');

	const a2 = await px.answer(long(CORE));                             // long variant → same semantic key → HIT
	assert.equal(fr.calls.length, 1, 'the long-context variant added NO frontier call (served from the stock)');
	assert.equal(a2.source, 'local', 'served locally at 0 frontier cost');
	assert.equal(a2.cached, true);
	// SOUNDNESS: the served answer is the SAME verified frontier answer (0 hallucination — never fabricated locally).
	assert.equal(a2.answer, a1.answer, 'the long variant is served the same frontier-verified answer');

	// an even longer variant still hits — length does not erode the key.
	const a3 = await px.answer(long(CORE) + '\n' + pad(200, 'c'));
	assert.equal(fr.calls.length, 1, 'a much longer variant still adds no frontier call');
	assert.equal(a3.source, 'local');

	const m = px.metrics();
	assert.equal(m.frontier, 1, 'exactly one frontier call across 3 length variants');
	assert.equal(m.local, 2, 'two served locally');
});

test('NEG — the key is not blindly length-collapsing: a DIFFERENT question re-forges (no false coverage)', async () => {
	const fr = countingFrontier();
	const px = createProxyCache({ frontierAsk: fr.ask, semanticKey });
	await px.answer(long(CORE));                                        // forge #1
	const other = await px.answer(long('how many stadiums are there'));// different core → different key → forge #2
	assert.equal(fr.calls.length, 2, 'a genuinely different question is NOT collapsed onto the cached entry');
	assert.equal(other.source, 'frontier');
	// and it too becomes length-robust: its own long variant now hits.
	const again = await px.answer('Question: how many stadiums are there');
	assert.equal(fr.calls.length, 2, 'the second question is now cached across lengths as well');
	assert.equal(again.source, 'local');
});

test('drift on a long-context query invalidates the entry by its typed key (anti-drift is length-invariant too)', async () => {
	const fr = countingFrontier();
	const px = createProxyCache({ frontierAsk: fr.ask, semanticKey });
	await px.answer(shortq(CORE));                                      // forge #1 → cached
	await px.drift(long(CORE));                                         // drift via the LONG variant → same key → invalidated
	const after = await px.answer(shortq(CORE));                        // re-escalates (the stale entry was cleared)
	assert.equal(fr.calls.length, 2, 'drift reached the entry through the long-variant key → the next ask re-forged');
	assert.equal(after.source, 'frontier');
});
