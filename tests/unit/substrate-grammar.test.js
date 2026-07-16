'use strict';
/**
 * M0 — the universal reasoning layer (`concepts/_substrate/`) is AUTHORABLE and VALIDATES
 * CLEAN. The thin epistemic/control spine — Task→Complexity→Answer/Rollup (the answer-loop,
 * generalizing lib/authoring/core/loop.js) ; Claim→Verification→Refuted (the defeasance chain) ;
 * Frontier→InBeam/Stuck (budget control) — is the foundation the first DOMAIN grammars
 * (clinical, supply-chain) plug under via childConcepts (directory tree = IS-A).
 *
 * This proves the layer is zero-core, well-formed, barrier-clean (no prose on a dependency
 * edge, no raw-float gate, acyclic/stratified) BEFORE any domain is authored or the engine
 * runs it. The `type:"enum"` discriminant was deliberately avoided (Concept.js:239 — "enum
 * are not used for now"): the verdict rides a distinct `complexityClass` fact instead.
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §3.0 / §7 (M0).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');
const { validateConceptTree } = require('../../lib/authoring/core/validate');

const SUBSTRATE = path.join(__dirname, '..', '..', 'concepts', '_substrate');
const tree = () => buildConceptTree(SUBSTRATE);

test('builds the expected IS-A spine (directory tree = hierarchy)', () => {
	const top = tree().childConcepts;
	assert.ok(top.Task && top.Claim && top.Frontier, 'three universal roots');
	const task = top.Task.childConcepts;
	assert.ok(task.EvalComplexity && task.Complexity && task.Answer && task.ReportUp && task.Rollup, 'answer-loop spine under Task');
	assert.ok(task.Complexity.childConcepts.Atomic && task.Complexity.childConcepts.Compound, 'Atomic/Compound under Complexity');
	assert.ok(task.Complexity.childConcepts.Compound.childConcepts.Expansion, 'Expansion nested under Compound');
	const claim = top.Claim.childConcepts;
	assert.ok(claim.Verification.childConcepts.Refuted, 'Refuted nested under Verification (cascade defeasance)');
	assert.ok(claim.Confidence.childConcepts.Trusted && claim.Freshness.childConcepts.Stale, 'Trusted/Stale gates');
	assert.ok(top.Frontier.childConcepts.InBeam && top.Frontier.childConcepts.Stuck, 'budget control under Frontier');
	// buildConceptTree derives _id/_name from the filename (engine invariant: key == _id)
	assert.equal(top.Task._name, 'Task');
	assert.equal(claim.Verification.childConcepts.Refuted._name, 'Refuted');
});

test('VALIDATES CLEAN (0 errors) — authorable + canonicalization-barrier-safe', () => {
	const { errors, warnings } = validateConceptTree(tree());
	assert.equal(errors.length, 0, 'no errors: ' + JSON.stringify(errors));
	assert.equal(warnings.filter((w) => w.kind === 'unstratified-cycle').length, 0, 'acyclic spine — stratified (no K7 oscillation)');
	// the continuous-vs-snapped axis: every gate keys on a snapped enum / a `.length`, never a raw float
	const cont = validateConceptTree(tree(), { flagContinuousGates: true });
	assert.equal(cont.errors.length, 0);
	assert.equal(cont.warnings.filter((w) => w.kind === 'continuous-gate').length, 0, 'no raw-float gate (K1-safe by construction)');
});

test('non-vacuous: swapping a snapped-band gate for a raw float on the SAME tree IS flagged', () => {
	// proves the clean pass above is real — the validator would catch a barrier breach here.
	const t = tree();
	t.childConcepts.Claim.childConcepts.Confidence.childConcepts.Trusted.ensure = ['$conf >= 0.7'];
	const { warnings } = validateConceptTree(t, { flagContinuousGates: true });
	assert.equal(warnings.filter((w) => w.kind === 'continuous-gate').length, 1, 'a raw-float gate is flagged — the clean pass is not vacuous');
});
