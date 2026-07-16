'use strict';
/**
 * Studio grammar workbench + corpus exchange — the new Session/Studio ops: the concept↔fact
 * grammar graph, the derived manifest + `.sgc` export, the retraction event (derived Session-side
 * from the state diff), provider trace, and the merge-projection preview. Driven without a browser.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../../lib/index.js');
const Session = require('../../lib/studio/session.js');
const Studio = require('../../lib/studio/studio.js');
const { OPS, EVENTS } = require('../../lib/studio/protocol.js');
const { unpackCorpus } = require('../../lib/authoring/core/corpus-pack.js');
console.log = console.info = console.warn = () => {};

const CONCEPTS = path.join(__dirname, '..', '..', 'concepts');
const SEED = { conceptMaps: [
	{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
	{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },
	{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
] };

test('protocol exposes the new ops + the retract event', () => {
	for ( const op of ['grammarGraph', 'corpusManifest', 'exportCorpus', 'importCorpus', 'providerTrace', 'mergePreview'] )
		assert.ok(OPS.includes(op), 'OPS includes ' + op);
	assert.ok(EVENTS.includes('retract'), 'EVENTS includes retract');
});

test('grammarGraph: the concept↔fact flux graph + tiling overlay of the loaded corpus', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const g = s.grammarGraph();
	assert.ok(g.concepts.some(c => c.name === 'Distance'), 'Distance is a concept node');
	assert.ok(g.facts.some(f => f.key === 'Distance'), 'Distance is a fact node');
	assert.ok(g.tiling && g.tiling.separators.includes('Distance'), 'tiling overlay present');
	assert.ok(g.entryPoints.includes('Node'), 'Node is an entry point');
});

test('corpusManifest + exportCorpus: derives the alphabet/providers and round-trips a .sgc bundle', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const m = s.corpusManifest({ name: 'common', version: '2.0.0' });
	assert.ok(m.providersRequired.includes('CommonGeo::Distance'));
	assert.ok(m.alphabet.produces.includes('Distance'));
	const bundle = s.exportCorpus({ name: 'common', version: '2.0.0' });
	assert.equal(bundle.format, 'sgc');
	const back = unpackCorpus(bundle, { validate: true });
	assert.ok(back.conceptMap && Object.keys(back.conceptMap).length, 'bundle carries a concept map');
	assert.ok((back.validation || []).every(v => v.errors.length === 0), 'exported corpus re-validates clean');
});

test('importCorpus: validates and loads an .sgc bundle into the studio root session', () => {
	const studio = new Studio({ Graph, root: CONCEPTS });
	studio.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const bundle = studio.getSession('root').exportCorpus({ name: 'common', version: '1.0.0' });
	const res = studio.importCorpus(bundle, { builtins: true, seed: SEED });
	assert.ok(res.ok, 'import succeeds: ' + JSON.stringify(res.errors || []));
	assert.ok(studio.getSession('root').grammarGraph().concepts.length > 0, 'corpus is live after import');
});

test('retract event: an ensure that falls retracts the concept and reports it Session-side', async () => {
	const s = new Session('root', { Graph });
	// synthetic grammar: `Tagged` casts on a Segment while `keep==true`, retracts when it falls
	const conceptMap = { test: { childConcepts: {
		Tagged: { _id: 'Tagged', _name: 'Tagged', require: 'Segment', ensure: ['$keep==true'] }
	} } };
	const seed = { conceptMaps: [
		{ _id: 'a', Node: true }, { _id: 'b', Node: true },
		{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b', keep: true }
	] };
	const settled = () => new Promise(( r ) => s.once('stabilize', r));
	let p = settled();
	s.loadCorpus({ conceptMap, sets: ['test'], seed });
	await p;
	assert.ok(s.state().objects.find(o => o._id === 's').Tagged !== undefined, 'Tagged cast while keep==true');

	const retracts = [];
	s.on('retract', ( r ) => retracts.push(r));
	p = settled();
	s.mutate({ $$_id: 's', keep: false }, 's');   // ensure falls -> Tagged retracts
	await p;
	assert.ok(retracts.some(r => r.targetId === 's' && r.concepts.includes('Tagged')), 'retract event for Tagged on s');
});

test('mergePreview: flags a fact crossing the fork frontier that is not in the alphabet', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const r = s.mergePreview({ $$_id: 'belief', ellA: 0.6, steps: 42 }, { frontierAlphabet: ['ellA'] });
	assert.ok(r.warnings.some(w => w.kind === 'frontier-leak' && w.ref === 'steps'), 'steps leak flagged');
	assert.ok(!r.warnings.some(w => w.ref === 'ellA'), 'a declared frontier key does not flag');
});

test('providerTrace returns the apply-correlated log records as an array', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	assert.ok(Array.isArray(s.providerTrace(20)), 'providerTrace returns an array');
});
