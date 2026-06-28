'use strict';
/**
 * The C-CONTRACT UN-LEARN LOOP on the REAL engine (the conception's MOAT, §2/§6) — the belief-half companion of the
 * executor guard. A method whose learned typed contract is WRONG on a new case: its belief RETRACTS (JTMS), a typed
 * CONSTAT blame is deposited, and the library REVISES the contract (specialize the pre) so it no longer claims the
 * failing case — surgically (not method removal). Together with durable-contract.test.js: assume-compose /
 * assert-settle / retract-blame / revise, across both layers. The differentiator no RAG/skill-library can match:
 * principled un-learning (a stale skill stays retrievable; here the typed premise is IN the belief).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unlearn, FAST_APPROVE } = require('../../examples/poc/contract-unlearn.js');
console.log = console.info = console.warn = () => {};

test('a drifted method UN-LEARNS: belief retracts (JTMS) + blame + the library surgically revises the contract', async () => {
	const r = await unlearn();
	// 1 — initial: the method applies and its post holds (assertPost confirms on the realized facts)
	assert.equal(r.before.FastApprove, true, 'FastApprove casts on the in-policy case');
	assert.equal(r.before.decision, 'approve', 'and produces the approval');
	assert.equal(r.postCheck.ok, true, 'the contract post holds on the realized facts');
	// 2 — drift: a directly-ingested premise (compliant) falls → the BELIEF retracts (JTMS un-learn) + blame
	assert.equal(r.after.FastApprove, false, 'the FastApprove belief is WITHDRAWN (not left stale like a RAG hit)');
	assert.ok(r.blame, 'a typed constat blame was deposited on retraction');
	assert.equal(r.blame.claim, 'approve', 'blame names the claim that fell');
	assert.equal(r.blame.retractedBecause, 'compliant', 'blame names the premise that broke');
	// 3 — the library un-learned: the pre is specialized with the discriminating fact
	assert.deepEqual(r.revisedPre, ['score>=700', "$region!='EU'"], 'reviseOnBlame excluded the failing region');
	// 4 — SURGICAL: the revised contract excludes the failing kind, still admits the valid kind (not removed)
	assert.equal(r.selection.origAdmittedBoth, true, 'before: the over-general pre admitted both EU and US');
	assert.equal(r.selection.euExcluded, true, 'after: EU is excluded (the over-general claim is un-learned)');
	assert.equal(r.selection.usAdmitted, true, 'after: US is still admitted (surgical revision, not method removal)');
	// the original contract is not mutated (a new version — B8)
	assert.deepEqual(FAST_APPROVE.contract.pre, ['score>=700'], 'the original contract is untouched');
});
