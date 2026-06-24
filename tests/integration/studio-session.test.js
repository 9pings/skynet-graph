'use strict';
/**
 * Studio Session — the engine-facing wrapper the web layer drives. Tested without
 * any browser: drive ops, assert emitted events + serialized state.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../../lib/index.js');
const Session = require('../../lib/studio/session.js');
console.log = console.info = console.warn = () => {};

const CONCEPTS = path.join(__dirname, '..', '..', 'concepts');
const SEED = { conceptMaps: [
	{ _id: 'a', Node: true, Position: { lat: 48.85, lng: 2.35 } },
	{ _id: 'b', Node: true, Position: { lat: 1.35, lng: 103.8 } },
	{ _id: 's', Segment: true, originNode: 'a', targetNode: 'b' }
] };

test('loadCorpus + seed: stabilizes, casts Distance, emits conceptApply + stabilize+state', async () => {
	const s = new Session('root', { Graph });
	const applies = [];
	s.on('conceptApply', ( rec ) => applies.push(rec));
	let stateEvt = null;
	s.on('state', ( st ) => { stateEvt = st; });
	const settled = new Promise(( r ) => s.once('stabilize', r));

	const initial = s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	assert.equal(initial.objects.length, 3, 'state() returns the 3 seeded objects');

	await settled;
	const seg = s.state().objects.find(o => o._id === 's');
	assert.ok(seg.Distance && seg.Distance.inKm > 10000 && seg.Distance.inKm < 11000, 'Distance cast');
	assert.ok(applies.some(r => r.conceptName === 'Distance' && r.targetId === 's'), 'conceptApply for Distance→s');
	assert.ok(stateEvt && stateEvt.currentRev > 0, 'state event pushed on settle');
});

test('conceptTree + getConcept expose the loaded corpus', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const tree = s.conceptTree();
	assert.ok(tree.common && tree.common.childConcepts, 'conceptTree returns the set tree');
	const distance = s.getConcept('Distance');
	assert.ok(distance && distance._name === 'Distance', 'getConcept returns the Distance schema');
});

test('forkPlan op derives the tiling of the loaded corpus (the TilingOverlay)', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const plan = s.forkPlan();
	assert.ok(plan && Array.isArray(plan.separators), 'forkPlan returns a tiling');
	assert.ok(Array.isArray(plan.forks) && plan.forks.length > 0, 'derives forks/tiles');
	assert.equal(typeof plan.partitionPays, 'boolean');
	// every fork frontier is a subset of the derived separators (the contract closes)
	for ( const f of plan.forks ) for ( const sep of f.frontier ) assert.ok(plan.separators.includes(sep), 'frontier ⊆ separators');
});

test('the facade exposes createStudioServer (embeddable as a library)', () => {
	assert.equal(typeof Graph.createStudioServer, 'function', 'createStudioServer is exported from the facade');
});

test('validateConcept: a well-formed concept passes; a missing _name fails', () => {
	const s = new Session('root', { Graph });
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	const good = s.validateConcept({ _id: 'Probe', _name: 'Probe', require: ['Segment'] });
	assert.ok(good.ok, 'well-formed concept validates clean: ' + JSON.stringify(good.errors));
	const bad = s.validateConcept({ _id: 'NoName', require: ['Segment'] });
	assert.ok(!bad.ok && bad.errors.length, 'missing _name is rejected');
});

test('history: mutate -> diff shows the change -> rollback removes it', async () => {
	const s = new Session('root', { Graph });
	const settled = () => new Promise(( r ) => s.once('stabilize', r));
	let p = settled();
	s.loadCorpus({ conceptsDir: CONCEPTS, builtins: true, seed: SEED });
	await p;
	const r0 = s.state().currentRev;

	p = settled();
	s.mutate({ $$_id: 's', tag: 7 }, 's');
	await p;
	const r1 = s.state().currentRev;
	assert.ok(r1 > r0, 'mutation advanced the revision');
	assert.equal(s.state().objects.find(o => o._id === 's').tag, 7, 'tag applied');

	const d = s.diff(r0, r1);
	assert.ok((d.changed && d.changed.s) || (d.added && d.added.s), 'diff shows segment s changed between r0 and r1');

	p = settled();
	s.rollback(r0);
	await p;
	assert.equal(s.state().objects.find(o => o._id === 's').tag, undefined, 'rollback removed the tag');
});
