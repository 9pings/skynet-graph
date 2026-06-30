'use strict';
/**
 * deleteConcept — the symmetric inverse of addConcept (grammar CRUD completion; the Studio operator must be able
 * to REMOVE a concept, not only add/patch it). Exercised on the REAL shipped `common` travel/geo grammar: deleting
 * a concept UN-CASTS it everywhere (the fact-marker is removed → dependents cascade), drops it (and its subtree)
 * from the registry + serialize(), and a re-add works. CORE change → full-suite + this regression (méthodo §4).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Graph = require('../_boot.js');
const { buildConceptTree } = require('../../lib/authoring/concepts.js');
const { register, CommonGeo } = require('../../lib/providers');
const { nextStable } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

function boot() {
	register(Graph, [{ CommonGeo }]);
	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'concepts', 'common'), { exclude: ['targetNode'] });
	const seed = { lastRev: 0,
		nodes: [ { _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } }, { _id: 'singapore', Position: { lat: 1.3521, lng: 103.8198 } } ],
		segments: [ { _id: 'long', originNode: 'paris', targetNode: 'singapore' } ] };
	const g = new Graph(seed, { label: 'del', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: tree });
	return g;
}
const cast = ( g, id, name ) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[name]);
const fact = ( g, id, name ) => g._objById[id] && g._objById[id]._etty._[name];

test('deleteConcept — un-casts on the real `common` grammar, drops from registry + serialize; siblings/parents untouched', async () => {
	const g = boot(); await nextStable(g);
	assert.ok(cast(g, 'long', 'LongTravel'), 'precondition: LongTravel is cast on the long edge');
	assert.ok(cast(g, 'long', 'Edge') && cast(g, 'long', 'Travel') && cast(g, 'long', 'Distance'), 'precondition: Edge/Travel/Distance cast');

	await new Promise(( res ) => g.deleteConcept('LongTravel', () => res()));

	assert.ok(!g.getConceptByName('LongTravel'), 'LongTravel removed from the registry');
	assert.equal(cast(g, 'long', 'LongTravel'), false, 'LongTravel un-cast on the long edge');
	assert.ok(!fact(g, 'long', 'LongTravel'), 'the LongTravel fact-marker is gone');
	// the parent + siblings + their facts are UNTOUCHED (a surgical delete, not a subtree wipe of unrelated concepts).
	assert.ok(cast(g, 'long', 'Edge') && cast(g, 'long', 'Travel') && cast(g, 'long', 'Distance'), 'Edge/Travel/Distance still cast');
	assert.ok(fact(g, 'long', 'Distance'), 'Distance value preserved');
	// serialize() no longer carries LongTravel anywhere in the concept tree it round-trips.
	assert.ok(!JSON.stringify(g.serialize()).includes('LongTravel'), 'serialize() drops the deleted concept');
	assert.ok(g.getRevisions().length < 100, 'bounded — no apply-cap runaway');
});

test('deleteConcept — re-add after delete works (registry cleaned → no duplicate-_id error) and re-casts', async () => {
	const g = boot(); await nextStable(g);
	const concept = g.getConceptByName('LongTravel');
	const schema = JSON.parse(JSON.stringify(concept._schema));            // capture before delete
	const parentId = concept._parent ? concept._parent._id : undefined;

	await new Promise(( res ) => g.deleteConcept('LongTravel', () => res()));
	assert.ok(!g.getConceptByName('LongTravel'));

	// re-add under the same parent — must NOT throw "duplicate _id" (the registry was cleaned).
	await new Promise(( res ) => g.addConcept(parentId, schema, () => res()));
	assert.ok(g.getConceptByName('LongTravel'), 'LongTravel re-registered');
	await nextStable(g);
	assert.ok(cast(g, 'long', 'LongTravel'), 'the re-added concept re-casts on the long edge');
});

test('deleteConcept — deleting a PARENT removes its whole SUBTREE from the registry', async () => {
	const g = boot(); await nextStable(g);
	const travel = g.getConceptByName('Travel');
	const childIds = travel._openConcepts ? Object.keys(travel._openConcepts) : [];
	// Travel has children in the shipped grammar (LongTravel/ShortTravel live under it).
	assert.ok(childIds.length > 0, 'precondition: Travel has child concepts');

	await new Promise(( res ) => g.deleteConcept('Travel', () => res()));
	assert.ok(!g.getConceptByName('Travel'), 'Travel removed');
	for ( const cid of childIds ) assert.equal(g._conceptLib[cid], undefined, `child ${cid} removed with the subtree`);
	assert.equal(cast(g, 'long', 'Travel'), false, 'Travel un-cast');
});

test('deleteConcept — NEG: a non-existent concept throws (no silent no-op)', async () => {
	const g = boot(); await nextStable(g);
	assert.throws(() => g.deleteConcept('NoSuchConcept'), /no concept 'NoSuchConcept'/);
});

test('deleteConcept — re-entrant: a delete issued mid-stabilize defers + drains at the quiescent boundary', async () => {
	const g = boot(); await nextStable(g);
	// force the deferred path by flagging mid-stabilize, then queue + drain manually (mirrors the #11.a contract).
	g._stabilizing = true;
	g.deleteConcept('LongTravel');                                         // queued, NOT applied yet
	assert.ok(g.getConceptByName('LongTravel'), 'deferred: not removed while _stabilizing');
	assert.equal(g._pendingStructural.length, 1, 'queued in _pendingStructural');
	g._stabilizing = false;
	g._drainStructural();                                                  // the quiescent-boundary drain
	assert.ok(!g.getConceptByName('LongTravel'), 'drained: removed at the boundary');
});
