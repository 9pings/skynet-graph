'use strict';
/**
 * §3.1 — the STANDING / autonomous C-contract un-learn loop, on the real engine (no LLM).
 *
 * The host-orchestrated `contract-unlearn.js` did steps 3-4 (reviseOnBlame + the gate
 * narrowing) in plain host JS. Here the ENGINE drives blame → revise → patch as reactive
 * concepts at the stabilize fixpoint: a `Lib::blame` cleaner deposits a discrete `blamed`
 * fact on the method's library node, a `Revise` meta-concept (`require:['blamed']`) fires on
 * its appearance (#22-safe), and `Lib::revise` narrows BOTH the library contract
 * (reviseOnBlame) AND the engine gate (queued patchConcept, #11.a) — autonomously, inside one
 * `ingest().then(settle)`, with NO host revise call.
 *
 * The moat no RAG / CBR / skill-library has: principled, surgical, autonomous un-learning.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relearn } = require('../../examples/poc/contract-relearn.js');

test('§3.1 autonomy: the engine ALONE narrows the library contract + the gate on drift (no host revise)', async () => {
	const r = await relearn({ loopOn: true });

	// the JTMS un-learn fired and deposited the blame trigger.
	assert.equal(r.after.app1, false, 'app1 belief retracted (JTMS un-learn) on the fallen premise');
	assert.equal(r.after.blamed, true, 'the cleaner deposited a discrete `blamed` fact on lib:FastApprove');
	assert.ok((r.after.lessons || []).length >= 1, 'a typed constat was deposited on mem');
	assert.equal(r.after.lessons[0].kind, 'FastApprove', 'the constat names the retracted method');

	// the AUTONOMOUS revise: the engine narrowed the gate AND the library contract, no host call.
	assert.equal(r.after.revised, true, 'the Revise meta-concept cast (revised guard set)');
	assert.ok(r.after.ensure.indexOf("$region!='EU'") >= 0, 'the engine gate (ensure) was narrowed to exclude EU');
	assert.deepEqual(r.after.registryPre, ['score>=700', "$region!='EU'"], 'the library contract pre was narrowed (reviseOnBlame)');

	// no oscillation: the `revised` guard + the tightened gate stop the loop.
	assert.equal(r.after.divergent, null, 'no divergence (the loop converged, not apply-capped)');
});

test('§3.1 neg control: WITHOUT the reactive loop the stale over-general method re-serves the excluded case', async () => {
	const on  = await relearn({ loopOn: true });
	const off = await relearn({ loopOn: false });

	// a fresh EU app arriving AFTER the audit:
	assert.equal(on.after.app2, false, 'ON: the narrowed gate EXCLUDES the fresh EU app (the library un-learned)');
	assert.equal(off.after.app2, true, 'OFF: the un-revised gate STILL casts on the fresh EU app (stale re-served)');

	// and OFF leaves the gate / contract untouched (blame alone, without the reactive revise, learns nothing).
	assert.ok(off.after.ensure.indexOf("$region!='EU'") < 0, 'OFF: the gate was never narrowed');
	assert.deepEqual(off.after.registryPre, ['score>=700'], 'OFF: the library contract was never revised');
	assert.equal(off.after.blamed, true, 'OFF: the blame WAS still deposited (only the reactive revise is missing)');
});

test('§3.1 surgical: narrowing excludes the failing kind but PRESERVES the valid kind (not method removal)', async () => {
	const r = await relearn({ loopOn: true });

	assert.equal(r.after.usApp, true, 'the US app stays cast after the revise (valid kind preserved)');
	assert.equal(r.selection.euExcluded, true, 'the revised library contract excludes a fresh EU case');
	assert.equal(r.selection.usAdmitted, true, 'the revised library contract still admits a US case');
});
