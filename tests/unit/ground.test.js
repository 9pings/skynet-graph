'use strict';
/**
 * ground.js — gold-mined grounding rings (the promoted core of the 2026-07-06 ring-grounding cells:
 * entity→table joins 0.764→0.800; attribute vocab 0→11/18 at 0 served-wrong). Each test locks a grain the
 * cells measured against its own failed variant.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mineGroundingRings, ringTouch } = require('../../lib/authoring/forge/ground.js');
const { retractRingAlias } = require('../../lib/authoring/lattice/registry.js');

const EP = ( aliases, gold, base ) => ({ aliases, gold, base });

test('recurrence admits; a one-shot alias does not (support >= minSupport — the fluke door)', () => {
	const eps = [
		EP(['headcount'], 'population'), EP(['headcount'], 'population'), EP(['headcount'], 'population'),
		EP(['populace'], 'population'),                                    // one-shot — refused
		// other-label episodes keep the population base-rate below the vacuity-by-prior threshold (a
		// single-label corpus makes EVERYTHING vacuous by prior — by design, see the constant-oracle test).
		EP(['seat'], 'capital'), EP(['seat'], 'capital'), EP(['seat'], 'capital')
	];
	const r = mineGroundingRings(eps, { key: 'attribute', enum: ['population', 'capital'] });
	assert.deepEqual(r.admitted.map(( p ) => p.alias ).sort(), ['headcount', 'seat']);
	assert.equal(r.stats.confluenceRejected, 0);
	assert.deepEqual([...ringTouch(['headcount'], r.registry, 'attribute')], ['population']);
	assert.equal(ringTouch(['populace'], r.registry, 'attribute').size, 0);
});

test('an OOV-labeled trap NEVER admits (gold null → no support; a conflicting label counters)', () => {
	const eps = [
		EP(['density'], null), EP(['density'], null), EP(['density'], null),          // the trap phrasings
		EP(['tender'], 'currency'), EP(['tender'], 'currency'), EP(['tender'], 'currency'),
		EP(['point'], 'capital'), EP(['point'], 'population'), EP(['point'], 'capital')   // conflicted → countered
	];
	const r = mineGroundingRings(eps, { key: 'attribute', enum: ['currency', 'capital', 'population'] });
	assert.deepEqual(r.admitted.map(( p ) => p.alias ), ['tender']);
	assert.ok(r.stats.countered >= 1, 'the conflicted alias was countered, not admitted');
});

test('vacuity by BASE — an alias whose member the lexical base already grounds everywhere adds nothing', () => {
	const base = new Set(['capital']);
	const eps = [ EP(['seat'], 'capital', base), EP(['seat'], 'capital', base), EP(['seat'], 'capital', base) ];
	const r = mineGroundingRings(eps, { key: 'attribute', enum: ['capital'], maxBaseRate: 1.1 });
	assert.equal(r.admitted.length, 0, 'vacuous-by-base → refused');
	assert.ok(r.stats.vacuous >= 1);
});

test('vacuity by PRIOR — a CONSTANT oracle admits NOTHING (the degenerate-oracle grain: base-rate > maxBaseRate)', () => {
	// every episode names the same member → the prior grounds it; any alias is vacuous. This is the grain that
	// makes a constant/degenerate oracle yield ZERO admissions (the tables cell's NEG-v2 lesson).
	const eps = [];
	for ( let i = 0; i < 10; i++ ) eps.push(EP(['tok' + (i % 3)], 'main'));
	const r = mineGroundingRings(eps, { key: 'table', enum: ['main', 'other'] });
	assert.equal(r.admitted.length, 0);
	assert.ok(r.stats.vacuous >= 1, 'refused as vacuous-by-prior, not as countered');
});

test('the NEUTRAL middle bucket is load-bearing — a custom verdict may abstain without killing a true alias', () => {
	// the tables cell measured: counting the overshoot bucket AGAINST kills true aliases via lexical-base noise
	// (0.800→0.733). Same evidence, two verdicts: neutral admits, counter kills.
	const gold = new Set(['flights']);
	const clean = new Set(), noisyBase = new Set(['airlines']);             // ONE episode carries lexical noise outside the gold
	const mk = ( neutralize ) => mineGroundingRings([
		{ aliases: ['flight'], gold, base: clean }, { aliases: ['flight'], gold, base: clean },
		{ aliases: ['flight'], gold, base: clean }, { aliases: ['flight'], gold, base: noisyBase }
	], { key: 'table', enum: ['flights', 'airlines'], maxBaseRate: 1.1, verdict: ( ep, member ) => {
		if ( !ep.gold.has(member) ) return 'counter';
		const touched = new Set([...ep.base, member]);
		const overshoot = ![...touched].every(( t ) => ep.gold.has(t) );
		return overshoot ? (neutralize ? 'neutral' : 'counter') : 'support';
	} });
	assert.equal(mk(true).admitted.length, 1, 'neutral bucket → the true alias admits despite base noise');
	assert.equal(mk(false).admitted.length, 0, 'counting the overshoot against → the true alias dies (the measured failure mode)');
});

test('LOCALIZATION — removing one alias\'s oracle support flips exactly that alias (re-mine)', () => {
	const eps = [
		EP(['headcount'], 'population'), EP(['headcount'], 'population'), EP(['headcount'], 'population'),
		EP(['tender'], 'currency'), EP(['tender'], 'currency'), EP(['tender'], 'currency')
	];
	const all = mineGroundingRings(eps, { key: 'attribute', enum: ['population', 'currency'] });
	assert.equal(all.admitted.length, 2);
	const dropped = eps.map(( e ) => e.aliases.includes('headcount') ? EP(e.aliases, null) : e );
	const re = mineGroundingRings(dropped, { key: 'attribute', enum: ['population', 'currency'] });
	assert.deepEqual(re.admitted.map(( p ) => p.alias ), ['tender'], 'exactly the targeted alias flipped, zero collateral');
});

test('confluence + provenance + RETRACTION — one alias one member; a bad admission is recoverable', () => {
	const eps = [
		EP(['crown'], 'currency'), EP(['crown'], 'currency'), EP(['crown'], 'currency'),
		EP(['crown2'], 'capital'), EP(['crown2'], 'capital'), EP(['crown2'], 'capital')
	];
	const r = mineGroundingRings(eps, { key: 'attribute', enum: ['currency', 'capital'], via: 'gold-mined' });
	assert.equal(r.admitted.length, 2);
	assert.equal(r.registry.ringProvenance['attribute::crown'].via, 'gold-mined', 'provenance = auditable + retractable');
	// the soundness envelope: a wrong admission is DEFEASIBLE — retract removes it and only it.
	const after = retractRingAlias(r.registry, 'attribute', 'crown');
	assert.equal(after.retracted, true);
	assert.equal(ringTouch(['crown'], after.registry, 'attribute').size, 0);
	assert.deepEqual([...ringTouch(['crown2'], after.registry, 'attribute')], ['capital'], 'the other alias untouched');
});

test('multi-member gold (the tables shape) — an alias grounds through Set golds; ringTouch serves it', () => {
	const g1 = new Set(['flights', 'airlines']);
	const eps = [ EP(['carrier'], g1), EP(['carrier'], g1), EP(['carrier'], new Set(['airlines'])) ];
	// 'carrier'→airlines: 3 supports 0 counters; 'carrier'→flights: 2 supports 1 counter → refused.
	const r = mineGroundingRings(eps, { key: 'table', enum: ['flights', 'airlines'], maxBaseRate: 1.1 });
	assert.deepEqual(r.admitted.map(( p ) => p.alias + '→' + p.member ), ['carrier→airlines']);
	assert.deepEqual([...ringTouch(['the', 'carrier'], r.registry, 'table')], ['airlines']);
});
