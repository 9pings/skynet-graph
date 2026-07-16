'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { describeMethod, describeLibrary, formatLibrary, templateCountOf } = require('../../plugins/learning/lib/method-explorer');

const M = ( sig, templates ) => ({ structure: { taskKind: sig }, content: { colRef: 'x' }, method: { id: 'm_' + sig, templatesBySig: templates } });
const LIB = { entries: [
	M('count|1', { a: {}, b: {} }),   // 2 templates
	M('count|1', { c: {} }),          // same class → reused
	M('none|1', { d: {} }),
	M('max|1', { e: {}, f: {}, g: {} }),
] };

test('describeMethod — title, category, mini-description from the typed structure', () => {
	const d = describeMethod({ structure: { taskKind: 'count|1', domain: 'wikisql' }, content: { colRef: 1 }, method: { templatesBySig: { a: {} } } });
	assert.equal(d.category, 'domain=wikisql,taskKind=count|1');
	assert.equal(d.title, 'wikisql · count|1');
	assert.match(d.description, /keys on \{domain, taskKind\}/);
	assert.match(d.description, /derives \{colRef\}/);
	assert.equal(d.templateCount, 1);
});

test('describeMethod — untyped structure is labelled, never crashes', () => {
	const d = describeMethod({ structure: {}, content: {}, method: {} });
	assert.equal(d.category, '(untyped)');
	assert.equal(d.title, '(untyped)');
});

test('templateCountOf — templatesBySig / templates array / single / none', () => {
	assert.equal(templateCountOf({ templatesBySig: { a: {}, b: {} } }), 2);
	assert.equal(templateCountOf({ templates: [1, 2, 3] }), 3);
	assert.equal(templateCountOf({ derivation: {} }), 1);
	assert.equal(templateCountOf({}), 0);
	assert.equal(templateCountOf(null), 0);
});

test('describeLibrary — population count + class distribution (categories sorted by count)', () => {
	const r = describeLibrary(LIB);
	assert.equal(r.population.count, 4);
	assert.equal(r.population.categories[0].category, 'taskKind=count|1');   // the most frequent class first
	assert.equal(r.population.categories[0].count, 2);
	assert.equal(r.population.openness.distinctClasses, 3);
});

test('describeLibrary — COVERAGE against a declared registry enum reports the GAPS (missing classes)', () => {
	const registry = { keys: { taskKind: { enum: ['none|1', 'count|1', 'max|1', 'min|1', 'sum|1', 'avg|1'] } } };
	const cov = describeLibrary(LIB, { registry }).population.coverage.find(( c ) => c.key === 'taskKind' );
	assert.equal(cov.expected, 6);
	assert.equal(cov.covered, 3);                                  // none|1, count|1, max|1 present
	assert.deepEqual(cov.missing, ['avg|1', 'min|1', 'sum|1']);    // the population's GAPS
	assert.equal(cov.fraction, 3 / 6);
});

test('describeLibrary — COVERAGE via an explicit expected value-space (no registry)', () => {
	const cov = describeLibrary(LIB, { expected: { taskKind: ['none|1', 'count|1'] } }).population.coverage.find(( c ) => c.key === 'taskKind' );
	assert.equal(cov.covered, 3);       // 3 present values overall
	assert.equal(cov.expected, 2);
	assert.equal(cov.fraction, 1);      // both expected values are covered → 100%
	assert.deepEqual(cov.missing, []);
});

test('describeLibrary — OPENNESS: singletons, templates/method, entropy over the class distribution', () => {
	const o = describeLibrary(LIB).population.openness;
	assert.equal(o.singletonFraction, 2 / 3);                 // none|1 and max|1 are singletons of 3 classes
	assert.equal(o.avgTemplatesPerMethod, (2 + 1 + 1 + 3) / 4);
	assert.ok(o.entropyBits > 0 && o.entropyBits <= o.maxEntropyBits);
	// a fully-concentrated library (one class) has 0 entropy
	const flat = describeLibrary({ entries: [M('count|1', { a: {} }), M('count|1', { b: {} })] }).population.openness;
	assert.equal(flat.entropyBits, 0);
	assert.equal(flat.distinctClasses, 1);
});

test('formatLibrary — renders a listing + population summary including coverage GAPS', () => {
	const registry = { keys: { taskKind: { enum: ['none|1', 'count|1', 'max|1', 'sum|1'] } } };
	const s = formatLibrary(describeLibrary(LIB, { registry }));
	assert.match(s, /CONCEPT-METHODS — 4 method/);
	assert.match(s, /GAPS: sum\|1/);
	assert.match(s, /openness:/);
});
