'use strict';
/**
 * The C-CONTRACT GUARD in the DURABLE EXECUTOR — the §2 defeasible contract's "assert-at-runtime" in the EXECUTE
 * layer (unifies `plugins/durable/lib/` + `lib/authoring/contract.js`). A method's per-step contract is enforced as cases
 * flow: the post is asserted AFTER the task output but BEFORE commit (the adversary's #3); a violation quarantines
 * the token (fail + blame, a seed of C-fail) and is NOT memoized. Negative controls throughout.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../examples/poc/durable-contract.js');

test('GUARD: a violating case is quarantined with blame; sound cases flow; NO downstream commit (assert-before-commit)', async () => {
	const r = await G.guardRun();
	assert.equal(r.blamed, 1, 'exactly the out-of-range case is blamed');
	assert.deepEqual(r.done.map(( d ) => d.rec ).sort(), ['ok', 'ok2'], 'the sound cases reach done');
	assert.equal(r.failed.length, 1, 'the violating case is dead-lettered');
	assert.match(r.failed[0].reason, /post-violated/, 'with a contract blame reason');
	// the KEY claim: the violation was caught BEFORE the downstream step ran (no irreversible commit on a bad post)
	assert.equal(r.badReachedLabel, false, 'the quarantined case never reached the downstream commit');
});

test('MEMO-SOUND: a violating fresh output is NOT cached (re-call + re-blame); a sound case replays at 0', async () => {
	const m = await G.memoSoundness();
	assert.equal(m.blamed, 2, 'both identical bad cases are blamed (no false replay of a bad result)');
	assert.equal(m.scoreCalls, 3, 'bad×2 each re-call (not cached) + ok cached once (the 2nd ok replays) = 3');
	assert.ok(m.memoHits >= 1, 'the sound repeat DID replay from the memo (caching still works for good results)');
	assert.equal(m.done, 2, 'only the sound cases complete');
});

test('G1 frame-completeness in-flow: a body writing an UNDECLARED key is blamed', async () => {
	const f = await G.frameGuard();
	assert.equal(f.blamed, 1, 'the undeclared write is caught at runtime');
	assert.match(f.reason, /undeclared-write:audit/, 'blames the specific undeclared key');
});

test('G2 effect-tag in-flow: an external step needs a ground-truth ORACLE (neg ctrl: none → blamed)', async () => {
	assert.equal((await G.oracleGuard()).blamed, 1, 'an external-effect post with no oracle is blamed (not silently committed)');
	assert.equal((await G.oracleGuard(() => true)).done, 1, 'a confirming oracle lets it flow');
	assert.equal((await G.oracleGuard(() => false)).blamed, 1, 'a disagreeing oracle blames it');
});
