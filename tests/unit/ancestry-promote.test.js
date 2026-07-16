'use strict';
/**
 * §6.3(b) — the ANCESTRY ORACLE: content→param PROMOTION (Relative LGG / bounded ij-determinacy, GOLEM
 * Muggleton-Feng 1990). A VARYING content leaf is promoted to a frontier PARAM bound from an ancestor fact iff the
 * identity FD `value(f)=N(s).g` holds — but the naive "FD across k → promote" is the §6.4 silent-unsoundness spine
 * (the promote bin is the varying case → rides `invariantAtom`'s over-approximating BAND). The Laurie confront's
 * sound fix, each a discriminating control:
 *   pt1  HELD-OUT strict `===` (≥1 withheld instance) is the only in-sample test that kills an in-distribution
 *        spurious g; + minK floor (union-bound, ≥3). PAC does not apply (non-iid + drift).
 *   pt1c the promoted-leaf post is the EXACT relation `$leaf==$g`, never the band → a divergence is caught at mount.
 *   pt2  ≥2 surviving ancestors → ambiguous → FORGE (version-space join ⊤ = the LGG), never an arbitrary pick.
 *   pt3  φ = identity + deterministic field-projection (`g.field`) ONLY; the horizon `g ∈ Σ_sep` (separatorGate).
 *   pt4  BAKE needs CROSS-DIGEST constancy; FORGE is the always-sound catch-all (never drop a leaf).
 * ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideLeaf, promoteContentVars } = require('../../plugins/learning/lib/ancestry.js');

// ── pt1 — the LOAD-BEARING control: held-out strict-=== kills a spurious FD the band-only post admits silently ──
test('held-out strict-=== REFUSES a spurious FD that a band-only post would silently admit (the §6.4 hull hazard)', () => {
	// leaf p = [10,20,10] on the fit, 30 on the held-out. g_spur CO-VARIES [10,20,10] on the fit but = 15 held-out.
	const observations = [
		{ value: 10, ancestry: { gSpur: 10, gOther: 1 } },
		{ value: 20, ancestry: { gSpur: 20, gOther: 2 } },
		{ value: 10, ancestry: { gSpur: 10, gOther: 3 } },
		{ value: 30, ancestry: { gSpur: 15, gOther: 4 } },   // HELD-OUT: gSpur 15 ≠ leaf 30 → eliminated by strict ===
	];
	const r = decideLeaf({ observations, sigmaSep: ['gSpur', 'gOther'], minK: 3 });
	assert.equal(r.bin, 'forge', 'the spurious FD is REFUSED');
	assert.ok(r.fitCandidates.some(( c ) => c.g === 'gSpur'), 'gSpur PASSED the in-sample fit (a band-only promoter WOULD have taken it — the silent unsound path)');
	assert.ok(!r.survivors.some(( c ) => c.g === 'gSpur'), 'but the held-out strict-=== ELIMINATED it (15 ≠ 30) — the negative-based reduction');
});

test('a genuine identity FD promotes to an ancestor frontier ref with an EXACT relational post (not a band)', () => {
	const observations = [
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'B', ancestry: { kind: 'B' } },
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'C', ancestry: { kind: 'C' } },   // held-out kind=C === leaf C → survives
	];
	const r = decideLeaf({ observations, sigmaSep: ['kind'], minK: 3, leafKey: 'state' });
	assert.equal(r.bin, 'promote');
	assert.equal(r.promotion.ancestorFact, 'kind');
	assert.match(r.post, /^\$state\s*==\s*\$/, 'an EXACT equality post `$state==$<ref>`, never an `invariantAtom` band');
	assert.ok(!/[<>]=|in \[/.test(r.post), 'no interval / enum band in the promoted post');
});

test('pt2 — two co-varying ancestors that BOTH survive → AMBIGUOUS → FORGE (version-space join ⊤), never an arbitrary pick', () => {
	const observations = [
		{ value: 'A', ancestry: { g1: 'A', g2: 'A' } }, { value: 'B', ancestry: { g1: 'B', g2: 'B' } },
		{ value: 'A', ancestry: { g1: 'A', g2: 'A' } }, { value: 'C', ancestry: { g1: 'C', g2: 'C' } },
	];
	const r = decideLeaf({ observations, sigmaSep: ['g1', 'g2'], minK: 3 });
	assert.equal(r.bin, 'forge', 'g1 and g2 are indistinguishable on all observed → the version space is not a singleton → forge');
	assert.equal(r.survivors.length, 2);
});

test('pt3 — an ancestor ABOVE the horizon (∉ Σ_sep) is never a promotion candidate (separatorGate)', () => {
	const observations = [
		{ value: 'A', ancestry: { farTile: 'A' } }, { value: 'B', ancestry: { farTile: 'B' } },
		{ value: 'A', ancestry: { farTile: 'A' } }, { value: 'C', ancestry: { farTile: 'C' } },
	];
	const r = decideLeaf({ observations, sigmaSep: ['someOtherSep'], minK: 3 });   // farTile ∉ Σ_sep
	assert.equal(r.bin, 'forge', 'farTile is above the separator horizon → never promoted (a runtime read would reach past the bound)');
});

test('pt3 — field-projection φ: a leaf equal to an ancestor SUB-FIELD promotes (the one extra φ)', () => {
	const observations = [
		{ value: 'A', ancestry: { rec: { kind: 'A', other: 1 } } }, { value: 'B', ancestry: { rec: { kind: 'B', other: 2 } } },
		{ value: 'A', ancestry: { rec: { kind: 'A', other: 3 } } }, { value: 'C', ancestry: { rec: { kind: 'C', other: 4 } } },
	];
	const r = decideLeaf({ observations, sigmaSep: ['rec'], minK: 3, fieldProjection: true });
	assert.equal(r.bin, 'promote');
	assert.equal(r.promotion.ancestorFact, 'rec');
	assert.equal(r.promotion.field, 'kind');
});

test('pt1 — fewer than minK fit instances → FORGE (too few to certify an FD, the determinacy bound)', () => {
	const observations = [{ value: 'A', ancestry: { kind: 'A' } }, { value: 'B', ancestry: { kind: 'B' } }];
	const r = decideLeaf({ observations, sigmaSep: ['kind'], minK: 3 });
	assert.equal(r.bin, 'forge');
	assert.match(r.reason, /insufficient|instances|minK/i);
});

test('pt4 — a leaf CONSTANT across all instances AND digests → BAKE (baked+keyed); FORGE is the always-sound catch-all', () => {
	const observations = [
		{ value: 'X', ancestry: { kind: 'A' }, digest: 'd1' }, { value: 'X', ancestry: { kind: 'B' }, digest: 'd1' },
		{ value: 'X', ancestry: { kind: 'A' }, digest: 'd2' }, { value: 'X', ancestry: { kind: 'C' }, digest: 'd2' },
	];
	const r = decideLeaf({ observations, sigmaSep: ['kind'], minK: 3 });
	assert.equal(r.bin, 'bake', 'constant across BOTH digests → safe to bake into the cross-digest skeleton');
	// a non-determinable varying leaf with no ancestry match → FORGE (never dropped).
	const varying = decideLeaf({ observations: [
		{ value: 'P', ancestry: { kind: 'A' } }, { value: 'Q', ancestry: { kind: 'B' } },
		{ value: 'R', ancestry: { kind: 'A' } }, { value: 'S', ancestry: { kind: 'B' } },   // leaf not a function of kind
	], sigmaSep: ['kind'], minK: 3 });
	assert.equal(varying.bin, 'forge', 'a leaf determined by nothing on the horizon stays a FORGE hole (the catch-all, never dropped)');
});

// ── the batch operator over a method's content vars + the skeleton rewrite ────────────────────────────────────
test('promoteContentVars — rewrites a promoted leaf to a frontier ref, bakes a constant, leaves a forge hole', () => {
	const skeleton = [{ $_id: '_parent', Refine: true }, { _id: '⟦@base⟧_m0', Node: true, state: { '§var': '[1].state' }, role: { '§var': '[1].role' }, tag: { '§var': '[1].tag' } }];
	const leaves = [
		{ path: '[1].state', observations: [{ value: 'A', ancestry: { kind: 'A' } }, { value: 'B', ancestry: { kind: 'B' } }, { value: 'A', ancestry: { kind: 'A' } }, { value: 'C', ancestry: { kind: 'C' } }] },  // promote → kind
		{ path: '[1].role', observations: [{ value: 'hub', ancestry: { kind: 'A' } }, { value: 'hub', ancestry: { kind: 'B' } }, { value: 'hub', ancestry: { kind: 'A' } }, { value: 'hub', ancestry: { kind: 'C' } }] },  // bake (constant)
		{ path: '[1].tag', observations: [{ value: 'p', ancestry: { kind: 'A' } }, { value: 'q', ancestry: { kind: 'B' } }, { value: 'r', ancestry: { kind: 'A' } }, { value: 's', ancestry: { kind: 'B' } }] },  // forge
	];
	const r = promoteContentVars({ skeleton, leaves, sigmaSep: ['kind'], minK: 3 });
	assert.deepEqual(r.promoted.map(( p ) => p.path), ['[1].state']);
	assert.deepEqual(r.baked, ['[1].role']);
	assert.deepEqual(r.forged, ['[1].tag']);
	assert.match(JSON.stringify(r.skeleton), /⟦@ref:/, 'the promoted leaf became a frontier ref hole');
	assert.equal(r.skeleton[1].role, 'hub', 'the baked leaf became its literal');
	assert.ok(r.skeleton[1].tag && r.skeleton[1].tag['§var'], 'the forged leaf stays a content hole');
	assert.ok(r.posts.some(( p ) => /==\$/.test(p)), 'each promotion carries its EXACT relational post');
});
