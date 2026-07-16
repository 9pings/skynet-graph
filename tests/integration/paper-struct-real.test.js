'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4.1 — STRUCT-REAL: the head-to-head STRUCT arm backed by the ACTUAL engine (not a hand-written Map), closing
 * the E6 §6 "named-system fidelity" symmetry gap. It asserts (1) the real engine reproduces the Map STRUCT's
 * Pareto corner (so the Map arm is a faithful proxy, not an unfair stub), (2) a negative control — the engine
 * WITHOUT the ensure-gated defeasance goes stale, identical to CBR (the mechanism is load-bearing on the engine),
 * and (3) the moat: a SELECTIVE JTMS un-learn on an ingested premise-fall (no stale belief served), the thing a
 * similarity cache cannot do.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const fs = require('fs');
const os = require('os');
const { ARMS } = require(ROOT + '/artifact/paper-dll/arms.js');
const { STRUCT_REAL_ARMS, makeStructReal, unlearnDemo, composedCascadeDemo } = require(ROOT + '/artifact/paper-dll/struct-real.js');
const { createFileStore } = require(ROOT + '/lib/authoring/core/store.js');
const E = require(ROOT + '/artifact/paper-dll/workload.js');
const H = require(ROOT + '/artifact/paper-dll/harness.js');

const ALL = Object.assign({}, ARMS, STRUCT_REAL_ARMS);
function build() {
	return E.makeWorkload({ kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'], heldOutRegion: 'APAC',
		audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }], preCycles: 2, postCycles: 3 });
}
async function run( w, name ) {
	const env = { workload: w, model: H.makeModel('stub') };
	const res = await ALL[name](w.stream, env);
	return Object.assign({}, res, H.score(res.actions, w));
}

// ── (1) the real engine reproduces the Map STRUCT's Pareto corner ─────────────────────────────────
test('STRUCT-REAL (the actual engine) reproduces the Map STRUCT corner: amortized, correct-on-drift, bounded', async () => {
	const w = build();
	const map = await run(w, 'STRUCT'), real = await run(w, 'STRUCT-REAL');
	const N = w.meta.n;
	assert.equal(real.driftAcc, 1, 'STRUCT-REAL recovers on drift (selective defeasance on the engine)');
	assert.equal(real.acc, 1, 'and is overall correct');
	assert.ok(real.calls < N, `STRUCT-REAL amortizes vs naive (${real.calls} < ${N})`);
	// it MATCHES the Map STRUCT (the Map arm is a faithful proxy, not an unfair stub) — same calls, drift, ~ctx.
	assert.equal(real.calls, map.calls, `engine calls == Map STRUCT calls (${real.calls} == ${map.calls})`);
	assert.equal(real.driftAcc, map.driftAcc);
	assert.ok(Math.abs(real.maxContext - map.maxContext) <= 16, `engine maxCtx ≈ Map STRUCT (${real.maxContext} ~ ${map.maxContext})`);
});

// ── (2) negative control: the engine WITHOUT the defeasance gate goes stale (= CBR) ───────────────
test('STRUCT-REAL-FLAT (no ensure-gated defeasance) is stale on drift, identical to CBR — the gate is load-bearing', async () => {
	const w = build();
	const flat = await run(w, 'STRUCT-REAL-FLAT'), cbr = await run(w, 'CBR'), real = await run(w, 'STRUCT-REAL');
	assert.ok(flat.driftAcc < 1, 'without the ensure-gate the engine serves stale on drift');
	assert.ok(flat.driftAcc < real.driftAcc, 'and is strictly worse on drift than the defeasible STRUCT-REAL');
	// the flat engine reproduces CBR's exact failure (stale + same amortized calls) — so what STRUCT-REAL adds
	// over a plain typed cache is precisely the defeasance, on the real engine.
	assert.equal(flat.driftAcc, cbr.driftAcc, 'flat engine drift-acc == CBR');
	assert.equal(flat.calls, cbr.calls, `flat engine calls == CBR (${flat.calls} == ${cbr.calls})`);
});

