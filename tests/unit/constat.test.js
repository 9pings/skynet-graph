'use strict';
/**
 * Typed CONSTAT record (Q6) — memory-on-retraction promoted to a structured learning surface.
 * Verifies the record shape (what/why/snapped-certainty/rev), that certainty is read ONLY from a
 * snapped band key (never a raw float — the barrier), and that the packaged cleaner provider
 * deposits it race-free. Pure unit (no engine boot).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConstat, recordConstat, createConstat, CONSTAT_FIELDS } = require('../../lib/providers/constat');

const graph = { getCurrentRevision: () => 42 };
const concept = { _name: 'Diagnosis', _schema: { constat: { claimKey: 'diagnosis', because: 'labVerdict' } } };
const scope = { _: { diagnosis: 'ckd', confBand: 'high' } };

test('buildConstat assembles the typed record (what / why / certainty / rev)', () => {
	const c = buildConstat(graph, concept, scope, concept._schema.constat);
	assert.equal(c.kind, 'Diagnosis');
	assert.equal(c.claim, 'ckd', 'reads the asserted value via claimKey');
	assert.equal(c.retractedBecause, 'labVerdict', 'records the premise that fell');
	assert.equal(c.certaintyBand, 'high', 'snapped band');
	assert.equal(c.atRev, 42, 'the revision (bisectable)');
});

test('certaintyBand comes only from a SNAPPED key (certaintyBand|confBand), never a raw float', () => {
	const c1 = buildConstat(graph, concept, { _: { diagnosis: 'x', certaintyBand: 'certain' } }, { claimKey: 'diagnosis' });
	assert.equal(c1.certaintyBand, 'certain');
	const c2 = buildConstat(graph, concept, { _: { diagnosis: 'x' } }, { claimKey: 'diagnosis' });
	assert.equal(c2.certaintyBand, null, 'absent band -> null (no raw value invented)');
	assert.equal(c2.claim, 'x');
	const c3 = buildConstat(graph, concept, { _: {} }, {});
	assert.equal(c3.claim, null, 'no claimKey / value -> null');
});

test('recordConstat is the race-free {__push} fragment onto a surviving anchor', () => {
	const tpl = recordConstat(graph, concept, scope, { claimKey: 'diagnosis', because: 'labVerdict' });
	assert.equal(tpl.$$_id, 'mem', 'deposits on the shared anchor');
	assert.ok(tpl.lessons && tpl.lessons.__push, 'appends (not replaces) — race-free fan-in');
	assert.equal(tpl.lessons.__push.claim, 'ckd');
});

test('createConstat packages a Constat::record cleaner provider reading the concept config', () => {
	const prov = createConstat();
	assert.equal(typeof prov.Constat.record, 'function');
	let out;
	prov.Constat.record(graph, concept, scope, null, (err, tpl) => { out = tpl; });
	assert.equal(out.lessons.__push.kind, 'Diagnosis');
	assert.equal(out.lessons.__push.retractedBecause, 'labVerdict');
});

test('CONSTAT_FIELDS declares certaintyBand as a snapped enum and note as prose', () => {
	assert.ok(CONSTAT_FIELDS.certaintyBand.enum, 'certaintyBand is an enum (snapped, K1-safe)');
	assert.equal(CONSTAT_FIELDS.note.role, 'prose', 'note is untracked terminal prose');
});
