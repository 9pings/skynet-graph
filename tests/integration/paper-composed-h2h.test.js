'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the COMPOSED head-to-head, the deterministic regression for
 * `artifact/paper-dll/measure-composed-h2h.js`. The single-link #10 showed STRUCT is the unique
 * Pareto point for ONE method; this pins what happens across a learned METHOD CHAIN decide ->
 * disburse, where an upstream drift CASCADES. The decisive, HONEST claims:
 *   - STRUCT-2 recovers BOTH links selectively (the JTMS cascade; contract re-check in-engine = 0 calls);
 *   - a surface/coarse memory lets staleness COMPOUND (stale link 1 -> stale link 2) — the CBR-2 / blind
 *     ablations are wrong at BOTH links (the negative controls);
 *   - each named system CAN recover (fairest shot) but pays its mechanism tax MULTIPLIED down the chain;
 *   - STRUCT-REAL-2 (the actual engine) reproduces STRUCT-2 (the Map proxy is faithful here too).
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { COMPOSED_SURFACE_ARMS } = require(ROOT + '/artifact/paper-dll/composed-arms.js');
const { COMPOSED_NAMED_ARMS, makeFeedback } = require(ROOT + '/artifact/paper-dll/composed-named-arms.js');
const { STRUCT_REAL2_ARMS } = require(ROOT + '/artifact/paper-dll/struct-real-composed.js');
const W = require(ROOT + '/artifact/paper-dll/composed-workload.js');
const H = require(ROOT + '/artifact/paper-dll/composed-harness.js');

const ALL = Object.assign({}, COMPOSED_SURFACE_ARMS, COMPOSED_NAMED_ARMS, STRUCT_REAL2_ARMS);

function build( audited ) {
	const w = W.makeComposedWorkload({
		kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'], heldOutRegion: 'APAC',
		audited: audited != null ? audited : [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }],
		preCycles: 2, postCycles: 3,
	});
	w.feedback = makeFeedback(w);
	return w;
}
async function run( w, name ) {
	const env = { workload: w, model: H.makeModel('stub') };
	const res = await ALL[name](w.stream, env);
	return Object.assign({}, res, H.score(res, w));
}
async function runAll( w ) {
	const rows = {};
	for ( const name of Object.keys(ALL) ) rows[name] = await run(w, name);
	return rows;
}

// ── the composed instrumentation guard (#34) + its negative control ───────────────────────────────
test('composed self-test passes on both links; a broken oracle fails it (not vacuous)', async () => {
	const w = build();
	const st = await H.selfTest(w, COMPOSED_SURFACE_ARMS['NAIVE-2']);
	assert.equal(st.ok, true, 'composed NAIVE must be perfect on BOTH links under the stub');
	// NEG CONTROL: a deliberately broken oracle (always approve) must trip the self-test.
	const bad = await H.selfTest(w, COMPOSED_SURFACE_ARMS['NAIVE-2'], { oracleFn: () => 'approve' });
	assert.equal(bad.ok, false, 'a broken oracle must fail the composed self-test');
});

// ── the kill test: STRUCT-2 recovers BOTH links; CBR-2 (= STRUCT-2 − contract) COMPOUNDS ───────────
test('STRUCT-2 recovers both links + amortizes; CBR-2 compounds staleness at both (neg control)', async () => {
	const w = build();
	const s = await run(w, 'STRUCT-2'), cbr = await run(w, 'CBR-2'), naive = await run(w, 'NAIVE-2');
	// STRUCT-2 recovers the WHOLE chain on drift.
	assert.equal(s.driftAcc1, 1, 'STRUCT-2 recovers link 1 (decision) on drift');
	assert.equal(s.driftAcc2, 1, 'STRUCT-2 recovers link 2 (disbursement) on drift — the cascade');
	assert.equal(s.acc, 1, 'STRUCT-2 is end-to-end correct');
	assert.ok(s.calls < naive.calls, `STRUCT-2 amortizes vs NAIVE-2 (${s.calls} < ${naive.calls})`);
	// NEG CONTROL: drop the contract (= CBR-2) → the same typed key hits → STALE at BOTH links: compounding.
	assert.equal(cbr.driftAcc1, 0, 'CBR-2 is stale at link 1 (the contract is load-bearing)');
	assert.equal(cbr.driftAcc2, 0, 'CBR-2 is stale at link 2 — the staleness COMPOUNDS through the chain');
});

// ── faithfulness: the actual engine reproduces the Map proxy on calls AND both-link drift ──────────
test('STRUCT-REAL-2 (the actual engine) reproduces STRUCT-2 — the proxy is faithful', async () => {
	const w = build();
	const s = await run(w, 'STRUCT-2'), r = await run(w, 'STRUCT-REAL-2');
	assert.equal(r.driftAcc1, 1, 'engine recovers link 1');
	assert.equal(r.driftAcc2, 1, 'engine recovers link 2 (the JTMS cascade Disburse→Hold)');
	assert.equal(r.calls, s.calls, `engine call count reproduces the proxy (${r.calls} == ${s.calls})`);
});

