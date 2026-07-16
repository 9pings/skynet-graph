'use strict';
/**
 * BRICK 1 — a METHOD receives a SUB-GRAPH as a parameter and applies it (higher-order via typed named slots).
 * Design doc: doc/WIP/studies/2026-06-28-concept-as-graph-conception-assembled.md (§3 / C2).
 *
 *   applySubgraphArg(graph, paramBody, ctx, targetId, cb) — bind a PARAMETERIZED body sub-graph into a
 *       call-site SLOT (fresh id-base + rebound frontier refs) and splice it SEQUENCED under the slot,
 *       parented (_origin). Throws if a frontier ref is unbound (a leak), never an unsound partial splice.
 *   mapSubgraph(graph, { elements, body, slotId, ... }, cb) — the Map combinator: apply the body to EACH
 *       element, each instance with its OWN fresh base (finding #30: no per-element collision).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { relativize } = require('../../lib/authoring/core/abstract.js');
const { applySubgraphArg, mapSubgraph, mapTemplate } = require('../../lib/authoring/core/method.js');

const noConcepts = { common: { childConcepts: {} } };

// a body sub-graph (convert an element node → a Place node), authored GROUND then relativized into a
// PARAMETERIZED method: frontier `elem` = the element it converts; its created ids derive from base 'B'.
const bodyParam = relativize(
	[ { _id: 'B_out', Node: true, kind: 'Place', from: 'ELEM' },
	  { _id: 'B_seg', Segment: true, originNode: 'ELEM', targetNode: 'B_out', label: 'convert' } ],
	{ base: 'B', refs: { elem: 'ELEM' } }
);

function mkGraph( extraNodes ) {
	return new Graph({ lastRev: 0,
		nodes: [ { _id: 'E', Node: true, kind: 'POI', name: 'eiffel' }, { _id: 'So', Node: true }, { _id: 'St', Node: true } ].concat(extraNodes || []),
		segments: [ { _id: 'slot', Segment: true, originNode: 'So', targetNode: 'St' } ] },
		{ label: 'm', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, noConcepts);
}

test('applySubgraphArg binds a body sub-graph into a slot (fresh base, rebound frontier) and splices it parented', async () => {
	const g = mkGraph();
	await nextStable(g);

	await new Promise(( res ) => applySubgraphArg(g, bodyParam, { base: 'app0', refs: { elem: 'E' } }, 'slot', res));
	await nextStable(g);

	const out = g.getEtty('app0_out'), seg = g.getEtty('app0_seg');
	assert.ok(out && seg, 'the body was spliced with the fresh base');
	assert.equal(out._.kind, 'Place');
	assert.equal(out._.from, 'E', 'frontier ref rebound to the call-site element');
	assert.equal(seg._.originNode, 'E');
	assert.equal(seg._.targetNode, 'app0_out');
	assert.equal(out._._origin, 'slot', 'the spliced sub-graph is parented under the slot');
});

test('applySubgraphArg THROWS on an unbound frontier ref (a leak), never an unsound partial splice', async () => {
	const g = mkGraph();
	await nextStable(g);
	assert.throws(
		() => applySubgraphArg(g, bodyParam, { base: 'appX', refs: {} }, 'slot', () => {}),
		/unbound|frontier|leak/i
	);
});

test('mapSubgraph applies the body to EACH element of a collection — N distinct instances, no collision (#30)', async () => {
	const g = mkGraph([
		{ _id: 'e0', Node: true, kind: 'POI', name: 'louvre' },
		{ _id: 'e1', Node: true, kind: 'POI', name: 'arc' },
		{ _id: 'e2', Node: true, kind: 'POI', name: 'sacre' }
	]);
	await nextStable(g);

	await new Promise(( res ) => mapSubgraph(g, { elements: ['e0', 'e1', 'e2'], body: bodyParam, slotId: 'slot' }, res));
	await nextStable(g);

	// each element got its OWN converted Place, from its own element, with a distinct id (no merge-onto-one).
	const outs = ['e0', 'e1', 'e2'].map(( e, i ) => g.getEtty('map' + i + '_out'));
	assert.ok(outs.every(Boolean), 'three distinct body instances were created');
	assert.deepEqual(outs.map(( o ) => o._.from), ['e0', 'e1', 'e2'], 'each instance converts its OWN element');
	assert.equal(new Set(outs.map(( o ) => o._._id)).size, 3, 'distinct ids — no per-element collision');
	assert.ok(outs.every(( o ) => o._.kind === 'Place'), 'each produced a Place');
});

test('a Map CONCEPT fans the body over its collection DURING stabilization (engine-orchestrated, not host-driven)', async () => {
	const n = { calls: 0 };
	Graph._providers = { M: { map: function ( g, c, scope, argz, cb ) {
		n.calls++;
		const seg = scope._;
		// the method receives the body sub-graph (here closed over) + the collection from its own facts;
		// it RETURNS the fan-out template — the ENGINE applies it (parented under the cast slot).
		// the provider must set the concept's _name (the cast marker) — else the engine re-fires it (no
		// auto-mark for provider concepts; Concept.js:213-229). Mirrors f6's `plan` setting `Split:true`.
		cb(null, [ { $_id: '_parent', Map: true } ].concat(mapTemplate({ elements: seg.coll, body: bodyParam })));
	} } };
	const tree = { common: { childConcepts: {
		Map: { _id: 'Map', _name: 'Map', require: ['Segment', 'coll'], provider: ['M::map'] }
	} } };
	const g = new Graph({ lastRev: 0,
		nodes: [ { _id: 'e0', Node: true, kind: 'POI' }, { _id: 'e1', Node: true, kind: 'POI' }, { _id: 'So', Node: true }, { _id: 'St', Node: true } ],
		segments: [ { _id: 'slot', Segment: true, originNode: 'So', targetNode: 'St', coll: ['e0', 'e1'] } ] },
		{ label: 'cm', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
	await nextStable(g);

	assert.equal(n.calls, 1, 'Map cast exactly once on the collection segment');
	const o0 = g.getEtty('map0_out'), o1 = g.getEtty('map1_out');
	assert.ok(o0 && o1, 'the ENGINE built the mapped sub-graph during stabilization');
	assert.deepEqual([o0._.from, o1._.from], ['e0', 'e1'], 'each engine-built instance converts its own element');
	assert.equal(o0._._origin, 'slot', 'parented under the Map slot');
});
