'use strict';
/**
 * serve-leaf (roadmap P6 — the UNIFICATION). `context-project`'s projection serves each leaf by DISPATCHING a
 * libraryKey + MOUNTING a concept-method on a P3 shared instance (P1 invoke, P4 gate). A leaf IS a mounted method,
 * not an opaque value; the method's bounded output flows to downstream leaves through the projection's pool. Folds
 * projection + runtime + library + method into one structure. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContextProjection } = require('../../plugins/planner/lib/context-project.js');
const { makeMethodServe } = require('../../plugins/planner/lib/serve-leaf.js');
console.log = console.info = console.warn = () => {};

// method X — produces Xout from a seed constant (no upstream input).
const METHOD_X = { common: { childConcepts: { Xout: { _id: 'Xout', _name: 'Xout', require: ['Segment'], ensure: ['$seedFlag == true'] } } } };
// method Y — produces Yout ONLY if it received x==true from upstream (value-passing through the unified structure).
const METHOD_Y = { common: { childConcepts: { Yout: { _id: 'Yout', _name: 'Yout', require: ['Segment'], ensure: ['$xin == true'] } } } };

const methods = {
	x: { conceptMap: METHOD_X, contract: { write: ['Xout'] }, boundedFrom: 's', boundedKeys: ['Xout'],
		buildSeed: () => ({ lastRev: 0, nodes: [{ _id: 'n', Node: true }], segments: [{ _id: 's', Segment: true, seedFlag: true, originNode: 'n', targetNode: 'n' }] }),
		value: ( summary ) => summary.Xout === true },
	y: { conceptMap: METHOD_Y, contract: { write: ['Yout'] }, boundedFrom: 's', boundedKeys: ['Yout'],
		buildSeed: ( leaf ) => ({ lastRev: 0, nodes: [{ _id: 'n', Node: true }], segments: [{ _id: 's', Segment: true, xin: leaf.inputs.x, originNode: 'n', targetNode: 'n' }] }),
		value: ( summary ) => summary.Yout === true },
};

test('a leaf IS a mounted method — the projection dispatches+mounts a method per leaf; value flows downstream', async () => {
	const serve = makeMethodServe({ methods });                          // keyOf default = leaf.produces
	const proj = createContextProjection({ serve });
	// x produces the value; y NEEDS it → the emergent order runs x before y, and y's method receives x from the pool.
	const roadmap = [{ id: 'sx', produces: 'x' }, { id: 'sy', needs: ['x'], produces: 'y' }];
	try {
		const { order, results, refusal } = await proj.run(roadmap, { statement: 'chain' });
		assert.equal(refusal, null);
		assert.equal(results.sx.value, true, "leaf sx's value IS method x's mounted output (Xout)");
		assert.equal(results.sy.value, true, "leaf sy's value IS method y's output — and y only fires because x==true crossed to it via the pool");
		assert.deepEqual(order, ['sx', 'sy'], 'emergent order: the producer before the consumer');
		assert.equal(serve.pool.size(), 2, 'one warm shared instance per libraryKey (x, y) — N leaves → 1 instance per method');
	} finally { await serve.close(); }
});

test('value-passing is LOAD-BEARING — break the upstream and the downstream method correctly does NOT fire', async () => {
	// method X' produces Xout=false (seedFlag missing) → x's value is false → y's ensure $xin==true fails → Yout absent.
	const brokenMethods = Object.assign({}, methods, {
		x: Object.assign({}, methods.x, { buildSeed: () => ({ lastRev: 0, nodes: [{ _id: 'n', Node: true }], segments: [{ _id: 's', Segment: true, originNode: 'n', targetNode: 'n' }] }) }),
	});
	const serve = makeMethodServe({ methods: brokenMethods });
	const proj = createContextProjection({ serve });
	try {
		const { results } = await proj.run([{ id: 'sx', produces: 'x' }, { id: 'sy', needs: ['x'], produces: 'y' }], { statement: 'chain' });
		assert.equal(results.sx.value, false, 'x produced no Xout (seedFlag absent)');
		assert.equal(results.sy.value, false, "y did NOT fire — the downstream method genuinely depends on the upstream value (not a stub)");
	} finally { await serve.close(); }
});

test('DISPATCH MISS — a leaf with no method throws (unless a §5 fallback is wired)', async () => {
	const serve = makeMethodServe({ methods: {} });                      // no methods registered
	const proj = createContextProjection({ serve });
	try {
		const r = await proj.run([{ id: 'sx', produces: 'x' }], { statement: 'x' });
		// context-project catches the serve throw per-leaf → the leaf never gates → a starved result (not a crash).
		assert.notEqual(r.results.sx && r.results.sx.value, true, 'no method → the leaf yields no value');
	} finally { await serve.close(); }
});
