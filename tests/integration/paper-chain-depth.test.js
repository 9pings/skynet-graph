'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — composition-DEPTH scaling, the deterministic regression for
 * `artifact/paper-dll/measure-chain-depth.js`. As a learned method chain gets deeper (L links), a surface
 * memory's COMPOUNDING DEPTH grows with L (CBR-L wrong at all L links on drift), while STRUCT-L stays correct
 * and its recovery DRIFT-TAX is O(1) in L (the cascade re-derives only link 1; downstream re-derivations are
 * elided by read-set keying). Each claim is paired with a negative control.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const D = require(ROOT + '/artifact/paper-dll/chain-depth.js');

const run = async ( w, name, model ) => D.CHAIN_ARMS[name](w, model || D.makeModel('stub'));

// ── instrumentation guard: NAIVE-L is correct at every link; a broken oracle is not (not vacuous) ──
test('NAIVE-L is perfect at every link under the stub; a broken oracle is not', async () => {
	const w = D.makeChainWorkload(3, { audited: [{ region: 'EU', kind: 'loan' }] });
	const good = D.score((await run(w, 'NAIVE-L')).A, w);
	assert.equal(good.allOk, true, 'NAIVE-L must be correct at every link/record under the stub');
	// NEG CONTROL: a broken oracle (always the positive label) must NOT be all-correct.
	const bad = D.score((await run(w, 'NAIVE-L', D.makeModel('stub', { oracleFn: ( p ) => D.posLabel(p.link) }))).A, w);
	assert.equal(bad.allOk, false, 'a broken oracle must fail the all-correct check');
});

// ── compounding scales with depth: CBR-L is wrong at ALL L links; STRUCT-L at none (neg control) ──
test('CBR-L compounding-depth == L (staleness scales with chain depth); STRUCT-L == 0', async () => {
	for ( const L of [1, 2, 3, 4] ) {
		const w = D.makeChainWorkload(L, { audited: [{ region: 'EU', kind: 'loan' }] });
		const cbr = D.score((await run(w, 'CBR-L')).A, w);
		const struct = D.score((await run(w, 'STRUCT-L')).A, w);
		assert.equal(cbr.compoundingDepth, L, `CBR-L must be stale at all ${L} links (got ${cbr.compoundingDepth})`);
		assert.equal(struct.compoundingDepth, 0, `STRUCT-L must be stale at no link (got ${struct.compoundingDepth})`);
		assert.equal(struct.allOk, true, `STRUCT-L must be correct at depth ${L}`);
	}
});

// ── STRUCT's recovery is O(1) in L: drift-tax constant (== 1) regardless of chain depth ──
test('STRUCT-L drift-tax is O(1) in L (constant == 1); a coarse re-derivation would be O(L)', async () => {
	const taxes = [];
	for ( const L of [1, 2, 3, 4, 5] ) {
		const w = D.makeChainWorkload(L, { audited: [{ region: 'EU', kind: 'loan' }] });
		const w0 = D.makeChainWorkload(L, { audited: [] });
		const tax = (await run(w, 'STRUCT-L')).calls - (await run(w0, 'STRUCT-L')).calls;
		taxes.push(tax);
	}
	assert.ok(taxes.every(( t ) => t === taxes[0] ), `STRUCT-L drift-tax must be constant in L; got ${taxes.join(',')}`);
	assert.equal(taxes[0], 1, `the constant drift-tax is the single re-derived upstream entry (got ${taxes[0]})`);
});

// ── STRUCT amortizes at every depth, while NAIVE/REFLEXION pay O(L·N) ──
test('STRUCT-L amortizes vs NAIVE-L at every depth; NAIVE/REFLEXION scale ~L·N', async () => {
	const naive = {}, struct = {};
	for ( const L of [1, 2, 3, 4, 5] ) {
		const w = D.makeChainWorkload(L, { audited: [{ region: 'EU', kind: 'loan' }] });
		naive[L] = (await run(w, 'NAIVE-L')).calls;
		struct[L] = (await run(w, 'STRUCT-L')).calls;
		assert.ok(struct[L] < naive[L], `STRUCT-L (${struct[L]}) must amortize vs NAIVE-L (${naive[L]}) at L=${L}`);
	}
	// NAIVE-L is exactly L·N (per-link, per-record), so it grows strictly with L.
	assert.ok(naive[5] > naive[1], 'NAIVE-L grows with chain depth');
	assert.equal(naive[2] - naive[1], naive[3] - naive[2], 'NAIVE-L grows linearly in L (constant per-link increment = N)');
});
