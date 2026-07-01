'use strict';
/**
 * G-1 first rung — the CURATED SYNONYM RING on the canonicalization barrier (the library-science thesaurus the owner
 * asked for; confront: Laurie, ISO 25964 / SKOS altLabel→prefLabel / a ground TRS, Knuth-Bendix). It widens the enum's
 * normalization map `κ` with a curated alias table `σ` (`spec.synonyms = { member: [alias...] }`), so a paraphrase
 * ("severe") snaps to the canonical member ("high") by a DETERMINISTIC LOOKUP — fixing signature-stability at the root
 * (a lookup can't flip the enum the way constrained decoding does — Park et al. 2024). It stays INSIDE the barrier's
 * HARD RULE ("no non-deterministic open-domain runtime similarity"): a validated ring is confluent, closed-domain,
 * author-time — a bigger lookup table, categorically NOT an embedding (the ~33% GPTCache false-hit). Each claim carries
 * a discriminating negative control. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonValue, canonFacts, digest, compileEnumMap } = require('../../lib/providers/canonicalize');

const SEV = { enum: ['low', 'high'], synonyms: { high: ['severe', 'critical', 'urgent'], low: ['minor', 'trivial'] } };

test('a curated alias snaps to its canonical member (via:synonym), case/whitespace-insensitive', () => {
	assert.deepEqual(canonValue('severe', SEV), { value: 'high', via: 'synonym' });
	assert.deepEqual(canonValue('  CRITICAL ', SEV), { value: 'high', via: 'synonym' }, 'normalized then ring-snapped');
	assert.deepEqual(canonValue('minor', SEV), { value: 'low', via: 'synonym' });
	assert.deepEqual(canonValue('high', SEV), { value: 'high' }, 'a direct member is NOT via:synonym (origin=member)');
});

test('NEG — fail-closed is preserved: a term in NEITHER members nor ring is a visible miss (never a silent snap)', () => {
	assert.deepEqual(canonValue('catastrophic', Object.assign({ default: 'low' }, SEV)), { value: 'low', miss: true });
	assert.deepEqual(canonValue('catastrophic', SEV), { value: null, miss: true });
});

test('HARD RULE — the match is EXACT over the normalized expanded vocab, NOT fuzzy/edit-distance', () => {
	// a typo one edit away from a real alias must NOT match (edit-distance would = embedding with extra steps).
	assert.deepEqual(canonValue('sever', SEV), { value: null, miss: true }, "'sever' is not 'severe' — no fuzzy match");
	assert.deepEqual(canonValue('severely', SEV), { value: null, miss: true });
});

test('CONDITION-4 verify — the digest is RING-VERSION-ROBUST by construction (snap is UPSTREAM of the digest)', () => {
	// a synonym-snapped record and a direct-member record produce the SAME FactsDigest (both project to {severity:high})
	// → the member-keyed memo needs NO ring-version gating: retracting an alias can never poison a member-keyed cache
	// entry (it only stops FUTURE surfaces reaching the member). Dissolves Laurie's stale-retraction gotcha for the memo.
	const schema = { severity: SEV };
	const dSyn = digest(canonFacts({ severity: 'severe' }, schema).facts);
	const dDirect = digest(canonFacts({ severity: 'high' }, schema).facts);
	assert.equal(dSyn, dDirect, 'severe↦high and high produce the identical digest (digest is over MEMBERS, not surface)');
	// NEG control: two DIFFERENT members differ (the digest is not vacuously constant).
	const dLow = digest(canonFacts({ severity: 'minor' }, schema).facts);
	assert.notEqual(dSyn, dLow, 'a low-ring alias digests differently from a high one (not vacuous)');
});

test('canonFacts surfaces a synonym AUDIT trail (reversibility): {key, raw, member}', () => {
	const r = canonFacts({ severity: 'severe', other: 'x' }, { severity: SEV, other: { type: 'string' } });
	assert.deepEqual(r.facts.severity, 'high');
	assert.deepEqual(r.synonyms, [{ key: 'severity', raw: 'severe', member: 'high' }], 'the ring snap is auditable');
	assert.deepEqual(r.misses, []);
});

// ── the CRITICAL-PAIR checks (confluence): a malformed ring THROWS at compile (map construction), never silently.
test('confluence NEG — a ring key that is NOT an enum member throws (malformed → fail-closed)', () => {
	assert.throws(() => compileEnumMap({ enum: ['low', 'high'], synonyms: { medium: ['mid'] } }), /not an enum member/);
});

test('confluence NEG — SINGLE-VALUE violation: an alias mapping to TWO members throws (critical pair)', () => {
	assert.throws(() => compileEnumMap({ enum: ['low', 'high'], synonyms: { high: ['bad'], low: ['bad'] } }),
		/collides|single-valued/, "'bad'→high and 'bad'→low is not single-valued");
});

test('confluence NEG — DISJOINT violation: an alias colliding a MEMBER throws (critical pair)', () => {
	assert.throws(() => compileEnumMap({ enum: ['low', 'high'], synonyms: { high: ['low'] } }),
		/collides|disjoint/, "alias 'low' collides the member 'low'");
});

test('a harmless duplicate alias (same member, twice) does NOT throw', () => {
	assert.doesNotThrow(() => compileEnumMap({ enum: ['low', 'high'], synonyms: { high: ['severe', 'severe'] } }));
});

test('no-synonym parity — an enum without a ring behaves exactly as before (regression)', () => {
	const spec = { enum: ['low', 'medium', 'high'], default: 'medium' };
	assert.deepEqual(canonValue('high', spec), { value: 'high' });
	assert.deepEqual(canonValue('  HIGH ', spec), { value: 'high' });
	assert.deepEqual(canonValue('nope', spec), { value: 'medium', miss: true });
});
