'use strict';
/**
 * G-1 rung 2 — the BORDERLINE-ONLY LLM gate (wiseways pattern; the "ask the librarian" LAST resort). Deterministic
 * mechanism tests over a STUBBED `ask` (no model): the gate fires ONLY on a genuine barrier MISS, re-canonicalizes the
 * model's answer through the SAME spec (so a hallucination becomes a miss, never raw prose), and returns a PROVISIONAL
 * member + a propose-only ring entry — never mutating the spec, never a cacheable merge. Each claim has a negative control.
 * A separate gitignored live arm exercises it on the embedded 3B (`makeLocalAsk`); the mechanism here is model-free.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBorderlineSnap, borderlineFacts, enumGbnf, pickMember } = require('../../lib/providers/borderline');

const SEV = { enum: ['low', 'high'], synonyms: { high: ['severe'], low: ['minor'] } };

test('the model is NEVER called when the deterministic barrier already resolves (member OR ring)', async () => {
	let called = 0;
	const snap = makeBorderlineSnap({ ask: async () => { called++; return 'high'; } });
	assert.deepEqual(await snap('high', SEV), { value: 'high' }, 'a direct member resolves deterministically');
	assert.deepEqual(await snap('severe', SEV), { value: 'high', via: 'synonym' }, 'a ring alias resolves deterministically');
	assert.equal(called, 0, 'the model was not consulted for anything the barrier handles (LAST resort)');
});

test('on a genuine MISS, the model is consulted → a PROVISIONAL member + a propose-only ring entry', async () => {
	let called = 0;
	const snap = makeBorderlineSnap({ ask: async () => { called++; return 'high'; } });
	const r = await snap('catastrophic', SEV);
	assert.equal(called, 1, 'the model fired only for the out-of-vocab term');
	assert.equal(r.value, 'high');
	assert.equal(r.via, 'llm-borderline');
	assert.equal(r.provisional, true, 'PROVISIONAL — the caller must treat it as un-cacheable (no reusable digest)');
	assert.deepEqual(r.proposal, { alias: 'catastrophic', member: 'high' }, 'a candidate ring entry for validation (propose-only)');
});

test('RE-CANONICALIZATION — a hallucinated non-member answer becomes a MISS (never raw prose on the edge)', async () => {
	const snap = makeBorderlineSnap({ ask: async () => 'extreme' });   // 'extreme' is neither a member nor a ring alias
	const r = await snap('catastrophic', SEV);
	assert.equal(r.miss, true, 'the model picked a non-member → snapped to a miss (fail-closed)');
	assert.ok(!r.provisional, 'no provisional value from a hallucination');
});

test('a "none" answer stays a MISS (→ the host CanonMiss escalation, as today)', async () => {
	const snap = makeBorderlineSnap({ ask: async () => 'none' });
	assert.equal((await snap('banana', SEV)).miss, true);
});

test('token-scan — a FREE-TEXT answer is still resolved through the barrier (robust to an unconstrained model)', async () => {
	const snap = makeBorderlineSnap({ ask: async () => "I'd say it's high, definitely." });
	const r = await snap('catastrophic', SEV);
	assert.equal(r.value, 'high', 'the member token is extracted and re-canonicalized');
	assert.equal(r.via, 'llm-borderline');
});

test('token-scan resolves a model reply that is itself a ring ALIAS', async () => {
	const snap = makeBorderlineSnap({ ask: async () => 'severe' });     // model replies with a known alias
	assert.equal((await snap('dire', SEV)).value, 'high', 'alias in the reply → member via the ring');
});

test('enumGbnf — constrained-decoding grammar restricts the reply to a member or none', () => {
	assert.equal(enumGbnf(SEV), 'root ::= "low" | "high" | "none"');
});

test('pickMember is null on an unresolvable reply (the miss signal)', () => {
	assert.equal(pickMember('whatever', SEV), null);
	assert.equal(pickMember('high', SEV), 'high');
});

test('borderlineFacts — batch: in-vocab keys are direct, misses are borderline-snapped, proposals collected', async () => {
	const schema = { sev: SEV, kind: { enum: ['bug', 'feature'] } };
	// sev='severe' resolves via the ring (no model); kind='defect' misses → the model snaps it to 'bug'.
	const snap = makeBorderlineSnap({ ask: async () => 'bug' });
	const r = await borderlineFacts({ sev: 'severe', kind: 'defect' }, schema, snap);
	assert.equal(r.facts.sev, 'high', 'ring-resolved deterministically');
	assert.equal(r.facts.kind, 'bug', 'borderline-snapped provisionally');
	assert.deepEqual(r.borderline, [{ key: 'kind', raw: 'defect', member: 'bug' }]);
	assert.deepEqual(r.proposals, [{ key: 'kind', alias: 'defect', member: 'bug' }]);
	assert.deepEqual(r.misses, [], 'the borderline snap cleared the miss for this run');
	assert.deepEqual(r.synonyms, [{ key: 'sev', raw: 'severe', member: 'high' }], 'the deterministic ring audit trail is preserved');
});

test('borderlineFacts NEG — a genuinely unresolvable miss STAYS a miss (fail-closed, not vacuous)', async () => {
	const snap = makeBorderlineSnap({ ask: async () => 'none' });
	const r = await borderlineFacts({ sev: 'xyzzy' }, { sev: SEV }, snap);
	assert.deepEqual(r.misses, ['sev'], 'still out-of-vocab → remains a fail-closed miss');
	assert.deepEqual(r.borderline, []);
});
