'use strict';
/**
 * cost-probe — the CONSTITUENT-COST utility gate for compress.js (the half compose-hotspot cannot measure). These tests
 * pin the instrument to the confront verdict (2026-07-01): a composite PAYS only in the "canonicalization-in-context"
 * band — a forge-costly ∧ standalone-UNSTABLE interior under a STABLE typed envelope — and REFUSES a merely-structural
 * recurrence (the load-bearing NEG: structural GO is necessary-not-sufficient; the leaf floor already elides the cheap /
 * leaf-memoizable cases at 0 marginal calls). Pure, model-free.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { costProbe, paysToCompress } = require('../../lib/authoring/cost-probe');
const { composeHotspots, trackCompositions } = require('../../lib/authoring/compose-hotspot');

// a composite [A,B,C] observed over 3 whole-task instances that SHARE a typed envelope 'E'; only the interior key policy varies.
function occ( envelopeKey, cons ) { return { envelopeKey: envelopeKey, constituents: cons }; }

test('PAYER band — a forge-costly, standalone-UNSTABLE interior under a STABLE envelope → net > 0 (compress pays)', () => {
	// interior B keys on free-text (a distinct leafKey each run → the leaf memo MISSES every time); envelope 'E' stable.
	const occs = [
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'prose-1' }]),
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'prose-2' }]),
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'prose-3' }]),
	];
	const r = costProbe(occs);
	assert.equal(r.leafFloorForges, 3, 'the leaf memo must forge all 3 (every interior key is new)');
	assert.equal(r.compositeForges, 1, 'the composite memo forges once (the envelope repeats → replay)');
	assert.equal(r.net, 2, 'net = 2 forge calls elided that the leaf floor could NOT');
	assert.equal(r.pays, true);
	assert.equal(r.perConstituent[0].band, 'payer-interior', 'B diagnosed as the payer interior (leaf-unstable, forge-costly)');
});

test('NULL — a leaf-memoizable interior (stable standalone key) → net 0 (the leaf floor already covers it)', () => {
	const occs = [
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'typed-x' }]),
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'typed-x' }]),
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'typed-x' }]),
	];
	const r = costProbe(occs);
	assert.equal(r.leafFloorForges, 1, 'the leaf memo forges once then replays (stable interior key)');
	assert.equal(r.net, 0, 'the composite memo adds NOTHING over the leaf floor');
	assert.equal(r.pays, false);
	assert.equal(r.perConstituent[0].band, 'leaf-floored');
});

test('CHEAP — a deterministic autoflag interior (forgeCost 0) → net 0 (the `common` case: nothing to elide)', () => {
	const occs = [
		occ('E', [{ concept: 'B', forgeCost: 0, leafKey: 'a' }]),
		occ('E', [{ concept: 'B', forgeCost: 0, leafKey: 'b' }]),
		occ('E', [{ concept: 'B', forgeCost: 0, leafKey: 'c' }]),
	];
	const r = costProbe(occs);
	assert.equal(r.net, 0, 'a cheap composite compresses bits but elides ZERO forge calls');
	assert.equal(r.pays, false);
	assert.equal(r.perConstituent[0].band, 'cheap');
});

test('LOCALIZATION — a mixed composite [stable-forge, unstable-forge, cheap]: the probe attributes the saving to the payer interior', () => {
	// A: forge but leaf-stable (leaf-floored); B: forge + leaf-unstable (payer); C: cheap autoflag.
	const occs = [1, 2, 3].map(( i ) => occ('E', [
		{ concept: 'A', forgeCost: 1, leafKey: 'A-typed' },        // stable → leaf-floored
		{ concept: 'B', forgeCost: 1, leafKey: 'B-prose-' + i },   // varies → payer interior
		{ concept: 'C', forgeCost: 0, leafKey: 'C-' + i },         // cheap
	]));
	const r = costProbe(occs);
	assert.equal(r.net, 2, 'only B is elided beyond the leaf floor (A is leaf-floored, C is free)');
	assert.equal(r.pays, true);
	const band = Object.fromEntries(r.perConstituent.map(( p ) => [p.concept, p.band]));
	assert.deepEqual(band, { A: 'leaf-floored', B: 'payer-interior', C: 'cheap' }, 'the probe localizes WHICH constituent pays');
});

test('BLOAT gate — the library overhead can make a thin saving not worth it', () => {
	const occs = [
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'p1' }]),
		occ('E', [{ concept: 'B', forgeCost: 1, leafKey: 'p2' }]),
	];
	assert.equal(costProbe(occs).net, 1, 'raw saving = 1');
	assert.equal(costProbe(occs, { bloat: 1 }).pays, false, 'net 1 − bloat 1 = 0 → not worth compressing');
});

test('THE LOAD-BEARING NEG — a STRUCTURAL compose-candidate that the cost probe REFUSES (structure is necessary-not-sufficient)', () => {
	// compose-hotspot sees A→B recur across 3 distinct whole-tasks → GO (structural candidate).
	const t = trackCompositions();
	t.observe({ taskSig: 'taskX', seq: ['A', 'B', 'X'] });
	t.observe({ taskSig: 'taskY', seq: ['A', 'B', 'Y'] });
	t.observe({ taskSig: 'taskZ', seq: ['A', 'B', 'Z'] });
	const rows = composeHotspots(t, { minCount: 3, minDistinctTasks: 2 });
	const ab = rows.find(( r ) => r.composite.join('>') === 'A>B');
	assert.ok(ab && ab.verdict === 'compose-candidate', 'STRUCTURALLY a compose-candidate (frequent ∧ cross-distinct-task)');

	// but the SAME composite's constituents are cheap/leaf-memoizable → the cost probe says NO-GO (leaf floor dominates).
	const occs = ['X', 'Y', 'Z'].map(( _tk ) => occ('AB-typed', [
		{ concept: 'A', forgeCost: 0, leafKey: 'A' },              // cheap autoflag (like the common grammar)
		{ concept: 'B', forgeCost: 1, leafKey: 'B-typed' },        // forge but leaf-stable
	]));
	const cost = costProbe(occs);
	assert.equal(cost.pays, false, 'the cost probe REFUSES: no forge call is elided beyond the leaf floor');
	assert.equal(paysToCompress(occs), false);
	// ⇒ the TRUE compress.js gate is structural-recurrence ∧ cost-pays; the structural GO alone is a false positive.
});
