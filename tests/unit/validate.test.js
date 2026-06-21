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
const { validateConceptTree, validateOrThrow } = require('../../_lab/validate');
const { buildConceptTree } = require('../../_lab/concepts');
const { loopConceptTree } = require('../../_lab/loop');

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
