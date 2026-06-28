'use strict';
/**
 * §11.6 COMPOSITION-SOUNDNESS on the REAL engine — the design's go/no-go for §7 ("compose on typed contracts
 * without opening the box"). The box-CLOSED compose decision (`contract.js#checkCompose`, contracts only) must
 * MATCH open-the-box REALITY (the engine's stabilization fixpoint). The stream gate (§11.1-5) can pass while the
 * system is unsound here — this probe is what catches it. Negative controls throughout.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../examples/poc/contract-compose.js');
console.log = console.info = console.warn = () => {};

test('SOUND composition: checkCompose admits AND the engine fixpoint == open-the-box (Grade cast, grades match)', async () => {
	const s = await P.soundRun([85, 150, -10, 72]);
	assert.equal(s.decision, 'sound', 'the box-CLOSED decision admits Normalize→Grade');
	assert.equal(s.allMatch, true, 'open-the-box reality confirms it: every Grade cast + the grade == letter(clamp(raw))');
	// spot-check the clamping is real (150 → clamped 100 → A; -10 → 0 → F), not a coincidence
	assert.equal(s.rows.find(( r ) => r.raw === 150).engineGrade, 'A');
	assert.equal(s.rows.find(( r ) => r.raw === -10).engineGrade, 'F');
});

test('UNSOUND composition (the kill-test): checkCompose refuses AND the engine confirms the precondition fails', async () => {
	const u = await P.unsoundRun(150);
	// box-CLOSED, from the contracts alone, BEFORE running:
	assert.equal(u.decision, 'unsound', 'a wider post (score∈[0,200]) ⊄ pre (score∈[0,100]) is caught at compose-time');
	// open-the-box reality confirms the prediction: the overflowing score violates Grade.ensure → Grade does NOT cast
	assert.equal(u.scoreWritten, 150, 'BadNormalize wrote the unclamped score');
	assert.equal(u.gradeCast, false, 'Grade\'s precondition was violated → it never cast (the unsound state the checker predicted)');
	assert.equal(u.gradeFact, undefined, 'no grade produced — the checker saved an unsound run');
});

test('G1 frame-completeness: a body writing an UNDECLARED key is caught at runtime (the silent frame hole)', async () => {
	const f = await P.frameRun();
	assert.ok(f.touched.includes('audit'), 'the body really did write the undeclared key');
	assert.equal(f.ok, false, 'assertPost fails the frame check');
	assert.ok(f.violations.some(( v ) => v.kind === 'undeclared-write' && v.detail === 'audit' ), 'blames the undeclared write');
	assert.ok(!f.violations.some(( v ) => v.detail === 'ok' ), 'the DECLARED write is not flagged (negative control)');
});

test('the box-CLOSED decisions over the candidate set + the MEASURED accept-rate (refuse-everything cannot fake it)', () => {
	const d = P.decisions();
	const by = ( n ) => d.candidates.find(( c ) => c.name === n).verdict;
	assert.equal(by('Normalize→Grade'), 'sound');
	assert.equal(by('BadNormalize→Grade'), 'unsound');
	assert.equal(by('Ship→Notify (no oracle)'), 'escalate', 'an external effect with no oracle escalates (G2)');
	assert.equal(by('Ship→Notify (oracle ✓)'), 'sound', 'a confirmed oracle admits');
	assert.equal(d.rate.rate, 0.5, 'the typed-coverage fraction is MEASURED (2 sound / 4), not assumed');
	assert.equal(d.rate.n, 4);
});
