'use strict';
/**
 * glossary (P2) — the cross-round terminology REFERENCE. Each claim carries a discriminating NEGATIVE control
 * (the house convention). The reconciliation composes two gates: witness-overlap (grounded selector) + the ring
 * confluence gate (audit/version/retract). Entry-retract is JTMS with cascade. ZERO-CORE — assembles registry.js
 * + canonicalize.js, both already tested. These are the P2-STRUCT barres, locked as regression.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGlossary, overlapOf } = require('../../lib/authoring/lattice/glossary');

test('P2-STRUCT-1 — grounded overlap ≥ θ merges (alias audited), NOT a silent second notion', () => {
	const g = createGlossary();
	assert.deepEqual(g.harvest({ text: 'open-source maximizes adoption', witnesses: ['p1', 'p3'], side: 'PRO' }), { status: 'added', id: 'n1' });
	const r = g.harvest({ text: 'openness drives uptake', witnesses: ['p1', 'p4'], side: 'PRO' });   // overlap {p1}/2 = 0.5 ≥ θ
	assert.deepEqual(r, { status: 'merged', id: 'n1', alias: 'openness drives uptake' });
	assert.equal(g.notions().length, 1, 'ONE canonical notion — the duplicate did not spawn a second');
	assert.deepEqual(g.snapshot().rings.n1, ['open-source maximizes adoption', 'openness drives uptake'],
		'both the canonical phrasing (registered on add, so surface-identity hits later) and the merged alias live under n1');
	// NEG: a DISJOINT-witness statement is NOT merged (overlap 0 < θ) — a real new notion
	assert.deepEqual(g.harvest({ text: 'community trust', witnesses: ['p5', 'p6'], side: 'PRO' }), { status: 'added', id: 'n2' });
	assert.equal(g.notions().length, 2);
});

test('P2-STRUCT-1b — never merges across sides even at high witness overlap', () => {
	const g = createGlossary();
	g.harvest({ text: 'A', witnesses: ['x1', 'x2'], side: 'PRO' });
	const r = g.harvest({ text: 'B', witnesses: ['x1', 'x2'], side: 'CON' });   // same witnesses, opposite side
	assert.equal(r.status, 'added', 'opposite side → a distinct notion, never a cross-side merge');
	assert.equal(r.id, 'n2');
});

test('P2-STRUCT-2 — confluence gate SURFACES a would-be two-notion collision (never a silent merge)', () => {
	const g = createGlossary();
	g.harvest({ text: 'shared phrasing', witnesses: ['p1', 'p2'], side: 'PRO' });   // n1 owns "shared phrasing"
	g.harvest({ text: 'other notion', witnesses: ['p7', 'p8'], side: 'PRO' });      // n2, disjoint
	// now a candidate whose grounded overlap points at n2 but whose text is n1's phrasing → the ring must refuse
	const r = g.harvest({ text: 'shared phrasing', witnesses: ['p7', 'p9'], side: 'PRO' });
	assert.equal(r.status, 'merged', 'surface identity is definitive: it belongs to n1');
	assert.equal(r.id, 'n1');
	assert.equal(g.notions().length, 2, 'no third notion, no silent collision');
});

test('P2-STRUCT-3 — NEG injection 8/8: injected theses with out-of-pool witnesses all RETRACT (the harness control, on the real store)', () => {
	const g = createGlossary();
	const pool = [];
	for ( let i = 1; i <= 8; i++ ) { pool.push({ id: 'p' + i, side: 'PRO' }); g.harvest({ text: 'real ' + i, witnesses: ['p' + i], side: 'PRO' }); }
	// inject 8 bidon theses whose witnesses are NOT in the pool
	for ( let i = 1; i <= 8; i++ ) g.harvest({ text: 'bidon ' + i, witnesses: ['z' + i], side: 'PRO' });
	assert.equal(g.notions({ activeOnly: true }).length, 16);
	const retracted = g.reconcile(pool);
	assert.equal(retracted.length, 8, 'all 8 injected (z-witness) theses retracted');
	assert.equal(g.notions({ activeOnly: true }).length, 8, 'the 8 real (in-pool) notions survive');
	// NEG: reconcile against the SAME pool a second time retracts nothing new (idempotent — not vacuous)
	assert.equal(g.reconcile(pool).length, 0);
});

test('P2-STRUCT-4 — cascade JTMS: a shared witness leaving drops all citers; a private bad witness does NOT drag co-witness sharers', () => {
	const g = createGlossary();
	// witnesses chosen so the three stay DISTINCT at harvest (overlaps < θ) yet n2 & n3 SHARE exactly p3:
	g.harvest({ text: 'A', witnesses: ['a1', 'a2'], side: 'PRO' });         // n1 (private a1,a2)
	g.harvest({ text: 'B', witnesses: ['b1', 'b2', 'p3'], side: 'PRO' });   // n2 (overlap w/ n1 = 0)
	g.harvest({ text: 'C', witnesses: ['c1', 'c2', 'p3'], side: 'PRO' });   // n3 (overlap w/ n2 = 1/3 < θ)
	assert.equal(g.notions().length, 3, 'three distinct notions (no accidental merge)');
	// drop a1 only (private to n1): n1 falls, n2 & n3 stay (they keep all their own witnesses)
	let ret = g.reconcile([{ id: 'a2' }, { id: 'b1' }, { id: 'b2' }, { id: 'p3' }, { id: 'c1' }, { id: 'c2' }]);
	assert.deepEqual(ret.sort(), ['n1'], 'only n1 (its private a1 gone); co-witness sharers untouched');
	// now drop the SHARED p3: n2 (…,p3) and n3 (…,p3) both fall together — cascade
	ret = g.reconcile([{ id: 'a2' }, { id: 'b1' }, { id: 'b2' }, { id: 'c1' }, { id: 'c2' }]);
	assert.deepEqual(ret.sort(), ['n2', 'n3'], 'shared-support withdrawal: both citers of p3 fall together');
});

test('P2-STRUCT-5 — version-gate: merge & retractAlias BUMP the version (invalidation signal); credit does NOT', () => {
	const g = createGlossary();
	g.harvest({ text: 'A', witnesses: ['p1', 'p2'], side: 'PRO' });   // n1, ring registers "A" → v bumps to v2
	const vAfterAdd = g.version();
	g.harvest({ text: 'A-restated', witnesses: ['p1', 'p3'], side: 'PRO' });   // merged → alias admitted → version bumps
	const vAfterMerge = g.version();
	assert.notEqual(vAfterMerge, vAfterAdd, 'a merge (alias admitted) bumps the version');
	// NEG: credit does NOT bump (support changes no resolution semantics → caches must not invalidate)
	const c = g.credit('A-restated');
	assert.equal(c.support, 1);
	assert.equal(g.version(), vAfterMerge, 'credit does NOT bump the version');
	// retractAlias bumps (the un-learn invalidation signal)
	const rr = g.retractAlias('n1', 'A-restated');
	assert.equal(rr.retracted, true);
	assert.notEqual(g.version(), vAfterMerge, 'retractAlias bumps the version');
});

test('P2-STRUCT-6 — inject = deterministic citable vocabulary; citableKeys catches a phantom; re-run bit-identical', () => {
	const g = createGlossary();
	g.harvest({ text: 'first point', witnesses: ['p1'], side: 'PRO' });
	g.harvest({ text: 'second point', witnesses: ['c1'], side: 'CON' });
	const block1 = g.inject();
	const block2 = g.inject();
	assert.equal(block1, block2, 'inject is deterministic (re-run bit-identical)');
	assert.equal(block1, '- n1: first point [PRO]\n- n2: second point [CON]');
	assert.deepEqual(g.inject({ side: 'PRO' }), '- n1: first point [PRO]', 'side filter');
	const keys = g.citableKeys();
	assert.ok(keys.has('n1') && keys.has('n2'));
	assert.ok(!keys.has('n99'), 'NEG: a phantom key is NOT in the citable set (a re-ask citing it is caught)');
});

test('P2-STRUCT-0 — 0-fabrication: an ungrounded (witness-less) element never enters the ring', () => {
	const g = createGlossary();
	assert.equal(g.harvest({ text: 'no witnesses here', witnesses: [] }).status, 'ungrounded');
	assert.equal(g.harvest({ text: '', witnesses: ['p1'] }).status, 'ungrounded');
	assert.equal(g.notions().length, 0);
});

test('overlapOf — |shared|/|candidate| denominator (matches the generative-loop merge check)', () => {
	assert.equal(overlapOf(['p1', 'p4'], ['p1', 'p3']), 0.5);
	assert.equal(overlapOf(['p1'], ['p1', 'p2', 'p3']), 1, 'denominator is the candidate, not the member');
	assert.equal(overlapOf([], ['p1']), 0);
});
