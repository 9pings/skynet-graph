'use strict';
/**
 * G-1 rung 3b — the interface-alphabet REGISTRY (Σ_sep) as a first-class CURATED, VERSIONED object (the library
 * CATALOG). Consolidates the session's rungs: the synonym RINGS live here (`specForKey`), borderline PROPOSALS are
 * admitted here (`mergeRingProposals`, confluence re-checked), and a tree is ENFORCED against the frozen canon
 * (`checkTreeAgainstRegistry`). Each claim carries a negative control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveRegistry, freezeRegistry, specForKey, resolveFactsSchema, mergeRingProposals, retractRingAlias, checkTreeAgainstRegistry, validateWithRegistry } = require('../../lib/authoring/registry');
const { createIntake } = require('../../lib/providers');

const q = ( s ) => "$status=='" + s + "'";
const shipTree = () => ({ childConcepts: {
	Ship: { _id: 'Ship', _name: 'Ship', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { status: { enum: ['intransit', 'delivered'], synonyms: { delivered: ['arrived'] } } }, prose: 's' } },
	Notify: { _id: 'Notify', _name: 'Notify', require: ['Ship', 'status'], ensure: [q('delivered')], provider: ['AI::act'] },
} });

test('deriveRegistry — extracts the typed vocab + ring + producers/consumers; a produced∧consumed enum key is Tier-1', () => {
	const reg = deriveRegistry(shipTree());
	const e = reg.keys.status;
	assert.deepEqual(e.enum, ['intransit', 'delivered']);
	assert.deepEqual(e.synonyms, { delivered: ['arrived'] }, 'the curated ring lives in the registry');
	assert.deepEqual(e.producers, ['Ship']);
	assert.deepEqual(e.consumers, ['Notify']);
	assert.equal(e.tier, 1, 'produced ∧ consumed ∧ enum → Tier-1 interface');
	assert.deepEqual(reg.conflicts, [], 'a confluent tree has no conflicts');
});

test('specForKey — sources the canonValue spec (enum+ring) FROM the registry; null for a non-typed key', () => {
	const reg = deriveRegistry(shipTree());
	assert.deepEqual(specForKey(reg, 'status'), { enum: ['intransit', 'delivered'], synonyms: { delivered: ['arrived'] } });
	assert.equal(specForKey(reg, 'Ship'), null, 'a self-flag boolean carries no typed vocabulary');
	assert.equal(specForKey(reg, 'nope'), null);
});

test('freezeRegistry — stamps a version + freezes (the closed canon)', () => {
	const fr = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	assert.equal(fr.frozen, true);
	assert.equal(fr.version, 'v1');
});

test('mergeRingProposals — admits a valid alias (confluence re-checked, version bumps); REJECTS bad members + collisions', () => {
	const fr = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	const r = mergeRingProposals(fr, [
		{ key: 'status', alias: 'en-route', member: 'intransit' },   // valid → admit
		{ key: 'status', alias: 'x', member: 'shipped' },            // member not in enum → reject
		{ key: 'status', alias: 'arrived', member: 'intransit' },    // 'arrived' already ↦ delivered → confluence break → reject
	]);
	assert.deepEqual(r.admitted, [{ key: 'status', alias: 'en-route', member: 'intransit' }]);
	assert.equal(r.rejected.length, 2);
	assert.match(r.rejected.find((x) => x.alias === 'x').reason, /member not in the enum/);
	assert.match(r.rejected.find((x) => x.alias === 'arrived').reason, /confluence/);
	assert.deepEqual(r.registry.keys.status.synonyms.intransit, ['en-route'], 'the admitted alias joined the ring');
	assert.equal(r.registry.version, 'v2', 'version bumped on admit');
	assert.equal(fr.version, 'v1', 'the input registry is not mutated');
});

test('checkTreeAgainstRegistry — an OFF-CANON value is an ERROR on a frozen canon; a SUBSET tree is clean', () => {
	const canon = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	// a divergent tree: writes status='shipped', which the canon does not list.
	const bad = { childConcepts: { Ship2: { _id: 'Ship2', _name: 'Ship2', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { status: { enum: ['intransit', 'shipped'] } }, prose: 's' } } } };
	const rb = checkTreeAgainstRegistry(bad, canon);
	assert.equal(rb.errors.filter((e) => e.kind === 'off-canon-value').length, 1, 'the off-canon value is a hard error (frozen)');
	assert.match(rb.errors[0].message, /shipped/);
	// a subset tree (only registered values) is clean.
	const ok = { childConcepts: { Ship3: { _id: 'Ship3', _name: 'Ship3', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { status: { enum: ['delivered'] } }, prose: 's' } } } };
	assert.equal(checkTreeAgainstRegistry(ok, canon).errors.length, 0, 'a subset of the canon vocabulary is clean (no false positive)');
});

test('checkTreeAgainstRegistry — off-canon is only a WARNING before freezing; an un-registered key is advisory (warn)', () => {
	const draft = deriveRegistry(shipTree());   // NOT frozen
	const bad = { childConcepts: { S: { _id: 'S', _name: 'S', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { status: { enum: ['shipped'] }, priority: { enum: ['p1', 'p2'] } }, prose: 's' } } } };
	const r = checkTreeAgainstRegistry(bad, draft);
	assert.equal(r.errors.length, 0, 'not frozen → no hard errors');
	assert.equal(r.warnings.filter((w) => w.kind === 'off-canon-value').length, 1, 'off-canon is a warning pre-freeze');
	assert.equal(r.warnings.filter((w) => w.kind === 'unregistered-interface-key' && w.message.includes('priority')).length, 1, 'a key the canon does not know is advisory');
});

// ── wiring the registry as the SOURCE (go 1) ──
test('resolveFactsSchema — a {ref:key} spec resolves to the registry vocab; unknown ref → unresolved; plain passes through', () => {
	const reg = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	const r = resolveFactsSchema({ s: { ref: 'status', from: 'st' }, x: { type: 'int' }, y: { ref: 'nope' } }, reg);
	assert.deepEqual(r.facts.s, { enum: ['intransit', 'delivered'], synonyms: { delivered: ['arrived'] }, from: 'st' }, 'ref → registry spec (the ring lives in the registry), `from` preserved');
	assert.deepEqual(r.facts.x, { type: 'int' }, 'a non-ref spec passes through');
	assert.deepEqual(r.unresolved, [{ key: 'y', ref: 'nope' }], 'an unknown ref is reported, not silently dropped');
});

test('validateWithRegistry — the registry enforcement is folded into the author-time validator findings', () => {
	const canon = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	const bad = { childConcepts: { Ship2: { _id: 'Ship2', _name: 'Ship2', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { status: { enum: ['intransit', 'shipped'] } }, prose: 's' } } } };
	const { errors } = validateWithRegistry(bad, canon);
	assert.equal(errors.filter((e) => e.kind === 'off-canon-value').length, 1, 'the off-canon value surfaces through the composed validator');
});

test('intake SOURCE — a concept that REFERENCES a registry key snaps a paraphrase via the registry ring (no inlined vocab)', async () => {
	// the registry owns severity = {low,high} with severe↦high. The concept declares ONLY `{ref:'severity'}` — no enum inlined.
	const regTree = { childConcepts: { Sev: { _id: 'Sev', _name: 'Sev', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { severity: { enum: ['low', 'high'], synonyms: { high: ['severe'] } } }, prose: 's' } } } };
	const reg = freezeRegistry(deriveRegistry(regTree), 'v1');
	const resolveFacts = ( fs ) => resolveFactsSchema(fs, reg).facts;
	const { Intake } = createIntake({ ask: async () => JSON.stringify({ severity: 'severe', prose: 'p' }), resolveFacts });
	const concept = { _name: 'Intake', _schema: { prompt: { facts: { severity: { ref: 'severity' } }, prose: 'intakeNarrative' }, intake: { required: ['severity'] } } };
	const graph = { getRef: ( r, s ) => s._[r], traceProvider: null };
	const facts = await new Promise(( res ) => Intake.type(graph, concept, { _: { rawText: 'in' } }, null, ( e, f ) => res(f)));
	assert.equal(facts.severity, 'high', "the registry ring snapped the paraphrase 'severe' → 'high' (the ring lives in the registry, consulted at intake)");
	assert.equal(facts.IntakeStatus, 'typed', 'a clean ring snap is typed');
	assert.ok(facts.IntakeFactsDigest, 'and mints a reusable digest (K1)');
});

test('deriveRegistry — a cross-producer ring intent-collision is RECORDED in conflicts (total, never thrown)', () => {
	const t = { childConcepts: {
		A: { _id: 'A', _name: 'A', require: ['Segment'], provider: ['LLM::complete'], prompt: { facts: { sev: { enum: ['low', 'high'], synonyms: { high: ['severe'] } } }, prose: 's' } },
		B: { _id: 'B', _name: 'B', require: ['Segment'], provider: ['LLM::complete'], prompt: { facts: { sev: { enum: ['low', 'high'], synonyms: { low: ['severe'] } } }, prose: 's' } },
	} };
	const reg = deriveRegistry(t);
	assert.equal(reg.conflicts.length, 1, 'the union of the two rings is non-confluent → recorded');
	assert.equal(reg.conflicts[0].key, 'sev');
	assert.match(reg.conflicts[0].error, /severe/);
});

// ─────────────────────────── retractRingAlias — the un-learn verb + confluence DE-LOCK (Laurie confront) ───────────────
// Soundness rests on RECOVERABILITY, not oracle certification ("8/8" ≠ certified; Rule-of-Three 95% bound ≈ 37% on 8).
// A strong model lowers the RATE of a wrong autonomous admit; retraction bounds the DAMAGE. Each claim has a NEG.
const sevReg = () => freezeRegistry(deriveRegistry({ childConcepts: { Sev: { _id: 'Sev', _name: 'Sev',
	require: ['Segment'], provider: ['LLM::complete'], prompt: { facts: { severity: { enum: ['low', 'high'] } }, prose: 's' } } } }), 'v1');

test('retractRingAlias — removes an admitted alias, bumps the version, drops its provenance', () => {
	let reg = mergeRingProposals(sevReg(), [{ key: 'severity', alias: 'severe', member: 'high', via: 'llm-borderline' }]).registry;
	assert.deepEqual(reg.keys.severity.synonyms.high, ['severe'], 'admitted');
	assert.equal(reg.ringProvenance['severity::severe'].via, 'llm-borderline', 'provenance tagged on admit');
	const v = reg.version;
	const r = retractRingAlias(reg, 'severity', 'severe');
	assert.equal(r.retracted, true);
	assert.equal(r.member, 'high', 'reports the member the alias mapped to');
	assert.equal(r.registry.keys.severity.synonyms, undefined, 'the ring is emptied (no dangling member key)');
	assert.notEqual(r.registry.version, v, 'the version bumped (= the B8 invalidation signal)');
	assert.equal(r.registry.ringProvenance['severity::severe'], undefined, 'provenance dropped');
});

test('DE-LOCK (the killer) — a WRONG admit locks the correct alias via confluence; retraction UN-locks it', () => {
	// a bad autonomous admit: catastrophic→low (the docstring's own wrong-guess example).
	let reg = mergeRingProposals(sevReg(), [{ key: 'severity', alias: 'catastrophic', member: 'low' }]).registry;
	// the CORRECT proposal is now blocked — first-writer-wins under confluence (this IS the poison's teeth).
	const blocked = mergeRingProposals(reg, [{ key: 'severity', alias: 'catastrophic', member: 'high' }]);
	assert.equal(blocked.admitted.length, 0);
	assert.match(blocked.rejected[0].reason, /confluence/, 'without retraction the correction is rejected — permanently locked');
	// retract → de-lock → the correction is admissible.
	reg = retractRingAlias(reg, 'severity', 'catastrophic').registry;
	const fixed = mergeRingProposals(reg, [{ key: 'severity', alias: 'catastrophic', member: 'high' }]);
	assert.equal(fixed.admitted.length, 1, 'after retraction the corrected alias is admitted (de-locked)');
	assert.deepEqual(fixed.registry.keys.severity.synonyms.high, ['catastrophic'], 'catastrophic now maps to high');
	assert.equal(specForKey(fixed.registry, 'severity').synonyms.high[0], 'catastrophic', 'the barrier spec reflects the correction');
});

test('NEG — retracting an absent alias is a no-op (no version bump, retracted:false)', () => {
	const reg = sevReg();
	const r = retractRingAlias(reg, 'severity', 'nonesuch');
	assert.equal(r.retracted, false);
	assert.equal(r.registry.version, reg.version, 'no spurious version bump');
	assert.equal(r.member, null);
});
