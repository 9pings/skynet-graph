'use strict';
/**
 * Author-time concept validation — the ENFORCEMENT of the typed-fact spine. The
 * headline check: a `require`/`ensure`/`assert` edge that keys on a PROSE fact is
 * rejected before it can fragment the memo at runtime (K1). Plus structure checks
 * (self-flag name, expression parseability) — NEVER a cap on the grammar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConceptTree, validateOrThrow, stratificationWarnings, validateMergeProjection } = require('../../lib/authoring/validate');
const { buildConceptTree } = require('../../lib/authoring/concepts');
const { loopConceptTree } = require('../../lib/authoring/loop');

// An upstream classifier with the {facts, prose} contract + two downstreams: one keyed
// on the discrete fact (sound), one keyed on the prose key (the K1 violation).
const tree = () => ({
	childConcepts: {
		Classify: {
			_id: 'Classify', _name: 'Classify', require: ['Segment'], provider: ['LLM::complete'],
			prompt: { facts: { bucket: { enum: ['low', 'high'] } }, prose: 'summary' }
		},
		Good: { _id: 'Good', _name: 'Good', require: ['Classify'], ensure: ["$bucket=='high'"], provider: ['AI::act'] },
		Bad:  { _id: 'Bad', _name: 'Bad', require: ['Classify'], ensure: ['$summary != null'], provider: ['AI::act'] }
	}
});

test('rejects a require/ensure that depends on a PROSE key (K1 enforcement)', () => {
	const { errors } = validateConceptTree(tree());
	const proseErr = errors.filter((e) => e.kind === 'prose-dependency');
	assert.equal(proseErr.length, 1, 'exactly the prose-keyed edge is flagged');
	assert.equal(proseErr[0].concept, 'Bad');
	assert.match(proseErr[0].message, /prose key "summary"/);
});

test('accepts a downstream keyed on the DISCRETE fact (no false positive)', () => {
	const { errors } = validateConceptTree(tree());
	assert.equal(errors.filter((e) => e.concept === 'Good').length, 0, 'Good (keyed on $bucket) is clean');
});

test('default prose key (<name>Prose) is also caught when no `prose` is declared', () => {
	const t = {
		childConcepts: {
			C: { _id: 'C', _name: 'C', require: ['Segment'], provider: ['LLM::complete'], prompt: { facts: { x: { type: 'int' } } } },
			D: { _id: 'D', _name: 'D', require: ['C'], ensure: ['$CProse == 5'], provider: ['AI::act'] }
		}
	};
	const { errors } = validateConceptTree(t);
	assert.equal(errors.filter((e) => e.kind === 'prose-dependency' && e.concept === 'D').length, 1);
});

test('flags a missing _name (self-flag) — would re-fire forever', () => {
	// any node listed in childConcepts IS a concept and must carry a _name to self-flag.
	const t = { childConcepts: { P: { _id: 'P', _name: 'P', childConcepts: { X: { _id: 'X', require: ['Segment'], provider: ['AI::act'] } } } } };
	const { errors } = validateConceptTree(t);
	assert.ok(errors.some((e) => e.kind === 'no-name' && e.concept === 'X'), 'nameless concept rejected');
});

test('rejects an unparseable expression but NEVER caps the grammar', () => {
	const broken = { childConcepts: { B: { _id: 'B', _name: 'B', ensure: ['$x ==== ('], provider: ['AI::act'] } } };
	assert.ok(validateConceptTree(broken).errors.some((e) => e.kind === 'unparseable'));

	// rich-but-legal expressions (member access, calls, ternary) must PASS untouched
	const rich = { childConcepts: { R: { _id: 'R', _name: 'R', ensure: ['$X.items.length > 0 ? $X.score >= 0.7 : false'], provider: ['AI::act'] } } };
	assert.equal(validateConceptTree(rich).errors.length, 0, 'expressiveness is not capped');

	const evil = { childConcepts: { E: { _id: 'E', _name: 'E', ensure: ["$x.constructor('boom')"], provider: ['AI::act'] } } };
	assert.ok(validateConceptTree(evil).errors.some((e) => e.kind === 'blocked-prop'), 'prototype-chain escape blocked');
});

test('warns on a bare child-set dependency (the all-children aggregation footgun)', () => {
	const t = { childConcepts: { Roll: { _id: 'Roll', _name: 'Roll', require: ['answeredBy'], provider: ['AI::act'] } } };
	const { warnings } = validateConceptTree(t);
	assert.ok(warnings.some((w) => w.kind === 'aggregating-dependency'));
	// the same dependency WITH .length is sound (no warning)
	const ok = { childConcepts: { Roll: { _id: 'Roll', _name: 'Roll', ensure: ['$answeredBy.length == $childCount'], provider: ['AI::act'] } } };
	assert.equal(validateConceptTree(ok).warnings.filter((w) => w.kind === 'aggregating-dependency').length, 0);
});

test('palette is advisory (warning), strict promotes it to an error', () => {
	const t = tree();
	const opts = { palette: ['LLM::complete'] };           // AI::act not in palette
	assert.ok(validateConceptTree(t, opts).warnings.some((w) => w.kind === 'provider-not-in-palette'));
	assert.ok(validateConceptTree(t, { ...opts, strict: true }).errors.some((e) => e.kind === 'provider-not-in-palette'));
});

test('validateOrThrow throws on the first error', () => {
	assert.throws(() => validateOrThrow(tree()), /prose key "summary"/);
});

test('REGRESSION: the shipped concepts/common set and the answer-loop validate clean', () => {
	const common = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'));
	assert.equal(validateConceptTree(common).errors.length, 0, 'no false positives on the real concept set');
	assert.equal(validateConceptTree(loopConceptTree).errors.length, 0, 'the decompose loop validates clean');
});

// --- ref-soundness layer 3 (roadmap #10 / MODELISATION §6.5): catch a require/ensure
//     that references a fact NO concept produces and the host's ref-alphabet does not
//     declare — the "silently never fires" footgun an AI author makes. Gated on a
//     declared `knownFacts` alphabet so it stays sound (no false positives otherwise).

test('without a declared ref-alphabet, the unknown-ref check is inactive', () => {
	const t = { childConcepts: { C: { _id: 'C', _name: 'C', require: ['Imaginary'], provider: ['AI::act'] } } };
	const { warnings, errors } = validateConceptTree(t);
	assert.equal(warnings.filter((w) => w.kind === 'unknown-ref').length, 0, 'no ref alphabet -> no unknown-ref noise');
	assert.equal(errors.filter((e) => e.kind === 'unknown-ref').length, 0);
});

test('with a ref-alphabet, flags a require on a fact no concept produces nor the alphabet declares', () => {
	const t = {
		childConcepts: {
			C: { _id: 'C', _name: 'C', require: ['Segment'], provider: ['AI::act'] },          // Segment in alphabet -> clean
			D: { _id: 'D', _name: 'D', require: ['Imaginary'], provider: ['AI::act'] }          // produced by nobody -> flagged
		}
	};
	const { warnings } = validateConceptTree(t, { knownFacts: ['Segment'] });
	const unk = warnings.filter((w) => w.kind === 'unknown-ref');
	assert.equal(unk.length, 1, 'exactly the never-resolves ref is flagged');
	assert.equal(unk[0].concept, 'D');
	assert.match(unk[0].message, /Imaginary/);
});

test('a fact produced by a sibling concept (self-flag or applyMutations key) is NOT flagged', () => {
	const t = {
		childConcepts: {
			// Producer writes `Ready` via its applyMutations template (a produced fact, not a self-flag)
			Producer: { _id: 'Producer', _name: 'Producer', require: ['Segment'], applyMutations: [{ $_id: '_parent', Producer: true, Ready: true }] },
			// Consumer depends on Producer (self-flag) AND Ready (template-produced) -> both sound
			Consumer: { _id: 'Consumer', _name: 'Consumer', require: ['Producer'], ensure: ['$Ready == true'], provider: ['AI::act'] }
		}
	};
	const { warnings } = validateConceptTree(t, { knownFacts: ['Segment'] });
	assert.equal(warnings.filter((w) => w.kind === 'unknown-ref').length, 0, 'produced facts resolve — no false positive');
});

test('cross-object walk refs (a:b) are not flagged — too dynamic to judge soundly', () => {
	const t = { childConcepts: { C: { _id: 'C', _name: 'C', require: ['originNode:Position'], provider: ['AI::act'] } } };
	const { warnings } = validateConceptTree(t, { knownFacts: ['Segment'] });
	assert.equal(warnings.filter((w) => w.kind === 'unknown-ref').length, 0, 'cross-walk skipped (no false positive)');
});

test('strict promotes an unknown-ref to an error', () => {
	const t = { childConcepts: { D: { _id: 'D', _name: 'D', require: ['Imaginary'], provider: ['AI::act'] } } };
	assert.ok(validateConceptTree(t, { knownFacts: [], strict: true }).errors.some((e) => e.kind === 'unknown-ref'));
});

// --- continuous-vs-snapped axis (#P4): catch a raw float on a defeasant gate (the A2
//     footgun the bricks rely on snapping away). Opt-in so it never false-flags by default.

const rawGate = () => ({ childConcepts: {
	Up: { _id: 'Up', _name: 'Up', require: ['Segment'], provider: ['AI::est'], applyMutations: [{ $_id: '_parent', pHat: 0.5, relRank: 1 }] },
	// THE A2 FAILURE: a defeasant gate on a raw continuous value
	Audit: { _id: 'Audit', _name: 'Audit', require: ['Up'], ensure: ['$pHat >= 0.7'], provider: ['AI::act'] },
	// the barrier-clean equivalent: gate on the SNAPPED rank
	AuditOk: { _id: 'AuditOk', _name: 'AuditOk', require: ['Up'], ensure: ['$relRank >= 1'], provider: ['AI::act'] }
} });

test('continuous-gate check is OFF by default (no false positives, never caps the grammar)', () => {
	const { warnings, errors } = validateConceptTree(rawGate());
	assert.equal(warnings.filter((w) => w.kind === 'continuous-gate').length, 0);
	assert.equal(errors.filter((e) => e.kind === 'continuous-gate').length, 0);
});

test('opt-in flags a raw float on a defeasant ensure gate (A2), not the snapped-rank gate', () => {
	const { warnings } = validateConceptTree(rawGate(), { flagContinuousGates: true });
	const cg = warnings.filter((w) => w.kind === 'continuous-gate');
	assert.equal(cg.length, 1, 'exactly the raw-float gate is flagged');
	assert.equal(cg[0].concept, 'Audit');
	assert.match(cg[0].message, /"pHat" against fractional 0\.7/);
	// $relRank >= 1 (integer, snapped rank) is NOT flagged
	assert.equal(cg.filter((w) => w.concept === 'AuditOk').length, 0, 'snapped-rank gate is clean');
});

test('opt-in: snapped-convention facts and host-exempted facts are not flagged', () => {
	const t = { childConcepts: {
		Up: { _id: 'Up', _name: 'Up', require: ['Segment'], provider: ['AI::est'] },
		A: { _id: 'A', _name: 'A', require: ['Up'], ensure: ['$scoreBucket >= 0.5'], provider: ['AI::act'] },   // …Bucket convention -> snapped
		C: { _id: 'C', _name: 'C', require: ['Up'], ensure: ['$confidence >= 0.7'], provider: ['AI::act'] }       // exempted (k-of-n confidence)
	} };
	const { warnings } = validateConceptTree(t, { flagContinuousGates: true, continuousExempt: ['confidence'] });
	assert.equal(warnings.filter((w) => w.kind === 'continuous-gate').length, 0, 'convention + exempt both suppressed');
});

test('strict promotes a continuous-gate to an error', () => {
	const { errors } = validateConceptTree(rawGate(), { flagContinuousGates: true, strict: true });
	assert.ok(errors.some((e) => e.kind === 'continuous-gate' && e.concept === 'Audit'));
});

// --- stratification lint (#5.3 / P-K7): a dependency cycle through a NEGATED edge may oscillate.

test('flags a dependency cycle through a negated edge (unstratified, K7)', () => {
	const t = { childConcepts: {
		// A depends on B (positive, require) and produces fA; B depends on fA NEGATIVELY (ensure !$fA)
		A: { _id: 'A', _name: 'A', require: ['B'], applyMutations: [{ $_id: '_parent', A: true, fA: true }] },
		B: { _id: 'B', _name: 'B', require: ['Seg'], ensure: ['!$fA'], applyMutations: [{ $_id: '_parent', B: true }] }
	} };
	const { warnings } = validateConceptTree(t);
	const cyc = warnings.filter((w) => w.kind === 'unstratified-cycle');
	assert.equal(cyc.length, 1, 'the negated cycle is flagged once');
	assert.deepEqual([...cyc[0].cycle].sort(), ['A', 'B']);
});

test('a PURELY POSITIVE cycle is NOT flagged (monotone mutual support)', () => {
	const t = { childConcepts: {
		A: { _id: 'A', _name: 'A', require: ['B'], applyMutations: [{ $_id: '_parent', A: true }] },
		B: { _id: 'B', _name: 'B', require: ['A'], applyMutations: [{ $_id: '_parent', B: true }] }
	} };
	assert.equal(validateConceptTree(t).warnings.filter((w) => w.kind === 'unstratified-cycle').length, 0);
});

test('the shipped common set and the answer-loop are stratified (no false positives)', () => {
	const common = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'));
	assert.equal(stratificationWarnings(common).length, 0, 'common set is stratified');
	assert.equal(stratificationWarnings(loopConceptTree).length, 0, 'answer-loop is stratified');
});

test('strict promotes an unstratified cycle to an error; skipStratification disables it', () => {
	const t = { childConcepts: {
		A: { _id: 'A', _name: 'A', require: ['B'], applyMutations: [{ $_id: '_parent', A: true, fA: true }] },
		B: { _id: 'B', _name: 'B', require: ['Seg'], ensure: ['!$fA'], applyMutations: [{ $_id: '_parent', B: true }] }
	} };
	assert.ok(validateConceptTree(t, { strict: true }).errors.some((e) => e.kind === 'unstratified-cycle'));
	assert.equal(validateConceptTree(t, { skipStratification: true }).warnings.filter((w) => w.kind === 'unstratified-cycle').length, 0);
});

// --- merge-projection contract validator (#P4 part b): the fork/merge frontier as a checked contract.

test('merge-projection: an undeclared crossing is flagged; declared keys are clean', () => {
	// the C1 contract: only ellA/ellB may cross
	const ok = validateMergeProjection({ $$_id: 'belief', ellA: 0.6 }, { frontierAlphabet: ['ellA', 'ellB'] });
	assert.equal(ok.warnings.length, 0, 'a declared snapped/contract key crosses cleanly');
	// a projection that leaks an undeclared key (e.g. search internals)
	const leak = validateMergeProjection({ $$_id: 'prob', sat: true, steps: 99 }, { frontierAlphabet: ['sat', 'coloring'] });
	const fl = leak.warnings.filter((w) => w.kind === 'frontier-leak');
	assert.equal(fl.length, 1);
	assert.match(fl[0].message, /"steps"/, 'the undeclared "steps" crossing is flagged');
});

test('merge-projection: inactive without a declared alphabet; strict promotes to error', () => {
	assert.equal(validateMergeProjection({ $$_id: 'x', whatever: 1 }, {}).warnings.length, 0, 'no alphabet -> no judgement');
	assert.ok(validateMergeProjection({ $$_id: 'x', z: 1 }, { frontierAlphabet: ['y'], strict: true }).errors.some((e) => e.kind === 'frontier-leak'));
});

test('merge-projection: flagContinuous warns on a raw float crossing (advisory; C1 still crosses it)', () => {
	const r = validateMergeProjection({ $$_id: 'belief', ellA: 0.6 }, { frontierAlphabet: ['ellA'], flagContinuous: true });
	const cc = r.warnings.filter((w) => w.kind === 'continuous-crossing');
	assert.equal(cc.length, 1, 'the raw-float crossing is surfaced (sound only if the parent snaps before gating)');
	assert.equal(r.warnings.filter((w) => w.kind === 'frontier-leak').length, 0, 'declared, so not a leak');
	// a snapped enum crossing is clean under flagContinuous
	assert.equal(validateMergeProjection({ $$_id: 'b', band: 'high' }, { frontierAlphabet: ['band'], flagContinuous: true })
		.warnings.filter((w) => w.kind === 'continuous-crossing').length, 0);
});
