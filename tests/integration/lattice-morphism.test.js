/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * lattice-morphism — STRUCTURAL reconciliation (the cross-treillis / cross-model residual, structural level; owner
 * 2026-07-09). Two models/domains may carve the SAME underlying ordered base into DIFFERENT partitions
 * ({low,mid,high} vs {cold,cool,warm,hot}). Reconciliation is then NOT a synonym alias (lexical) but a MORPHISM
 * derived from INTERVAL OVERLAP on the shared base — grounded, deterministic, and DEFEASIBLE at boundaries (a value
 * near a disputed cut is ambiguous → escalate, never a forced map). A known VALUE reconciles exactly; a coarse MEMBER
 * reconciles to a SET (the coarsening loss). This is the principled answer to "the only real hole".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyValue, memberMorphism } = require('../../lib/authoring/lattice-morphism.js');

const A = [{ member: 'low', lo: 0, hi: 33 }, { member: 'mid', lo: 33, hi: 66 }, { member: 'high', lo: 66, hi: 100 }];
const B = [{ member: 'cold', lo: 0, hi: 25 }, { member: 'cool', lo: 25, hi: 50 }, { member: 'warm', lo: 50, hi: 75 }, { member: 'hot', lo: 75, hi: 100 }];

test('VALUE reconciles EXACTLY across carvings (deterministic, both from the shared base)', () => {
	assert.equal(classifyValue(A, 70).member, 'high');
	assert.equal(classifyValue(B, 70).member, 'warm', 'value 70 = A-high = B-warm — reconciled via the shared base, no re-learning');
	assert.equal(classifyValue(A, 30).member, 'low');
	assert.equal(classifyValue(B, 30).member, 'cool');
	assert.equal(classifyValue(A, 100).member, 'high', 'top boundary is inclusive');
});

test('coarse MEMBER reconciles to a SET (the coarsening loss where one carving is coarser)', () => {
	const aToB = memberMorphism(A, B);
	assert.deepEqual(aToB.reconcile('high'), ['warm', 'hot'], 'A-high spans B-warm and B-hot (A is coarser there)');
	assert.deepEqual(aToB.reconcile('low'), ['cold', 'cool']);
	assert.deepEqual(aToB.reconcile('mid'), ['cool', 'warm']);
});

test('CLEAN vs cross-cutting — a contained member maps to a singleton; a straddling one to a set', () => {
	const bToA = memberMorphism(B, A);
	assert.deepEqual(bToA.reconcile('cold'), ['low'], 'cold ⊂ low → clean singleton');
	assert.deepEqual(bToA.reconcile('hot'), ['high'], 'hot ⊂ high → clean singleton');
	assert.deepEqual(bToA.reconcile('cool'), ['low', 'mid'], 'cool straddles the low/mid cut → set (defeasible)');
	assert.deepEqual(bToA.reconcile('warm'), ['mid', 'high'], 'warm straddles the mid/high cut → set');
});

test('DEFEASIBLE boundary — a value near a disputed cut is flagged AMBIGUOUS (escalate, never a forced map)', () => {
	assert.equal(classifyValue(B, 74.8, { eps: 0.5 }).ambiguous, true, 'near the warm/hot cut (75) → ambiguous');
	assert.equal(classifyValue(B, 60, { eps: 0.5 }).ambiguous, false, 'well inside warm → not ambiguous');
	assert.equal(classifyValue(B, 74.8, { eps: 0.5 }).member, 'warm', 'still classified, but the ambiguity is surfaced');
});

test('NEGATIVE — a disjoint / out-of-base value has NO member (fail-closed, not a forced nearest)', () => {
	assert.equal(classifyValue(A, 140).member, null, 'out of base → null, never a forced nearest match');
	const aToB = memberMorphism([{ member: 'x', lo: 200, hi: 300 }], B);
	assert.deepEqual(aToB.reconcile('x'), [], 'a disjoint member reconciles to the empty set — no fabricated overlap');
});
