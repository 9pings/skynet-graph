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
