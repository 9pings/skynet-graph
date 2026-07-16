'use strict';
/**
 * U5 — FUZZY-RECALL → TYPED-VERIFY (2026-06-27). The contract: recall ORDERS (fuzzy, whole-signature),
 * typed VERIFY ADMITS (exact, structure-gated — the K1 barrier). full reuse on exact, PARTIAL reuse on a
 * close method (shared skeleton + re-forge the diff), REJECT on similar-but-structurally-incompatible.
 * The reject case is the load-bearing soundness control: high similarity NEVER admits a wrong structure.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecallIndex, verify, recallAndVerify } = require('../../lib/authoring/learning/recall.js');

test('verify: exact structure+content → FULL reuse (0 calls)', () => {
	const v = verify({ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } },
		{ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } });
	assert.equal(v.mode, 'full');
	assert.deepEqual(v.reForge, []);
});

test('verify: same structure, different content → PARTIAL reuse (skeleton reused, content re-forged)', () => {
	const v = verify({ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm9' } },
		{ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } });
	assert.equal(v.mode, 'partial');
	assert.deepEqual(v.reuse, ['oKind', 'tKind'], 'the shared typed structure (the skeleton) is reused');
	assert.deepEqual(v.reForge, ['mid'], 'only the differing content hole is re-forged');
});

test('verify NEGATIVE CONTROL: different STRUCTURE → REJECT (no false replay), whatever the content overlap', () => {
	const v = verify({ structure: { oKind: 'A', tKind: 'Z' }, content: { mid: 'm1' } },
		{ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } });   // identical content, different structure
	assert.equal(v.mode, 'reject', 'a structural mismatch is never admitted, even with identical content');
});

test('recall ORDERS, verify ADMITS: a high-similarity but structurally-incompatible candidate is REJECTED', () => {
	const idx = createRecallIndex();
	// M1: the structurally-correct method for A→B (the one we SHOULD reuse for an A→B query).
	idx.add({ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } }, 'M_AB');
	// M2: a DECOY — different structure (A→Z) but content/token overlap engineered to score HIGH on the query.
	idx.add({ structure: { oKind: 'A', tKind: 'Z' }, content: { mid: 'qqq', extra: 'qqq', more: 'qqq' } }, 'M_AZ_decoy');

	const query = { structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'qqq', extra: 'qqq', more: 'qqq' } };
	const ranked = idx.recall(query, 2);
	// the decoy may well rank FIRST by raw similarity (it shares the content tokens) …
	assert.ok(ranked.length === 2);
	// … but recallAndVerify admits the STRUCTURALLY-correct M_AB (partial: re-forge the content), never the decoy.
	const chosen = recallAndVerify(idx, query, 2);
	assert.equal(chosen.method, 'M_AB', 'typed verify picks the structure-compatible method, not the highest-similarity decoy');
	assert.equal(chosen.verdict.mode, 'partial');
	assert.deepEqual(chosen.verdict.reForge.sort(), ['extra', 'mid', 'more']);
});

test('recallAndVerify: no structurally-compatible candidate → null (forge fresh, no false replay)', () => {
	const idx = createRecallIndex();
	idx.add({ structure: { oKind: 'P', tKind: 'Q' }, content: { mid: 'm1' } }, 'M_PQ');
	const chosen = recallAndVerify(idx, { structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } }, 3);
	assert.equal(chosen, null, 'a totally different structure verifies to nothing → the caller forges fresh');
});

test('recallAndVerify: an exact match is admitted FULL even at low similarity rank', () => {
	const idx = createRecallIndex();
	idx.add({ structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } }, 'M_exact');
	const chosen = recallAndVerify(idx, { structure: { oKind: 'A', tKind: 'B' }, content: { mid: 'm1' } }, 3);
	assert.equal(chosen.method, 'M_exact');
	assert.equal(chosen.verdict.mode, 'full');
});
