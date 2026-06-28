'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * #10 — the head-to-head vs the NAMED agent-memory systems (MemGPT / Reflexion / GraphRAG), the
 * deterministic regression for `artifact/paper-dll/measure-named-h2h.js`. Each named system gets its
 * FAIREST shot (the headline arm) AND a paired ablation (the negative control: turn the distinctive
 * mechanism off → it goes stale). The decisive, HONEST claim: given its fairest shot each named
 * system CAN recover on drift, but only STRUCT recovers at (lowest calls) ∧ (correct) ∧ (minimal
 * bounded context) — the unique Pareto-optimal point — because its contract re-assertion is
 * in-engine (0 extra LLM calls) and SELECTIVE, where each named system pays a mechanism tax.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { ARMS } = require(ROOT + '/artifact/paper-dll/arms.js');
const { NAMED_ARMS, makeFeedback } = require(ROOT + '/artifact/paper-dll/named-arms.js');
const E = require(ROOT + '/artifact/paper-dll/workload.js');
const H = require(ROOT + '/artifact/paper-dll/harness.js');

const ALL = Object.assign({}, ARMS, NAMED_ARMS);

function build( audited ) {
	const w = E.makeWorkload({
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
	return Object.assign({}, res, H.score(res.actions, w));
}
async function runAll( w ) {
	const rows = {};
	for ( const name of Object.keys(ALL) ) rows[name] = await run(w, name);
	return rows;
}

// ── the instrumentation guard (#34) + its negative control ──────────────────────────────────────
test('harness self-test passes; a broken oracle fails it (the test is not vacuous)', async () => {
	const w = build();
	const st = await H.selfTest(w);
	assert.equal(st.ok, true, 'NAIVE must be perfect under the stub');
	// NEG CONTROL: a deliberately broken oracle (always approve) must make the self-test FAIL.
	const bad = await H.selfTest(w, { oracleFn: () => 'approve' });
	assert.equal(bad.ok, false, 'a broken oracle must trip the self-test');
});

// ── MemGPT: fairest shot recovers (coarse) at a paging + over-eviction + context tax ──────────────
test('MEMGPT recovers on drift (paged audit) but pays calls+context; blind ablation goes stale', async () => {
	const w = build();
	const s = await run(w, 'STRUCT'), m = await run(w, 'MEMGPT'), blind = await run(w, 'MEMGPT-BLIND');
	assert.equal(m.driftAcc, 1, 'MemGPT (fairest shot) recovers on drift');
	assert.equal(m.acc, 1, 'and is overall correct');
	// NEG CONTROL: without surfacing/paging the audit, MemGPT serves stale (the paging is load-bearing).
	assert.ok(blind.driftAcc < 1, 'MEMGPT-BLIND must be stale on drift');
	// the tax vs STRUCT: more calls (paging + coarse over-eviction) AND larger per-call context (core blob).
	assert.ok(m.calls > s.calls, `MemGPT pays more calls than STRUCT (${m.calls} > ${s.calls})`);
	assert.ok(m.maxContext > s.maxContext, `MemGPT carries a larger context than STRUCT (${m.maxContext} > ${s.maxContext})`);
});

// ── Reflexion: steelman recovers but has NO memo → a call per record (the decisive low-calls gap) ──
test('REFLEXION recovers on drift but pays ~N calls (no memo); blind ablation goes stale', async () => {
	const w = build();
	const s = await run(w, 'STRUCT'), r = await run(w, 'REFLEXION'), blind = await run(w, 'REFLEXION-BLIND');
	const N = w.meta.n;
	assert.equal(r.driftAcc, 1, 'Reflexion (steelman) recovers on drift');
	// NEG CONTROL: with no failure signal surfaced, Reflexion has nothing to reflect on → stale.
	assert.ok(blind.driftAcc < 1, 'REFLEXION-BLIND must be stale on drift');
	// the decisive gap: no content-addressed memo → an Actor call per record → calls ≥ N ≫ STRUCT.
	assert.ok(r.calls >= N, `Reflexion pays at least one call per record (${r.calls} ≥ ${N})`);
	assert.ok(r.calls > 3 * s.calls, `Reflexion pays far more calls than STRUCT (${r.calls} ≫ ${s.calls})`);
});

// ── GraphRAG: offline index is blind to the silent audit → stale; recovery needs a BATCH re-index ──
test('GRAPHRAG is stale on drift by default; re-index recovers but at a batch tax', async () => {
	const w = build();
	const s = await run(w, 'STRUCT'), g = await run(w, 'GRAPHRAG'), re = await run(w, 'GRAPHRAG-REINDEX');
	// the offline community summaries cannot see the exogenous audit → stale (the load-bearing weakness).
	assert.ok(g.driftAcc < 1, 'GraphRAG (offline index) is stale on drift');
	assert.ok(g.calls > s.calls, `GraphRAG pays index-build + per-query generation (${g.calls} > ${s.calls})`);
	// the fairest shot: an operator-triggered batch re-summary recovers, but costs a batch and is coarse.
	assert.equal(re.driftAcc, 1, 'GRAPHRAG-REINDEX recovers on drift');
	assert.ok(re.calls > s.calls, `re-index recovery still costs far more than STRUCT (${re.calls} > ${s.calls})`);
});

// ── the headline: STRUCT is the UNIQUE Pareto-optimal point on (calls, correct-on-drift, context) ──
test('STRUCT is the unique Pareto-optimal arm: no arm matches-or-beats it on all three corners', async () => {
	const w = build();
	const rows = await runAll(w);
	const s = rows.STRUCT;
	assert.equal(s.driftAcc, 1); assert.equal(s.acc, 1);
	const dominators = Object.keys(rows).filter(( n ) => n !== 'STRUCT' ).filter(( n ) => {
		const r = rows[n];
		return r.calls <= s.calls && Math.abs(r.driftAcc - 1) < 1e-9 && r.maxContext <= s.maxContext;
	});
	assert.deepEqual(dominators, [], `no arm should match-or-beat STRUCT on all 3 corners; got: ${dominators.join(',')}`);
	// and STRUCT genuinely amortizes (beats naive on calls) — the test is not trivially satisfied.
	assert.ok(s.calls < rows.NAIVE.calls, 'STRUCT amortizes vs NAIVE');
});

// ── selectivity: STRUCT's recovery (re-derive only the violated entries) is cheaper than the coarse
//    named-system recoveries (drift-tax = calls on the drifting stream − calls on a no-drift twin). ──
test('STRUCT recovers more selectively than the named systems (smallest drift-tax)', async () => {
	const w = build(), w0 = build([]);                       // w0 = a no-drift twin (no audit)
	const driftTax = async ( name ) => (await run(w, name)).calls - (await run(w0, name)).calls;
	const sTax = await driftTax('STRUCT');
	const mTax = await driftTax('MEMGPT');
	assert.ok(sTax > 0, 'STRUCT does re-derive the evicted (violated) entries');
	// STRUCT re-derives only the violated (approve) entries; MemGPT coarsely re-decides the whole flagged
	// class (high AND low) + pays paging → a strictly larger drift-tax. (The contract check itself = 0 LLM calls.)
	assert.ok(mTax > sTax, `MemGPT's coarse recovery costs more than STRUCT's selective one (${mTax} > ${sTax})`);
	// and STRUCT's drift-tax is small in absolute terms — it equals the number of violated cached entries.
	assert.ok(sTax <= w.meta.audited.length, `STRUCT re-derives ≤ one entry per audited class (${sTax} ≤ ${w.meta.audited.length})`);
});
