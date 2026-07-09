'use strict';
/**
 * forest (roadmap §5(c)) — the concept-method as a LIBRARY of alternative sub-paths (the derivation forest). Try the
 * candidates in preference order; the FIRST that dispatches + mounts + GATES sound is SELECTED — one stays active. That
 * selection dodges G3 (footprintCycles): we SELECT one path, never COMPOSE coupled retractable methods → no oscillation.
 * Forest exhausted → the §5(b) forge. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { makeForestServe } = require('../../lib/authoring/forest.js');
console.log = console.info = console.warn = () => {};

const seedN = ( n ) => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, n: n }, { _id: 'OUT', Node: true }], segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] });
// two alternative sub-paths. Each GATE-refuses (post $Ok==true) when it doesn't apply → the forest tries the next.
const candidates = {
	hot:  { conceptMap: { common: { childConcepts: { Ok: { _id: 'Ok', _name: 'Ok', require: ['Segment'], ensure: ['$originNode:n >= 100'] } } } },
		contract: { write: ['Ok'], post: ['$Ok == true'] }, boundedFrom: 's', boundedKeys: ['Ok'], buildSeed: ( l ) => seedN(l.temp), value: ( s ) => s.Ok === true },
	mild: { conceptMap: { common: { childConcepts: { Ok: { _id: 'Ok', _name: 'Ok', require: ['Segment'], ensure: ['$originNode:n >= 50'] } } } },
		contract: { write: ['Ok'], post: ['$Ok == true'] }, boundedFrom: 's', boundedKeys: ['Ok'], buildSeed: ( l ) => seedN(l.temp), value: ( s ) => s.Ok === true },
};
const forests = { classify: ['hot', 'mild'] };   // the alternative paths, in preference order

test('the FIRST candidate that completes is SELECTED (one path stays active)', async () => {
	const serve = makeForestServe({ forests, candidates });
	try {
		const r = await serve({ id: 'c', produces: 'classify', temp: 120 });
		assert.equal(r.value, true); assert.equal(r.selected, 'hot', 'hot completes first → selected');
		assert.deepEqual(r.tried, ['hot'], 'the preferred path completed — no later path was even tried');
	} finally { await serve.close(); }
});

test('a refused candidate FALLS THROUGH to the next path (one stays active — G3-safe selection, not composition)', async () => {
	const serve = makeForestServe({ forests, candidates });
	try {
		const r = await serve({ id: 'c', produces: 'classify', temp: 70 });
		assert.equal(r.value, true); assert.equal(r.selected, 'mild', 'hot gate-refused (70<100) → the forest selects mild');
		assert.deepEqual(r.tried, ['hot', 'mild'], 'hot was tried and dropped; exactly ONE path (mild) is active — no coupled composition, no oscillation');
	} finally { await serve.close(); }
});

test('forest EXHAUSTED → a typed refusal (no path completed)', async () => {
	const serve = makeForestServe({ forests, candidates });
	try {
		const r = await serve({ id: 'c', produces: 'classify', temp: 30 });
		assert.equal(r.selected, null); assert.equal(r.refusal, 'forest-exhausted', 'both candidates refused (30<50) → typed refusal, not a crash');
		assert.deepEqual(r.tried, ['hot', 'mild']);
	} finally { await serve.close(); }
});

test('forest exhausted → the §5(b) FORGE (last-resort learning) takes over', async () => {
	const forge = async ( args ) => { assert.equal(args.reason, 'forest-exhausted'); return true; };   // a forged path
	const serve = makeForestServe({ forests, candidates, forge });
	try {
		const r = await serve({ id: 'c', produces: 'classify', temp: 30 });
		assert.equal(r.selected, 'forged'); assert.equal(r.value, true, 'no library path completed → the forge produced one');
	} finally { await serve.close(); }
});
