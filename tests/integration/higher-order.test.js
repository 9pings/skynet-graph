'use strict';
/**
 * higher-order (roadmap §5(a)) — the METHOD-SLOT / higher-order need. A "loop" method's behavioural hole (the body /
 * stop predicate) is filled by a DISPATCHED sub-method (P2/serveLeaf), applied over items (map/all/any). Swapping the
 * dispatched body changes behaviour = the loop-in-loop. Each body application is itself dispatch + mount + gate
 * (P1/P3/P4); soundness across the hop = KG-PROXY-2 (GO). ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { makeHigherOrderServe } = require('../../lib/authoring/higher-order.js');
const { createContextProjection } = require('../../lib/authoring/context-project.js');
console.log = console.info = console.warn = () => {};

// two candidate SLOT FILLERS (dispatched bodies): isHot (n>=100), isCold (n<100). Each is a full concept-method.
const bodySeed = ( item ) => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, n: item }, { _id: 'OUT', Node: true }],
	segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] });
const bodies = {
	isHot:  { conceptMap: { common: { childConcepts: { Ok: { _id: 'Ok', _name: 'Ok', require: ['Segment'], ensure: ['$originNode:n >= 100'] } } } },
		contract: { write: ['Ok'], post: [] }, boundedFrom: 's', boundedKeys: ['Ok'], buildSeed: ( bl ) => bodySeed(bl.item), value: ( sm ) => sm.Ok === true },
	isCold: { conceptMap: { common: { childConcepts: { Ok: { _id: 'Ok', _name: 'Ok', require: ['Segment'], ensure: ['$originNode:n < 100'] } } } },
		contract: { write: ['Ok'], post: [] }, boundedFrom: 's', boundedKeys: ['Ok'], buildSeed: ( bl ) => bodySeed(bl.item), value: ( sm ) => sm.Ok === true },
};
// higher-order "loop" methods — the body is DISPATCHED (leaf.bodyKey), not hardcoded.
const loops = {
	mapCheck: { bodyKeyOf: ( l ) => l.bodyKey || 'isHot', items: ( l ) => l.items || [120, 130, 50], combinator: 'map' },
	allCheck: { bodyKeyOf: ( l ) => l.bodyKey || 'isHot', items: ( l ) => l.items || [120, 130, 50], combinator: 'all' },
	anyCheck: { bodyKeyOf: ( l ) => l.bodyKey || 'isHot', items: ( l ) => l.items || [120, 130, 50], combinator: 'any' },
};

test('a method-SLOT is filled by a DISPATCHED body — the loop maps a mounted sub-method over its items', async () => {
	const serve = makeHigherOrderServe({ loops, bodies });
	try {
		const out = await serve({ id: 'm', produces: 'mapCheck', bodyKey: 'isHot', items: [120, 130, 50] });
		assert.deepEqual(out, [true, true, false], 'the loop applied the dispatched body isHot to each item');
		assert.ok(serve.pool.size() >= 1, 'the body ran on a mounted, shared instance (dispatch + mount)');
	} finally { await serve.close(); }
});

test('SWAP the slot filler → different behaviour (the method-slot is a real behavioural hole, not hardcoded)', async () => {
	const serve = makeHigherOrderServe({ loops, bodies });
	try {
		const hot  = await serve({ id: 'm', produces: 'mapCheck', bodyKey: 'isHot',  items: [120, 130, 50] });
		const cold = await serve({ id: 'm', produces: 'mapCheck', bodyKey: 'isCold', items: [120, 130, 50] });
		assert.deepEqual(hot,  [true, true, false]);
		assert.deepEqual(cold, [false, false, true], 'SAME loop, DIFFERENT dispatched body → inverted result — the loop-in-loop');
	} finally { await serve.close(); }
});

test('combinators over the dispatched body — all / any (the loop reduces the body over items)', async () => {
	const serve = makeHigherOrderServe({ loops, bodies });
	try {
		assert.equal(await serve({ id: 'a', produces: 'allCheck', bodyKey: 'isHot', items: [120, 130, 50] }), false, 'not ALL hot (50 fails)');
		assert.equal(await serve({ id: 'y', produces: 'anyCheck', bodyKey: 'isHot', items: [120, 130, 50] }), true, 'SOME hot');
		assert.equal(await serve({ id: 'a2', produces: 'allCheck', bodyKey: 'isHot', items: [120, 130, 140] }), true, 'ALL hot');
	} finally { await serve.close(); }
});

test('plugs into the projection — a higher-order leaf is served like any leaf (a leaf IS a mounted loop-of-methods)', async () => {
	const serve = makeHigherOrderServe({ loops, bodies });
	// the projection passes {id, produces, needs, inputs, ...}; bodyKeyOf/items default off the loop spec.
	const proj = createContextProjection({ serve });
	try {
		const { results, refusal } = await proj.run([{ id: 'chk', produces: 'mapCheck' }], { statement: 'check the defaults' });
		assert.equal(refusal, null);
		assert.deepEqual(results.chk.value, [true, true, false], 'the projection served the higher-order leaf: default body isHot over the default items');
	} finally { await serve.close(); }
});