// ── (3) the moat: selective JTMS un-learn on an ingested premise-fall ──────────────────────────────
test('STRUCT-REAL un-learns SELECTIVELY: an ingested premise-fall retracts only the violated belief (JTMS)', async () => {
	const { before, after } = await unlearnDemo();
	assert.equal(before.a1, 'approve'); assert.equal(before.a2, 'approve');
	assert.equal(before.a1Approve, true, 'a1 starts as an Approve belief');
	// ingest(a1 compliant=false): a1's ApproveDecision belief RETRACTS (no stale belief served) and it flips.
	assert.equal(after.a1, 'reject', 'a1 flips to reject');
	assert.equal(after.a1Approve, false, 'a1 ApproveDecision belief is UN-CAST (JTMS un-learn)');
	assert.equal(after.a1Reject, true, 'a1 now casts RejectDecision');
	// the sibling of the SAME class, NOT ingested, is untouched (SELECTIVE — not a coarse whole-class flush).
	assert.equal(after.a2, 'approve', 'a2 (same class, not audited) stays approved');
	assert.equal(after.a2Approve, true);
	assert.equal(after.driftCalls, 1, 'only the violated entry re-derives (selective): exactly 1 model call');
});

// ── (4) M4.2 — cross-restart persistence: a 2nd "process" replays the warm library at 0 model calls ──
test('STRUCT-REAL persists cross-restart: a fresh process on the same file replays the library at 0 calls', async () => {
	const w = build();
	const env = { workload: w, model: H.makeModel('stub') };
	const tmp = path.join(os.tmpdir(), 'sg-struct-real-persist.json');
	const cold = path.join(os.tmpdir(), 'sg-struct-real-cold.json');
	for ( const f of [tmp, cold] ) { try { fs.unlinkSync(f); } catch ( e ) {} }
	try {
		// process 1 — cold: warms the FILE-backed derivation cache.
		const r1 = await makeStructReal({ store: createFileStore(tmp) })(w.stream, env);
		assert.ok(r1.calls > 0, 'process 1 pays cold derivations');
		// process 2 — a restart: a FRESH arm + a FRESH store re-hydrated from the same file → 0 model calls.
		const r2 = await makeStructReal({ store: createFileStore(tmp) })(w.stream, env);
		assert.equal(r2.calls, 0, `the warm library replays at 0 calls cross-restart (got ${r2.calls})`);
		const s2 = H.score(r2.actions, w);
		assert.equal(s2.acc, 1, 'and the persisted decisions are still correct');
		assert.equal(s2.driftAcc, 1, 'including on drift');
		// NEG CONTROL: a FRESH file (no persisted library) pays the cold cost again — persistence is load-bearing.
		const r3 = await makeStructReal({ store: createFileStore(cold) })(w.stream, env);
		assert.equal(r3.calls, r1.calls, `a cold (fresh-file) process pays the same as process 1 (${r3.calls} == ${r1.calls})`);
	} finally { for ( const f of [tmp, cold] ) { try { fs.unlinkSync(f); } catch ( e ) {} } }
});

// ── (5) M4.3 — composition under drift: a premise-fall cascades through the learned chain (the unique capability) ──
test('STRUCT-REAL cascades through a composed chain on drift, selectively — staleness a flat cache compounds', async () => {
	const { before, after, flatAfter } = await composedCascadeDemo();
	// before: both cases approved AND disbursed (the full chain cast).
	for ( const c of [before.a1, before.a2] ) {
		assert.equal(c.decision, 'approve'); assert.equal(c.disbursement, 'disbursed');
		assert.equal(c.Disburse, true); assert.equal(c.Hold, false);
	}
	// after the audit on a1: the WHOLE a1 chain cascades — upstream retracts (decision→reject) AND the downstream
	// un-casts (Disburse false, Hold true → disbursement→held). The JTMS un-learned the entire derivation.
	assert.equal(after.a1.decision, 'reject', 'upstream retracts');
	assert.equal(after.a1.Disburse, false, 'downstream Disburse UN-CASTS (the cascade)');
	assert.equal(after.a1.Hold, true, 'and Hold casts');
	assert.equal(after.a1.disbursement, 'held', 'the downstream outcome flips too');
	// SELECTIVE: a2 (same class, not audited) keeps its whole chain.
	assert.equal(after.a2.decision, 'approve'); assert.equal(after.a2.disbursement, 'disbursed');
	assert.equal(after.a2.Disburse, true);
	// CONTRAST (neg control): a flat similarity cache serves the STALE pair at BOTH links — staleness compounds.
	assert.equal(flatAfter.decision, 'approve', 'a flat cache is stale at the decision link');
	assert.equal(flatAfter.disbursement, 'disbursed', 'AND stale at the disbursement link (compounded)');
});
