'use strict';
/**
 * Clinical grammar — the NICHE: inter-premise DEFEASANCE. A CKD diagnosis derived from a
 * lab is RETRACTED (its medication cascading) the instant the lab is refuted, and a typed
 * CONSTAT record (the Q6 shape) is deposited on a surviving anchor. The deterministic JTMS
 * retraction IS the differentiator (the Zep foil made runnable, R2-safe — the rule gates +
 * retracts; the LLM-written `diagnosis` enum is the only judgment). Setup: examples/poc/clinical.js.
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §3.1.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { runClinicalDefeasance, CLINICAL } = require('../../examples/poc/clinical.js');
const { buildConceptTree } = require('../../lib/authoring/concepts');
const { validateConceptTree } = require('../../lib/authoring/validate');
console.log = console.info = console.warn = () => {};

test('a refuted lab retracts the diagnosis + cascades the medication, leaving a typed constat', async () => {
	const s = await runClinicalDefeasance();

	// before: the chain cast; the LLM wrote the typed diagnosis enum (a FACT, not a rule decision)
	assert.ok(s.before.Observation && s.before.LabValue && s.before.OutOfRange, 'observation + lab + range-check cast');
	assert.equal(s.before.diagnosis, 'ckd', 'the diagnosis is an LLM-written typed fact');
	assert.ok(s.before.Diagnosis && s.before.Medication, 'diagnosis + medication cast');
	assert.equal(s.before.medication, 'lisinopril', 'medication derived from the diagnosis');

	// after refute: deterministic JTMS retraction of the diagnosis + its cascade
	assert.equal(s.after.Diagnosis, false, 'the diagnosis RETRACTED when its lab premise fell (defeasance, not require)');
	assert.equal(s.after.Medication, false, 'the medication CASCADE-retracted (nested child, finding #10b)');
	assert.equal(s.after.OutOfRange, true, 'the deterministic range-check is unaffected (R2-safe, value-based, not verdict-gated)');

	// the typed CONSTAT record (Q6 shape) on the surviving anchor — what + why + when
	assert.equal(s.after.lessons.length, 1, 'one constat deposited at retraction');
	const c = s.after.lessons[0];
	assert.equal(c.kind, 'Diagnosis');
	assert.equal(c.claim, 'ckd', 'records WHAT was retracted');
	assert.equal(c.retractedBecause, 'labVerdict', 'records WHY (the premise that fell)');
	assert.equal(c.certaintyBand, 'high', 'snapped certainty band carried');
	assert.equal(typeof c.atRev, 'number', 'records the revision (bisectable)');
});

test('the clinical grammar validates clean and is canonicalization-barrier-safe', () => {
	const { errors } = validateConceptTree(buildConceptTree(CLINICAL), { flagContinuousGates: true });
	assert.equal(errors.length, 0, 'no errors: ' + JSON.stringify(errors));
});
