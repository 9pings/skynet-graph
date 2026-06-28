'use strict';
/**
 * ZOOM over the abstraction stack (P0.2 / conception §9.3-§9.4).
 *
 * A realized method application is a THEORIC segment A->B whose body (the production
 * that realizes it) is wired as concrete child segments (`_origin == <theoric>`),
 * outgoing siblings of A. PROBE finding (probe-zoom.js): `getPaths` already prefers
 * concrete siblings (`haveNoTheoric`), so by default it returns the FULLY EXPANDED
 * concrete path — it never "stops" at a realized theoric, it over-expands past it.
 *
 * What the conception's abstraction barrier needs is the INVERSE + selective control:
 *   - `{collapse:true}`        -> the ABSTRACT, method-level path (theoric hops kept,
 *                                 their bodies hidden — "carry the contract, not the body")
 *   - `{collapse:true, zoom:[id]}` -> abstract everywhere EXCEPT the chosen method(s),
 *                                 which are descended into their body ("open one box")
 * Default (no opts) is unchanged: fully concrete (backward compatible).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

function run(seed) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('zoom graph never stabilized')), 10000);
		let done = false;
		const g = new Graph(seed, {
			label: 'zoom', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); }
		}, { common: { childConcepts: {} } });
	});
}

// Two method applications in sequence: M1 (a->b, body a->x->b) ; M2 (b->c, body b->y->c).
function twoMethods() {
	return run({
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }, { _id: 'x' }, { _id: 'y' }],
		segments: [
			{ _id: 'M1', originNode: 'a', targetNode: 'b', Theoric: true, childPaths: { body: 'p1' } },
			{ _id: 'mx1', originNode: 'a', targetNode: 'x', _origin: 'M1', pathId: 'p1' },
			{ _id: 'mx2', originNode: 'x', targetNode: 'b', _origin: 'M1', pathId: 'p1' },
			{ _id: 'M2', originNode: 'b', targetNode: 'c', Theoric: true, childPaths: { body: 'p2' } },
			{ _id: 'my1', originNode: 'b', targetNode: 'y', _origin: 'M2', pathId: 'p2' },
			{ _id: 'my2', originNode: 'y', targetNode: 'c', _origin: 'M2', pathId: 'p2' }
		]
	});
}

const one = (paths) => { assert.equal(paths.length, 1, 'exactly one route'); return paths[0]; };

test('default getPaths is unchanged: the FULLY CONCRETE path (backward compatible)', async () => {
	const g = await twoMethods();
	assert.deepEqual(one(g.getPaths('a', 'c').paths),
		['a', 'mx1', 'x', 'mx2', 'b', 'my1', 'y', 'my2', 'c'],
		'no opts -> both method bodies expanded');
});

test('collapse: the ABSTRACT method-level path (theoric hops, bodies hidden)', async () => {
	const g = await twoMethods();
	const p = one(g.getPaths('a', 'c', null, { collapse: true }).paths);
	assert.deepEqual(p, ['a', 'M1', 'b', 'M2', 'c'], 'collapse -> method hops, no body steps');
	// NEGATIVE CONTROL: the body steps must NOT leak into the abstract path
	for (const bodyStep of ['mx1', 'mx2', 'my1', 'my2', 'x', 'y'])
		assert.ok(!p.includes(bodyStep), `${bodyStep} (a body step) must be hidden when collapsed`);
});

test('zoom: collapse everywhere EXCEPT the chosen method, which is opened', async () => {
	const g = await twoMethods();
	const p = one(g.getPaths('a', 'c', null, { collapse: true, zoom: ['M1'] }).paths);
	assert.deepEqual(p, ['a', 'mx1', 'x', 'mx2', 'b', 'M2', 'c'],
		'M1 descended into its body; M2 stays an abstract hop');
});

test('zoom the OTHER method, selectively', async () => {
	const g = await twoMethods();
	const p = one(g.getPaths('a', 'c', null, { collapse: true, zoom: ['M2'] }).paths);
	assert.deepEqual(p, ['a', 'M1', 'b', 'my1', 'y', 'my2', 'c'],
		'M2 descended; M1 stays abstract');
});

test('NEGATIVE CONTROL: zoom is SELECTIVE — zooming an unknown id == plain collapse', async () => {
	const g = await twoMethods();
	const p = one(g.getPaths('a', 'c', null, { collapse: true, zoom: ['nope'] }).paths);
	assert.deepEqual(p, ['a', 'M1', 'b', 'M2', 'c'],
		'a zoom set that matches no realized theoric leaves everything abstract');
});

test('cmaps carries the abstract hop + its body provenance (for anti-unify/serialize)', async () => {
	const g = await twoMethods();
	const { maps } = g.getPaths('a', 'c', null, { collapse: true });
	assert.ok(maps.M1 && maps.M1.Theoric, 'the abstract path exposes the method hop in maps');
	assert.ok(maps.M2 && maps.M2.Theoric, 'both method hops present in maps');
});
