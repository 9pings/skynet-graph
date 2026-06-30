'use strict';
/**
 * §6.3 prerequisite — the bag-intersection SEPARATOR HORIZON (Σ_sep), the object the scalar treewidth + the size-1
 * articulation `separators` both PROJECT AWAY (2026-06-30 Laurie confront). The killer case proves the bag-interface
 * catches a bounded-context regression that BOTH lossy projections miss; `separatorGate` is the §3.3 horizon check.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bagInterface, separatorGate, isMinimalSplit, primalAdj } = require('../../lib/authoring/decompose.js');

// ── THE KILLER CASE — two triangles sharing a VERTEX vs sharing an EDGE ───────────────────────────────────────
test('bagInterface — catches a size-1→size-2 interface regression that BOTH treewidth AND articulation miss', () => {
	const before = [['a', 'b', 's'], ['s', 'c', 'd']];   // two triangles sharing VERTEX s   (thin cut {s})
	const after  = [['a', 's', 't'], ['c', 's', 't']];   // two triangles sharing EDGE s–t   (thin cut {s,t})
	const b = bagInterface(before), a = bagInterface(after);

	assert.equal(b.treewidth, a.treewidth, 'the SCALAR treewidth is BLIND — both 2 (why a scalar gate false-admits)');
	assert.equal(b.minimalInterface.size, 1, 'before: the thinnest cross-tile separator is {s} (width 1)');
	assert.deepEqual(b.minimalInterface.sep, ['s']);
	assert.equal(a.minimalInterface.size, 2, 'after: the thinnest cross-tile separator is {s,t} (width 2) — the horizon DOUBLED');
	assert.deepEqual(a.minimalInterface.sep, ['s', 't']);
	assert.ok(a.minimalInterface.size > b.minimalInterface.size, 'the bag-intersection separator DETECTS the regression the projections miss');
	// the articulation view is actively MISLEADING here: `after` has NO cut vertex (biconnected) → it reports MORE fused.
	assert.equal(a.sigmaSep.length, 2, 'after Σ_sep = {s,t} (a size-2 cut articulation points cannot see)');
});

test('bagInterface — distinguishes a divisible thin-cut corpus (C4) from an INDIVISIBLE blob (K4)', () => {
	const c4 = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']];   // 4-cycle, a thin 2-cut → divisible
	const k4 = [['a', 'b', 'c', 'd']];                              // complete, no thin cut → one black box
	const b = bagInterface(c4), a = bagInterface(k4);
	assert.ok(!b.indivisible && b.minimalInterface.size === 2, 'C4 has a width-2 cross-tile cut (divisible)');
	assert.ok(a.indivisible, 'K4 is indivisible — no bag-separator splits it (one blob)');
	// NB the GATE (abstraction.interfaceRegressed) treats an indivisible-after as a FUSION, not a cross-tile regression:
	// a single method’s internal clique is the UTILITY/MDL gate’s concern, NOT the bounded-context (cross-tile) horizon.
});

test('bagInterface — recovers the planted thin interface on the synthetic ground-truth corpus', () => {
	// the decompose.test.js corpus: 3 triangles bridged by {cost,risk}. The thin cross-tile cuts are size 1.
	const synth = [['symptom', 'diagnosis', 'risk'], ['distance', 'mode', 'risk'], ['distance', 'mode', 'cost'], ['stock', 'order', 'cost']];
	const r = bagInterface(synth);
	assert.equal(r.minimalInterface.size, 1, 'the thinnest cross-tile interface is a single bridge fact');
	assert.ok(r.sigmaSep.includes('cost') && r.sigmaSep.includes('risk'), 'Σ_sep includes the planted bridges');
	assert.ok(!r.sigmaSep.includes('symptom') && !r.sigmaSep.includes('order'), 'tile-INTERIOR facts are NOT on the horizon');
});

test('isMinimalSplit — a separator with a splitting proper subset is NOT minimal (the articulation generalisation)', () => {
	const adj = primalAdj([['a', 'b', 's'], ['s', 'c', 'd']]);
	assert.equal(isMinimalSplit(adj, new Set(['s'])), true, '{s} splits and is size-1 → minimal');
	assert.equal(isMinimalSplit(adj, new Set(['b', 's'])), false, '{b,s} splits but {s}⊂ it already splits → NOT minimal');
	assert.equal(isMinimalSplit(adj, new Set(['a'])), false, '{a} does not split → not a separator');
});

// ── separatorGate — the §3.3 horizon check ────────────────────────────────────────────────────────────────────
const domainTree = { childConcepts: {
	Diagnose:   { _id: 'Diagnose', _name: 'Diagnose', require: ['symptom'], ensure: ['$risk != null'], applyMutations: [{ $_id: '_parent', diagnosis: true }] },
	TravelRisk: { _id: 'TravelRisk', _name: 'TravelRisk', require: ['distance'], ensure: ['$risk != null', '$mode != null'] },
	TravelCost: { _id: 'TravelCost', _name: 'TravelCost', require: ['distance'], ensure: ['$cost != null', '$mode != null'] },
	Reorder:    { _id: 'Reorder', _name: 'Reorder', require: ['stock'], ensure: ['$cost != null'], applyMutations: [{ $_id: '_parent', order: true }] },
} };

test('separatorGate — a projection of SEPARATOR facts is admitted; a tile-INTERIOR fact is refused (above the horizon)', () => {
	const ok = separatorGate(domainTree, ['risk']);
	assert.equal(ok.ok, true, 'risk is a cross-tile bridge (∈ Σ_sep) → an ancestry projection of it stays below the horizon');
	const bad = separatorGate(domainTree, ['symptom']);
	assert.equal(bad.ok, false, 'symptom is clinical-tile interior (∉ Σ_sep) → above the separator → REFUSED');
	assert.deepEqual(bad.above, ['symptom']);
	// a MIXED projection is refused on the offending fact only.
	const mixed = separatorGate(domainTree, ['risk', 'diagnosis']);
	assert.equal(mixed.ok, false);
	assert.deepEqual(mixed.above, ['diagnosis'], 'only the above-horizon fact is flagged; the separator fact is fine');
});
