'use strict';
/**
 * U2 — the 3-REGIME MOUNT POLICY (2026-06-27). instance(fork) / inline(addConcept) / frozen(warm replay) /
 * escalate(stay-in-LLM), chosen by (depth, efficiency, reliability) with HYSTERESIS and a well-founded
 * deopt-guarded mount-rank (the K1 floor terminates the adapt loop). Negative controls: a write-frontier
 * method is NEVER inlined (confluence); a flapping signal does NOT flap regime.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMountController, classify } = require('../../lib/authoring/mount.js');

test('regime selection by (reliability, depth, frontier)', () => {
	assert.equal(classify({ reliability: 0.9, hitRate: 0.95, depth: 1, readOnlyFrontier: true }, 'instance'), 'frozen', 'proven+dry+read-only → frozen');
	assert.equal(classify({ reliability: 0.7, hitRate: 0.7, depth: 1, readOnlyFrontier: true }, 'instance'), 'inline', 'shallow+read-only+moderately-proven → inline');
	assert.equal(classify({ reliability: 0.2, hitRate: 0.2, depth: 1, readOnlyFrontier: true }, 'instance'), 'instance', 'unproven → fork (safe default)');
});

test('NEGATIVE CONTROL: a WRITE-frontier method is never inlined/frozen (confluence) — always instance', () => {
	assert.equal(classify({ reliability: 0.99, hitRate: 0.99, depth: 0, readOnlyFrontier: false }, 'instance'), 'instance',
		'even a fully-proven method with a write frontier stays fork-per-case (inline is confluence-unsound)');
});

test('NEGATIVE CONTROL: a DEEP method is not inlined (bounded context at the join) — instance', () => {
	assert.equal(classify({ reliability: 0.7, hitRate: 0.7, depth: 5, readOnlyFrontier: true }, 'instance'), 'instance');
	// but a deep, very-proven, read-only method can still FREEZE (replay is bounded; only inline cares about depth).
	assert.equal(classify({ reliability: 0.95, hitRate: 0.95, depth: 5, readOnlyFrontier: true }, 'instance'), 'frozen');
});

test('HYSTERESIS: a signal dipping between the bands does not flap the regime', () => {
	const ctl = createMountController();
	assert.equal(ctl.decide('M', { reliability: 0.9, hitRate: 0.9, depth: 1, readOnlyFrontier: true }).regime, 'frozen');
	// dip to 0.78 — below freezeHi (0.85) but above freezeLo (0.70): a NEWLY-evaluated method would be 'inline',
	// but an already-FROZEN one holds (hysteresis).
	assert.equal(ctl.decide('M', { reliability: 0.78, hitRate: 0.78, depth: 1, readOnlyFrontier: true }).regime, 'frozen', 'held frozen in the band');
	// drop to 0.68 — crosses freezeLo (0.70) so it demotes from frozen, but still ≥ inlineHi (0.65) → inline.
	assert.equal(ctl.decide('M', { reliability: 0.68, hitRate: 0.68, depth: 1, readOnlyFrontier: true }).regime, 'inline', 'demoted to inline only after crossing the lower band');
	// drop further below inlineLo → instance.
	assert.equal(ctl.decide('M', { reliability: 0.4, hitRate: 0.4, depth: 1, readOnlyFrontier: true }).regime, 'instance');
});

test('DEOPT-GUARD / well-founded mount-rank: K deopts pin the method to ESCALATE (the K1 floor)', () => {
	const ctl = createMountController({ thresholds: { maxDeopt: 3 } });
	ctl.decide('M', { reliability: 0.9, hitRate: 0.9, depth: 1, readOnlyFrontier: true });
	assert.equal(ctl.regimeOf('M'), 'frozen');
	assert.equal(ctl.deoptBudget('M'), 3, 'μ starts at K');
	ctl.recordDeopt('M'); assert.equal(ctl.deoptBudget('M'), 2);   // μ strictly decreases
	ctl.recordDeopt('M'); assert.equal(ctl.deoptBudget('M'), 1);
	ctl.recordDeopt('M'); assert.equal(ctl.deoptBudget('M'), 0);
	assert.equal(ctl.regimeOf('M'), 'escalate', 'pinned to the LLM floor after K deopts');
	// the floor is ABSORBING: even great signals can't re-promote (sticky demotion → termination).
	assert.equal(ctl.decide('M', { reliability: 0.99, hitRate: 0.99, depth: 0, readOnlyFrontier: true }).regime, 'escalate');
});
