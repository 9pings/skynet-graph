'use strict';
/**
 * #12 — the static bits-based MDL admission objective (the §4.2-A pre-filter/ranker).
 * Claims (all RELATIVE — same corpus, vary one factor; the absolute structConst only places
 * the boundary, per the plan's "ordinal-first"):
 *   1. a FREQUENT chain with a small production admits (ΔL<0);
 *   2. the SAME chain at count=1 rejects (rarity — savedBits too small);          [neg control]
 *   3. the SAME frequent chain with a FAT production rejects (the Minton/Lari-Young match-cost
 *      tax + encode cost outweigh the savings).                                    [neg control]
 *   4. rankCandidates orders by ΔL (best refactor first).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mdlGain, rankCandidates, schemaBits, symbolsOf, conceptCountOf } = require('../../lib/authoring/core/mdl.js');

// a fixed corpus: N=16 single-fact provider concepts, R=30 firings, an alphabet Σ.
function corpus( N, R ) {
	const child = {};
	for ( let i = 0; i < N; i++ ) child['C' + i] = { _id: 'C' + i, _name: 'C' + i, require: ['f' + i], provider: ['P::p' + i] };
	const tree = { childConcepts: child };
	const alphabet = { knownFacts: Array.from({ length: N + 8 }, (_, i) => 'f' + i), palette: ['P::p'] };
	const records = Array.from({ length: R }, (_, i) => ({ concept: 'C' + (i % N), target: 't' + i }));
	return { tree, alphabet, records };
}

const SMALL = { _id: 'M', _name: 'M', require: ['f0'], provider: ['P::m'] };
const FAT = { _id: 'M', _name: 'M', require: ['f0', 'f1', 'f2', 'f3', 'f4', 'f5'],
	ensure: ['$f0>0', '$f1>0', '$f2>0', '$f3>0'], applyMutations: { a: 1, b: 2, c: 3, d: 4, e: 5 }, provider: ['P::m'] };

test('#12 a frequent chain with a small production admits (ΔL<0)', () => {
	const { tree, alphabet, records } = corpus(16, 30);
	const g = mdlGain({ chain: { from: 'C0', to: 'C1', via: 'f1', count: 5 }, tree, records, alphabet, abstractSchema: SMALL });
	assert.equal(g.admit, true, 'count=5 small production should admit');
	assert.ok(g.deltaL < 0, 'ΔL must be negative');
	assert.ok(g.savedBits > g.encodeBits + g.taxBits, 'savings outweigh encode+tax');
});

test('#12 NEG CONTROL (rarity): the SAME chain at count=1 rejects', () => {
	const { tree, alphabet, records } = corpus(16, 30);
	const g = mdlGain({ chain: { from: 'C0', to: 'C1', via: 'f1', count: 1 }, tree, records, alphabet, abstractSchema: SMALL });
	assert.equal(g.admit, false, 'count=1 is too rare to amortize the new production');
	assert.ok(g.deltaL > 0, 'ΔL positive — savings (1 firing) cannot pay the encode + tax');
});

test('#12 NEG CONTROL (Minton tax): a frequent chain with a FAT production rejects', () => {
	const { tree, alphabet, records } = corpus(16, 30);
	const g = mdlGain({ chain: { from: 'C0', to: 'C1', via: 'f1', count: 5 }, tree, records, alphabet, abstractSchema: FAT });
	assert.equal(g.admit, false, 'a big schema costs more to encode than it saves');
	assert.ok(symbolsOf(FAT) > symbolsOf(SMALL), 'the FAT production really has more symbols');
	assert.ok(g.encodeBits > g.savedBits, 'encode alone already outweighs the savings');
});

test('#12 rankCandidates orders by ΔL (best refactor first)', () => {
	const { tree, alphabet, records } = corpus(16, 30);
	const chains = [
		{ from: 'C0', to: 'C1', via: 'f1', count: 1 },   // rare → worst
		{ from: 'C2', to: 'C3', via: 'f3', count: 8 },   // frequent → best
		{ from: 'C4', to: 'C5', via: 'f5', count: 4 },   // middling
	];
	const ranked = rankCandidates(chains, { tree, records, alphabet });
	assert.equal(ranked[0].count, 8, 'the most-amortizing chain ranks first');
	assert.equal(ranked[ranked.length - 1].count, 1, 'the rare chain ranks last');
	for ( let i = 1; i < ranked.length; i++ )
		assert.ok(ranked[i - 1].mdl.deltaL <= ranked[i].mdl.deltaL, 'ΔL is non-decreasing');
});

test('#12 schemaBits/symbolsOf read the auditable schema spine', () => {
	assert.equal(symbolsOf(SMALL), 2, 'one require + one provider');
	assert.ok(schemaBits(FAT, { knownFacts: [], conceptNames: [], palette: [] }) > schemaBits(SMALL, { knownFacts: [], conceptNames: [], palette: [] }),
		'a richer schema costs more bits');
	assert.equal(conceptCountOf({ childConcepts: { A: { _name: 'A' }, B: { _name: 'B' } } }), 2);
});
