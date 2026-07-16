'use strict';
/**
 * §6.3 prerequisite — the E7/Σ_sep gate, COMPLETED + un-vacuumed in `abstraction.evaluate` (2026-06-30 confront).
 * Two findings fixed: (A) the gate was VACUOUS — `interfaceRegression` fed `forkPlan({common: tree})`, which
 * `conceptCliques` never unwraps → 0 cliques → `widened` always [] → the gate gated nothing; (B) the SOUND object is
 * the bag-intersection MINIMAL-INTERFACE non-regression (`bagInterface`), not the scalar min-fill treewidth (an
 * uncoupled upper bound → false-admits) nor the size-1 articulation `widened` alone. With the gate live, §6.3's
 * ancestry oracle is unblocked: `separatorGate` admits a digest-key enlargement only with on-horizon (Σ_sep) facts.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { evaluate, interfaceRegression } = require('../../lib/authoring/core/abstraction.js');
const { separatorGate } = require('../../lib/authoring/core/decompose.js');
console.log = console.info = console.warn = () => {};

// a chain joined by ONE bridge fact (size-1 cut); a widening abstraction routes through TWO (size-2 cut).
const Left  = { _id: 'Left', _name: 'Left', require: ['x1'], ensure: ['$bridge != null'], provider: ['App::left'] };
const Right = { _id: 'Right', _name: 'Right', require: ['bridge'], applyMutations: [{ $_id: '_parent', Right: true, out: 1 }] };
const chainTree = { childConcepts: { Left, Right } };
const LeftW  = { _id: 'LeftW', _name: 'LeftW', require: ['x1'], ensure: ['$bridge != null', '$bridge2 != null'], provider: ['App::leftW'] };
const RightW = { _id: 'RightW', _name: 'RightW', require: ['bridge'], ensure: ['$bridge2 != null'], applyMutations: [{ $_id: '_parent', RightW: true, out: 1 }] };
const wideTree = { childConcepts: { LeftW, RightW } };
const providers = { App: {
	left:  ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', Left: true, bridge: s._.x1 * 2 }),
	leftW: ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', LeftW: true, bridge: s._.x1 * 2, bridge2: s._.x1 + 1 }),
} };
const SEED = { lastRev: 0, nodes: [{ _id: 'N1', x1: 5 }], segments: [] };

test('FINDING (A) — interfaceRegression is now NON-VACUOUS (the {common:…} unwrap bug fixed)', () => {
	const r = interfaceRegression(chainTree, chainTree);
	assert.ok(r.separatorsBefore.length > 0 || r.minimalInterfaceBefore.size > 0, 'real cliques are extracted (the prior code fed an unwrappable shape → 0 cliques)');
	assert.equal(r.minimalInterfaceBefore.size, 1, 'the chain’s thin interface is a single bridge fact');
	assert.equal(r.interfaceRegressed, false, 'a tree vs itself does not regress');
});

test('E7 SOUND gate — a size-1→size-2 interface widening is REFUSED even though equivalent (the bag-interface gate)', async () => {
	const iface = interfaceRegression(chainTree, wideTree);
	assert.equal(iface.minimalInterfaceBefore.size, 1, 'before: one bridge crosses');
	assert.equal(iface.minimalInterfaceAfter.size, 2, 'after: TWO facts cross — the horizon widened');
	assert.equal(iface.interfaceRegressed, true);

	const r = await evaluate({ seed: SEED, providers, chainTree, abstractTree: wideTree, equivKeys: ['out'] });
	assert.equal(r.equivalent, true, 'both produce the same external `out` (equivalence is not the reason)');
	assert.equal(r.interfaceOk, false, 'the bounded-context horizon regressed → interfaceOk is FALSE');
	assert.equal(r.admit, false, 'a method that widens the separator interface is REFUSED (E7), whatever its utility');
});

test('E7 — a fusion that does NOT widen the interface keeps interfaceOk TRUE (no false refusal)', async () => {
	// a within-tile fusion (the abstraction-currency case): same thin interface → admitted on the interface axis.
	const Normalize = { _id: 'Normalize', _name: 'Normalize', require: ['raw'], provider: ['App::normalize'] };
	const Tag1 = { _id: 'Tag1', _name: 'Tag1', require: ['normalized'], applyMutations: [{ $_id: '_parent', Tag1: true, t1: 1 }] };
	const Tag2 = { _id: 'Tag2', _name: 'Tag2', require: ['t1'], applyMutations: [{ $_id: '_parent', Tag2: true, t2: 1 }] };
	const chain = { childConcepts: { Normalize, Tag1, Tag2 } };
	const abstr = { childConcepts: { Normalize, TagBoth: { _id: 'TagBoth', _name: 'TagBoth', require: ['normalized'], applyMutations: [{ $_id: '_parent', TagBoth: true, t1: 1, t2: 1 }] } } };
	const r = interfaceRegression(chain, abstr);
	assert.equal(r.interfaceRegressed, false, 'a within-tile fusion does not widen the cross-tile interface');
	assert.deepEqual(r.widened, [], 'and adds no size-1 separator key (the existing E7 check, now non-vacuous)');
});

// ── §6.3(a) UNBLOCKED — the monotone-safe ancestry digest-key enlargement, bound-gated by separatorGate ──────────
const domainTree = { childConcepts: {
	Diagnose:   { _id: 'Diagnose', _name: 'Diagnose', require: ['symptom'], ensure: ['$risk != null'], applyMutations: [{ $_id: '_parent', diagnosis: true }] },
	TravelRisk: { _id: 'TravelRisk', _name: 'TravelRisk', require: ['distance'], ensure: ['$risk != null', '$mode != null'] },
	TravelCost: { _id: 'TravelCost', _name: 'TravelCost', require: ['distance'], ensure: ['$cost != null', '$mode != null'] },
	Reorder:    { _id: 'Reorder', _name: 'Reorder', require: ['stock'], ensure: ['$cost != null'], applyMutations: [{ $_id: '_parent', order: true }] },
} };

test('§6.3(a) — an ancestry digest-key enlargement keeps ONLY the on-horizon (Σ_sep) facts; an above-horizon fact is dropped', () => {
	// the ancestry oracle proposes enlarging a method's memo key with ancestor facts. Memo-correctness is monotone for
	// ALL of them (a finer key never false-hits), but the digest READ is a runtime requiredFact → it must stay ⊆ Σ_sep
	// (the §3.3 horizon) or the bounded-context bound silently regresses. separatorGate is that bound-safety filter.
	const proposedAncestry = ['risk', 'symptom', 'cost'];     // risk/cost = bridges (on-horizon); symptom = clinical interior
	const g = separatorGate(domainTree, proposedAncestry);
	assert.equal(g.ok, false, 'the projection is not wholly below the horizon');
	const admitted = proposedAncestry.filter(( f ) => g.above.indexOf(f) < 0);
	assert.deepEqual(admitted, ['risk', 'cost'], 'the key is enlarged with the separator facts only (monotone-safe AND bound-safe)');
	assert.deepEqual(g.above, ['symptom'], 'the above-horizon ancestor fact is dropped (compiled to a baked constant, per §3.3) — not a runtime key');
});