// ── compounding: every surface/blind memory is stale at BOTH links (the staleness propagates) ──────
test('surface/blind memories compound: wrong at link 1 AND link 2', async () => {
	const w = build();
	for ( const name of ['CBR-2', 'MEMGPT-2-BLIND', 'REFLEXION-2-BLIND', 'GRAPHRAG-2'] ) {
		const r = await run(w, name);
		assert.ok(r.driftAcc1 < 1, `${name} is stale at link 1`);
		assert.ok(r.driftAcc2 < 1, `${name} compounds: also stale at link 2`);
	}
});

// ── the named systems CAN recover (fairest shot) but pay a tax that MULTIPLIES down the chain ──────
test('named systems recover both links at their fairest shot, but pay a chain-multiplied tax', async () => {
	const w = build();
	const s = await run(w, 'STRUCT-2');
	const m = await run(w, 'MEMGPT-2'), rf = await run(w, 'REFLEXION-2'), gr = await run(w, 'GRAPHRAG-2-REINDEX');
	for ( const [name, r] of [['MEMGPT-2', m], ['REFLEXION-2', rf], ['GRAPHRAG-2-REINDEX', gr]] ) {
		assert.equal(r.driftAcc1, 1, `${name} recovers link 1`);
		assert.equal(r.driftAcc2, 1, `${name} recovers link 2`);
		assert.ok(r.calls > s.calls, `${name} pays more calls than STRUCT-2 (${r.calls} > ${s.calls})`);
	}
	// Reflexion has NO memo → an actor call per record per link → calls ~ 2N (the chain multiplies the tax).
	assert.ok(rf.calls >= 2 * (w.meta.n - 1), `Reflexion-2 pays ~2N calls (per record per link): ${rf.calls}`);
	// MemGPT carries its core blob in every prompt at both links → a larger per-call context than STRUCT.
	assert.ok(m.maxContext > s.maxContext, `MemGPT-2 carries a larger context (${m.maxContext} > ${s.maxContext})`);
});

// ── the headline: STRUCT-2 is the UNIQUE Pareto-optimal point over the chain (4 corners) ───────────
test('STRUCT-2 is the unique Pareto-optimal arm across the chain (calls, drift1, drift2, ctx)', async () => {
	const w = build();
	const rows = await runAll(w);
	const s = rows['STRUCT-2'];
	assert.equal(s.driftAcc1, 1); assert.equal(s.driftAcc2, 1);
	const dominators = Object.keys(rows).filter(( n ) => !n.startsWith('STRUCT') ).filter(( n ) => {
		const r = rows[n];
		return r.calls <= s.calls && Math.abs(r.driftAcc1 - 1) < 1e-9 && Math.abs(r.driftAcc2 - 1) < 1e-9 && r.maxContext <= s.maxContext;
	});
	assert.deepEqual(dominators, [], `no arm should match-or-beat STRUCT-2 on all 4 corners; got: ${dominators.join(',')}`);
});

// ── selectivity: STRUCT-2's cascade re-derives ONLY the violated chain (blames = the audited classes) ──
test('STRUCT-2 evicts selectively: one blame per audited (score=high) class, not the whole class', async () => {
	const w = build();
	const env = { workload: w, model: H.makeModel('stub') };
	const res = await COMPOSED_SURFACE_ARMS['STRUCT-2'](w.stream, env);
	// two audited classes (EU|loan, US|wire); only their score=high cached approvals violate the post → 2 blames.
	assert.equal(res.blames.length, w.meta.audited.length,
		`STRUCT-2 evicts only the violated approvals (${res.blames.length} == ${w.meta.audited.length}), not the whole class`);
	// drift-tax in isolation: the cascade re-derives only the violated link-1 entry (reject) per audited class;
	// the link-2 "held" is ELIDED because it keys on the read-set {kind,region,decision} and reuses the
	// already-cached entry of the low-score sibling (same {k,r,reject}). So the chain cascade costs ONLY the
	// upstream re-derivation — drift-tax = the number of audited classes (not 2× for the chain).
	const w0 = build([]);
	const cold = await COMPOSED_SURFACE_ARMS['STRUCT-2'](w0.stream, { workload: w0, model: H.makeModel('stub') });
	const driftTax = res.calls - cold.calls;
	assert.equal(driftTax, w.meta.audited.length,
		`STRUCT-2 drift-tax = re-derive only the violated upstream entry per audited class; link 2 reuses the sibling (${driftTax} == ${w.meta.audited.length})`);
});
