'use strict';
/**
 * compose-hotspot — the compositional-recurrence go/no-go detector (roadmap STAGE-0 gate). Hand-built
 * dispatch traces validate the four-way verdict and, crucially, the load-bearing OFF-RAMP: a sub-composite
 * that recurs across DISTINCT whole-tasks is a `compose-candidate` (whole-task memo can't cover it), while a
 * repeated whole-task is `already-flat-covered` (it can) — the exact condition under which building
 * `compress.js` pays vs is redundant. The shared composite is INTERNAL (not a trivial common prefix).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../lib/authoring/learning/compose-hotspot');

const rowFor = ( rows, leaf ) => rows.find(( r ) => r.composite.join('>') === leaf.join('>'));
function feed( entries ) { const t = C.trackCompositions(); entries.forEach(( e ) => t.observe(e)); return t; }

test('compose-candidate: an INTERNAL sub-composite shared across 3 distinct tasks (whole-task memo cannot cover)', () => {
	const t = C.trackCompositions();
	// parse∘validate recurs INSIDE three DIFFERENT whole-tasks — the shared sub-work.
	const X = ['read', 'parse', 'validate', 'store'];
	const Y = ['fetch', 'parse', 'validate', 'emit'];
	const Z = ['open', 'parse', 'validate', 'close'];
	for ( let i = 0; i < 2; i++ ) { t.observe({ taskSig: 'X', seq: X }); t.observe({ taskSig: 'Y', seq: Y }); t.observe({ taskSig: 'Z', seq: Z }); }

	const rows = C.composeHotspots(t, { minCount: 3, minDistinctTasks: 2 });
	const pv = rowFor(rows, ['parse', 'validate']);
	assert.ok(pv, 'the parse∘validate composite was detected');
	assert.equal(pv.verdict, 'compose-candidate');
	assert.equal(pv.count, 6, 'occurs 6× (3 tasks × 2 cycles)');
	assert.equal(pv.distinctTasks, 3, 'across 3 DISTINCT whole-tasks — the cross-task signal');
	assert.equal(pv.savedCalls, 2, 'distinctTasks − 1 forge-calls elided over the whole-task baseline');
	assert.ok(pv.mdlSymbols > 0, 'positive RE-PAIR description-length saving');
	assert.equal(C.anyComposeCandidate(rows), true, 'go: compress.js would pay here');
	assert.equal(C.potentialSavedCalls(rows), 2);
	// the WHOLE tasks (parse∘validate∘store etc.) recur too but only within ONE task each → flat-covered, not candidates.
	const whole = rowFor(rows, ['parse', 'validate', 'store']);
	if ( whole ) assert.equal(whole.verdict, 'already-flat-covered');
});

test('already-flat-covered (OFF-RAMP): a repeated WHOLE-task is not a compose-candidate', () => {
	const t = C.trackCompositions();
	const W = ['a', 'b', 'c'];
	for ( let i = 0; i < 5; i++ ) t.observe({ taskSig: 'W', seq: W });   // one task, repeated

	const rows = C.composeHotspots(t, { minCount: 3, minDistinctTasks: 2 });
	assert.equal(C.anyComposeCandidate(rows), false, 'no-go: whole-task memo already serves every recurrence');
	assert.ok(rows.length > 0, 'composites were still extracted…');
	assert.ok(rows.every(( r ) => r.verdict === 'already-flat-covered'), '…and ALL are flat-covered (distinctTasks = 1)');
});

test('no recurrence → nothing extracted (too-rare / none)', () => {
	const t = feed([{ taskSig: 'X', seq: ['a', 'b', 'c'] }, { taskSig: 'Y', seq: ['d', 'e', 'f'] }]);
	const rows = C.composeHotspots(t, { minCount: 2, minDistinctTasks: 2 });
	assert.equal(rows.length, 0, 'no adjacent pair recurs → no composite');
	assert.equal(C.anyComposeCandidate(rows), false);
});

test('unstable: a cross-task composite whose result is NOT a function of its input is refused', () => {
	const t = C.trackCompositions();
	let inst = 0;
	// a∘b recurs across X and Y, but its result diverges every occurrence → K1-insufficient at the composite level.
	const mk = ( sig ) => { const id = inst++; return { taskSig: sig, seq: ['a', 'b', sig === 'X' ? 'c' : 'd'],
		resultKeyOf: ( i, j ) => (i === 0 && j === 1) ? 'res-' + id : null }; };
	for ( let i = 0; i < 3; i++ ) { t.observe(mk('X')); t.observe(mk('Y')); }

	const rows = C.composeHotspots(t, { minCount: 3, minDistinctTasks: 2 });
	const ab = rowFor(rows, ['a', 'b']);
	assert.ok(ab, 'a∘b detected (frequent, cross-task)…');
	assert.equal(ab.stable, false, '…but its result diverges across occurrences');
	assert.equal(ab.verdict, 'unstable', 'refused — not compressible into a sound method');
	assert.equal(C.anyComposeCandidate(rows), false, 'no-go: nothing K1-stable to compress');
});

test('stable result CONFIRMS a compose-candidate (the positive stability path)', () => {
	const t = C.trackCompositions();
	// a∘b maps its structural input to a STABLE result → confirmed candidate.
	const mk = ( sig ) => ({ taskSig: sig, seq: ['a', 'b', sig === 'X' ? 'c' : 'd'],
		resultKeyOf: ( i, j ) => (i === 0 && j === 1) ? 'STABLE-AB' : null });
	for ( let i = 0; i < 3; i++ ) { t.observe(mk('X')); t.observe(mk('Y')); }

	const rows = C.composeHotspots(t, { minCount: 3, minDistinctTasks: 2 });
	const ab = rowFor(rows, ['a', 'b']);
	assert.equal(ab.stable, true, 'result is a function of the composite input');
	assert.equal(ab.verdict, 'compose-candidate');
	assert.equal(C.anyComposeCandidate(rows), true);
});
