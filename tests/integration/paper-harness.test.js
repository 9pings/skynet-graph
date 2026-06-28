'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E2 (the DECISIVE kill test) + the harness SELF-TEST, deterministic STUB. The live qwen run lives in
 * `artifact/paper-dll/measure-e2-live.js`; this is the reproducible regression artifact.
 *
 * Kill-criterion (paper §E2): STRUCT must beat the best baseline on CORRECT-ON-DRIFT decisively, while
 * amortizing calls and keeping per-call context bounded — else the paper is dead. The −contract ablation
 * (CBR = STRUCT minus the defeasible contract) must go STALE, proving the contract is load-bearing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../artifact/paper-dll/workload.js');
const H = require('../../artifact/paper-dll/harness.js');

function buildWorkload() {
	return E.makeWorkload({ audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }],
		heldOutRegion: 'APAC', preCycles: 2, postCycles: 2 });
}
const by = ( results ) => Object.fromEntries(results.map(( r ) => [r.name, r]));

test('P1a: the workload is paper-grade (N>=50, recurrent, held-out, real drift)', () => {
	const w = buildWorkload();
	assert.ok(w.meta.n >= 50, `N=${w.meta.n} >= 50`);
	assert.ok(w.meta.driftCases > 0, `drift cases present (${w.meta.driftCases})`);
	assert.equal(w.meta.heldOutRegion, 'APAC');
	assert.ok(w.meta.trainClasses < w.meta.classes, 'a class set is held out of training');
});

test('P1a: harness SELF-TEST passes — NAIVE is perfect under the stub (the #34 instrumentation guard)', async () => {
	const st = await H.selfTest(buildWorkload());
	assert.ok(st.ok, st.reason);
	assert.equal(st.naive.acc, 1);
	assert.equal(st.naive.driftAcc, 1);
});

test('P1a: NEGATIVE CONTROL — a broken oracle makes the self-test FAIL (it is not vacuous)', async () => {
	const broken = await H.selfTest(buildWorkload(), { oracleFn: () => 'approve' });   // always-approve = wrong post-audit
	assert.equal(broken.ok, false, 'a miswired oracle must be caught');
	assert.ok(broken.naive.driftAcc < 1, 'always-approve is stale on the drift cases');
});

test('E2: drift recovery needs an INVALIDATION hook; the typed contract adds SELECTIVITY + generality', async () => {
	const w = buildWorkload();
	const model = H.makeModel('stub');
	const { results } = await H.runCampaign({ workload: w, model });
	const a = by(results);

	// (1) vanilla similarity caches (recall-only, no re-validation) serve STALE on drift.
	for ( const stale of ['RAG', 'CBR', 'SKILL'] )
		assert.equal(a[stale].driftAcc, 0, `${stale} (no invalidation) serves STALE on every flipped case`);

	// (2) HONEST framing: BOTH an invalidation-equipped cache AND STRUCT recover -> recovery comes from the
	//     invalidation HOOK, not from the typed contract per se. STRUCT is NOT the only correct-on-drift arm.
	assert.equal(a.INVALIDATING.driftAcc, 1, 'a cache WITH an invalidation hook also recovers on drift');
	assert.equal(a.STRUCT.driftAcc, 1, 'STRUCT recovers on drift');

	// (3) what the TYPED CONTRACT adds over a coarse hand-coded class-callback = SELECTIVITY: STRUCT re-asserts
	//     the post per entry and evicts ONLY the violated (approve) ones, so it pays FEWER re-derivations than the
	//     callback that drops the whole class. (Generality + composition-safety are shown separately in E3.)
	assert.ok(a.STRUCT.calls <= a.INVALIDATING.calls,
		`STRUCT selective eviction ≤ coarse callback (${a.STRUCT.calls} vs ${a.INVALIDATING.calls})`);
	assert.equal(a.STRUCT.blames.length, 2, 'STRUCT evicts only the 2 post-violated (approve) audited classes');

	// (4) the −invalidation ABLATION: CBR (STRUCT's typed key, but no re-validation) is stale -> the invalidation
	//     mechanism is necessary; a typed key alone does not recover.
	assert.equal(a.CBR.driftAcc, 0, 'typed key WITHOUT re-validation is stale -> invalidation is load-bearing');

	// (5) AMORTIZATION: both recovering arms stay far below the re-derive-every-time arms.
	assert.ok(a.STRUCT.calls < a.NAIVE.calls / 2, `STRUCT amortizes (${a.STRUCT.calls} << naive ${a.NAIVE.calls})`);
	assert.ok(a.RAG.calls > a.CBR.calls, 'surface key (incl. incidental tier) amortizes WORSE than the typed key');

	// (6) BOUNDED CONTEXT: STRUCT per-call context is constant; long-context grows O(N).
	assert.ok(a.STRUCT.maxContext < a['LONG-CONTEXT'].maxContext / 2,
		`STRUCT bounded per-call context (${a.STRUCT.maxContext}) << long-context (${a['LONG-CONTEXT'].maxContext})`);

	// (7) the correct-and-costly arms confirm the ceiling: naive & long-context perfect but expensive.
	assert.equal(a.NAIVE.driftAcc, 1); assert.equal(a['LONG-CONTEXT'].driftAcc, 1); assert.equal(a.NAIVE.acc, 1);
});

test('E2: STRUCT amortization is SOUND — a held-out (novel) class still pays its own derivation', async () => {
	// the held-out APAC classes are unseen pre-audit; STRUCT must derive them (no false replay), so its
	// call count strictly exceeds the pure pre-audit warm set. This guards against a vacuous "0 calls" memo.
	const w = buildWorkload();
	const { results } = await H.runCampaign({ workload: w, model: H.makeModel('stub'), armNames: ['STRUCT'] });
	assert.ok(results[0].calls >= w.meta.trainClasses, 'STRUCT derives the warm set + novel held-out classes');
	assert.equal(results[0].driftAcc, 1);
});
