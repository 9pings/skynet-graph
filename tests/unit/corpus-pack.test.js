'use strict';
/**
 * Corpus exchange (lib/authoring/corpus-pack.js + lib/load.js export/validate) — the portable
 * `.sgc` bundle and its derived manifest (the produces/consumes alphabet, the required providers),
 * the disk round-trip (export -> reload), and validate-on-import. Pure + fs round-trip on the
 * real `common` corpus.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { deriveManifest, packCorpus, unpackCorpus } = require('../../lib/authoring/corpus-pack');
const { buildConceptTree } = require('../../lib/authoring/concepts');
const { loadConceptMap, exportConceptsToDir } = require('../../lib/load');

const common = () => buildConceptTree(path.join(__dirname, '../../concepts/common'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'sgc-' + p + '-'));

test('deriveManifest: the produces/consumes alphabet + required providers, off the real common set', () => {
	const m = deriveManifest({ common: common() }, { name: 'common', version: '1.2.3' });
	assert.equal(m.name, 'common');
	assert.equal(m.version, '1.2.3');
	assert.deepEqual(m.conceptSets, ['common']);
	assert.ok(m.providersRequired.includes('CommonGeo::Distance'), 'declares the geo provider it needs');
	assert.ok(m.alphabet.produces.includes('Distance'), 'Distance is produced');
	assert.ok(m.alphabet.consumes.includes('Node'), 'Node is an external input (consumed, not produced)');
	assert.ok(m.alphabet.consumes.includes('Segment'), 'Segment is an external input');
});

test('packCorpus -> unpackCorpus round-trips the concept map exactly', () => {
	const cm = { common: common() };
	const bundle = packCorpus(cm, { name: 'common', version: '1.0.0' });
	assert.equal(bundle.format, 'sgc');
	assert.equal(bundle.manifest.name, 'common');
	const back = unpackCorpus(bundle);
	assert.deepEqual(back.conceptMap, cm, 'the concept map survives the bundle round-trip');
	assert.equal(back.manifest.version, '1.0.0');
});

test('unpackCorpus({validate}) reports a structural error (missing _name) per set', () => {
	const broken = { format: 'sgc', sgcVersion: 1, manifest: {},
		conceptMap: { bad: { childConcepts: { Bad: { require: 'x' } } } } };   // Bad has no _name
	const back = unpackCorpus(broken, { validate: true });
	assert.ok(Array.isArray(back.validation), 'validation array present');
	const badSet = back.validation.find((v) => v.set === 'bad');
	assert.ok(badSet.errors.length > 0, 'the missing-_name concept is flagged');
});

test('exportConceptsToDir -> loadConceptMap round-trips the on-disk tree', () => {
	const dir = tmp('exp');
	const setDir = path.join(dir, 'common');
	exportConceptsToDir(common(), setDir);
	const reloaded = loadConceptMap(setDir);
	assert.deepEqual(reloaded.common, common(), 'disk export reloads to the identical tree');
	fs.rmSync(dir, { recursive: true, force: true });
});

test('loadConceptMap({validate}) passes a clean set and throws on an unparseable assert', () => {
	// clean: the real common set validates without error
	assert.doesNotThrow(() => loadConceptMap(path.join(__dirname, '../../concepts/common'), { validate: true }));
	// broken: a concept with an unparseable expression must throw on a validating load
	const dir = tmp('bad');
	fs.writeFileSync(path.join(dir, 'Bonk.json'), JSON.stringify({ require: 'Node', assert: ['$x +'] }));
	assert.throws(() => loadConceptMap(dir, { validate: true }), /Bonk|parse|assert/i);
	fs.rmSync(dir, { recursive: true, force: true });
});
