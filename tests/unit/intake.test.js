'use strict';
/**
 * C0 — the prose→typed front door (§3.2). Unit-level: the `Intake::type` provider's
 * DISCRETE gate (`IntakeStatus`), the miss-aware digest (Invariant 2), the optional
 * back-check, and the "never memoize a miss" contract through the real provider cache.
 *
 * Hermetic: the "LLM" is an injected constant reply (no network).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIntake, createProviderCache } = require('../../lib/providers');
const canon = require('../../lib/providers/canonicalize');

// Minimal harness: drive Intake::type with a fixed reply, a fake graph/scope (no engine).
function runIntake( reply, { required = [], facts, backCheck } = {} ) {
	const { Intake } = createIntake({ ask: async () => reply, backCheck });
	const concept = { _name: 'Intake', _schema: { prompt: { facts, prose: 'intakeNarrative' }, intake: { required } } };
	const graph = { getRef: ( r, s ) => s._[r], traceProvider: null };
	const scope = { _: { rawText: 'in' } };
	return new Promise(( res ) => Intake.type(graph, concept, scope, null, ( e, f ) => res(f)));
}

const VOCAB = { kind: { enum: ['question', 'request', 'statement'] } };

test('in-vocab → typed + a STABLE digest across textually-divergent same-class inputs', async () => {
	const a = await runIntake(JSON.stringify({ kind: 'question', prose: 'flowery wording A' }), { required: ['kind'], facts: VOCAB });
	const b = await runIntake(JSON.stringify({ kind: 'QUESTION', prose: 'terse B' }), { required: ['kind'], facts: VOCAB }); // case-divergent snap
	assert.equal(a.IntakeStatus, 'typed');
	assert.equal(a.kind, 'question', 'snapped to the vocab');
	assert.equal(b.kind, 'question', 'case-normalized snap');
	assert.ok(a.IntakeFactsDigest, 'typed mints a reusable digest');
	assert.equal(a.IntakeFactsDigest, b.IntakeFactsDigest, 'digest stable across re-prose (the K1 win)');
	assert.notEqual(a.intakeNarrative, b.intakeNarrative, 'prose differs (untracked)');
	assert.equal(a.IntakeCanonMiss, undefined, 'no miss on a clean snap');
});

test('optional miss → partial: no reusable digest, CanonMiss listed (un-cacheable)', async () => {
	const facts = { kind: VOCAB.kind, topic: { enum: ['x', 'y'] } };           // topic optional (NOT in required)
	const r = await runIntake(JSON.stringify({ kind: 'request', topic: 'zzz', prose: 'p' }), { required: ['kind'], facts });
	assert.equal(r.IntakeStatus, 'partial');
	assert.deepEqual(r.IntakeCanonMiss, ['topic'], 'the optional miss is visible');
	assert.equal(r.IntakeFactsDigest, undefined, 'partial mints NO reusable digest');
	assert.equal(r.kind, 'request', 'the required key still snapped');
});

test('required miss → untyped: CanonMiss non-empty, NO digest, canonValue confirms the miss', async () => {
	const r = await runIntake(JSON.stringify({ kind: 'banana', prose: 'wild' }), { required: ['kind'], facts: VOCAB });
	assert.equal(r.IntakeStatus, 'untyped');
	assert.equal(r.kind, null, 'out-of-vocab fell to the default (null), NOT a wrong snap');
	assert.deepEqual(r.IntakeCanonMiss, ['kind']);
	assert.equal(r.IntakeFactsDigest, undefined, 'untyped mints NO reusable digest');
	assert.equal(canon.canonValue('banana', VOCAB.kind).miss, true, 'fail-closed at the canon layer');
});

// ── Invariant 2 (the soundness fix), with the discriminating neg control ────────────────────
test('Invariant 2: untyped emits no digest — and the "fold-misses" alternative would STILL collide', async () => {
	// Two semantically-DIFFERENT out-of-vocab inputs on the SAME required key.
	const A = await runIntake(JSON.stringify({ kind: 'banana',   prose: 'A' }), { required: ['kind'], facts: VOCAB });
	const B = await runIntake(JSON.stringify({ kind: 'platypus', prose: 'B' }), { required: ['kind'], facts: VOCAB });

	// the BUG that C0 closes: LLM::complete-style `digest(cf.facts)` collides (both -> {kind:null}).
	const oldA = canon.digest(canon.canonFacts({ kind: 'banana' }, VOCAB).facts);
	const oldB = canon.digest(canon.canonFacts({ kind: 'platypus' }, VOCAB).facts);
	assert.equal(oldA, oldB, 'NEG CONTROL: the naive digest collides (the latent false memo hit C0 fixes)');

	// the "fold the miss-key list into the digest" alternative is NOT a fix — same required key missed
	// => identical {kind:null, __miss:[kind]} => STILL collides. Proves the chosen horn is the only sound one.
	const foldA = canon.digest({ ...canon.canonFacts({ kind: 'banana' }, VOCAB).facts, __miss: ['kind'] });
	const foldB = canon.digest({ ...canon.canonFacts({ kind: 'platypus' }, VOCAB).facts, __miss: ['kind'] });
	assert.equal(foldA, foldB, 'NEG CONTROL: fold-misses STILL collides — so it is not the fix');

	// C0's sound horn: NO reusable digest for a non-typed projection => nothing to collide on.
	assert.equal(A.IntakeFactsDigest, undefined);
	assert.equal(B.IntakeFactsDigest, undefined);
	assert.equal(A.IntakeStatus, 'untyped');
	assert.equal(B.IntakeStatus, 'untyped');
});

test('independent back-check: a fail downgrades a clean snap to untyped; a pass keeps typed', async () => {
	const reply = JSON.stringify({ kind: 'question', prose: 'p' });
	const failed = await runIntake(reply, { required: ['kind'], facts: VOCAB, backCheck: () => false });
	assert.equal(failed.IntakeStatus, 'untyped', 'a refuted back-check is never typed even with a clean snap');
	assert.equal(failed.IntakeVerified, 'fail');

	const passed = await runIntake(reply, { required: ['kind'], facts: VOCAB, backCheck: async () => 'pass' });
	assert.equal(passed.IntakeStatus, 'typed');
	assert.equal(passed.IntakeVerified, 'pass');
	assert.ok(passed.IntakeFactsDigest);
});

test('never memoize a miss: through the REAL provider cache, untyped is not stored; typed is stored + hits', async () => {
	const cache = createProviderCache();
	// the provider echoes the user prompt back as its reply, so a JSON `rawText` drives the vocab hit/miss.
	const base = createIntake({ ask: async ( { user } ) => user }).Intake.type;
	const keyFn = ( g, c, s ) => s._.rawText;
	const wrapped = cache.wrap(base, keyFn);
	const concept = { _name: 'Intake', _schema: { prompt: { user: '${rawText}', facts: VOCAB, prose: 'intakeNarrative' }, intake: { required: ['kind'] } } };
	const graph = { getRef: ( r, s ) => s._[r], traceProvider: null };
	const call = ( raw ) => new Promise(( res ) => wrapped(graph, concept, { _: { rawText: raw } }, null, ( e, f ) => res(f)));

	// the user prompt IS the reply (echo) — so a JSON rawText drives the kind.
	const miss1 = await call(JSON.stringify({ kind: 'banana', prose: 'A' }));
	const miss2 = await call(JSON.stringify({ kind: 'platypus', prose: 'B' }));
	assert.equal(miss1.IntakeStatus, 'untyped');
	assert.equal(miss2.IntakeStatus, 'untyped');
	assert.equal(cache.size(), 0, 'no out-of-vocab (CanonMiss) result is ever stored');
	assert.equal(cache.stats.stores, 0);

	const hit1 = await call(JSON.stringify({ kind: 'question', prose: 'C' }));
	assert.equal(hit1.IntakeStatus, 'typed');
	assert.equal(cache.size(), 1, 'the typed intake is stored');
	const before = cache.stats.hits;
	const hit2 = await call(JSON.stringify({ kind: 'question', prose: 'C' }));  // same key
	assert.equal(cache.stats.hits, before + 1, 'a repeat typed intake HITS the store (0 model cost)');
	assert.equal(hit2.IntakeStatus, 'typed');
});

// ── <name>Missing: the REQUIRED-only subset of the canon misses (the decision-bearing keys a
//    typed refusal names). `<name>CanonMiss` carries ALL misses; `<name>Missing` is required∩miss.
const SEV = { severity: { enum: ['low', 'high'] } };

test('IntakeMissing: a REQUIRED out-of-vocab key surfaces the decision-bearing subset (untyped)', async () => {
	const r = await runIntake(JSON.stringify({ severity: 'gibberish', prose: 'p' }), { required: ['severity'], facts: SEV });
	assert.equal(r.IntakeStatus, 'untyped', 'a required miss makes the intake untyped');
	assert.ok(Array.isArray(r.IntakeMissing), 'IntakeMissing emitted as an array');
	assert.deepEqual(r.IntakeMissing, ['severity'], 'IntakeMissing = the required subset that missed');
	assert.deepEqual(r.IntakeCanonMiss, ['severity'], 'CanonMiss carries the full miss set (here identical)');
	assert.equal(r.severity, null, 'the out-of-vocab value fell to the default, never a wrong snap');
});

test('IntakeMissing: required-only subset — an OPTIONAL miss is in CanonMiss but NOT in Missing (partial)', async () => {
	const facts = { severity: { enum: ['low', 'high'] }, area: { enum: ['x', 'y'] } };   // area is NOT required
	const r = await runIntake(JSON.stringify({ severity: 'high', area: 'zzz', prose: 'p' }), { required: ['severity'], facts });
	assert.equal(r.IntakeStatus, 'partial', 'an optional-only miss is partial, not untyped');
	assert.deepEqual(r.IntakeCanonMiss, ['area'], 'CanonMiss carries the optional miss');
	assert.equal(r.IntakeMissing, undefined, 'no REQUIRED miss → IntakeMissing absent (required-only subset)');
	assert.equal(r.severity, 'high', 'the required key still snapped');
});

test('IntakeMissing: a clean in-vocab intake is typed and emits NO IntakeMissing (negative control)', async () => {
	const r = await runIntake(JSON.stringify({ severity: 'high', prose: 'p' }), { required: ['severity'], facts: SEV });
	assert.equal(r.IntakeStatus, 'typed');
	assert.equal(r.IntakeMissing, undefined, 'a clean typed intake never emits IntakeMissing');
	assert.equal(r.IntakeCanonMiss, undefined, 'nor CanonMiss');
	assert.equal(r.severity, 'high', 'the required key snapped');
});
