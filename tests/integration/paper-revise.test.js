'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E8 — library REVISION under recurrent drift, the deterministic regression for
 * `artifact/paper-dll/revise.js`. Every claim is paired with a NEGATIVE CONTROL (the EVICT-ONLY arm, which
 * handles the SAME blame at the cache level but never specializes the pre). Exercises the REAL contract
 * primitives — `assertPost` (blame), `reviseOnBlame` (specialize-the-pre), `satisfies` (admission gate) — and
 * runs BOTH premise kinds (categorical compliance-flag + numeric tightened gate).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const E8 = require(ROOT + '/artifact/paper-dll/revise.js');
const C = require(ROOT + '/lib/authoring/contract.js');

const K = 5;
const workloads = () => [['CATEGORICAL', E8.categoricalWorkload()], ['NUMERIC', E8.numericWorkload()]];

// (a) — REVISE blames ONCE then 0 across episodes; EVICT-ONLY (neg control) re-blames EVERY episode.
test('E8(a): REVISE blames once then flatlines; EVICT-ONLY re-blames every episode (neg control)', () => {
	for ( const [tag, wl] of workloads() ) {
		const revise = E8.runArm('REVISE', wl, K);
		const evict = E8.runArm('EVICT', wl, K);
		// REVISE: exactly one blame, in episode 1, zero thereafter.
		assert.equal(revise.perEpisode[0].blames, 1, `${tag}: REVISE blames in episode 1`);
		assert.ok(revise.perEpisode.slice(1).every(( e ) => e.blames === 0 ), `${tag}: REVISE 0 blames after episode 1`);
		assert.equal(revise.totals.blames, 1, `${tag}: REVISE cumulative blames == 1`);
		// NEG CONTROL: EVICT-ONLY re-blames every episode → cumulative grows linearly in K.
		assert.ok(evict.perEpisode.every(( e ) => e.blames === 1 ), `${tag}: EVICT re-blames every episode`);
		assert.equal(evict.totals.blames, K, `${tag}: EVICT cumulative blames == K (${K})`);
		// re-derivations: EVICT re-derives the failing class every episode (≥1 each); REVISE flatlines to 0.
		assert.ok(evict.perEpisode.slice(1).every(( e ) => e.calls === 1 ), `${tag}: EVICT re-derives the failing class each episode`);
		assert.ok(revise.perEpisode.slice(2).every(( e ) => e.calls === 0 ), `${tag}: REVISE re-derivations flatline to 0`);
		assert.ok(revise.totals.calls < evict.totals.calls, `${tag}: REVISE cumulative re-derivations < EVICT`);
	}
});

// (b) — REVISE false-admit rate → 0 after the revision; EVICT-ONLY stays > 0 every episode.
test('E8(b): REVISE false-admit → 0 after revision; EVICT-ONLY stays > 0 (neg control)', () => {
	for ( const [tag, wl] of workloads() ) {
		const revise = E8.runArm('REVISE', wl, K);
		const evict = E8.runArm('EVICT', wl, K);
		assert.equal(revise.perEpisode[0].falseAdmits, 1, `${tag}: REVISE false-admits once (before it revises)`);
		assert.ok(revise.perEpisode.slice(1).every(( e ) => e.falseAdmits === 0 ), `${tag}: REVISE false-admit → 0 after episode 1`);
		assert.ok(revise.falseAdmitRate.slice(1).every(( r ) => r === 0 ), `${tag}: REVISE false-admit RATE → 0`);
		// NEG CONTROL: EVICT-ONLY's false-admit count + rate stay strictly > 0 every episode.
		assert.ok(evict.perEpisode.every(( e ) => e.falseAdmits === 1 ), `${tag}: EVICT false-admits every episode`);
		assert.ok(evict.falseAdmitRate.every(( r ) => r > 0 ), `${tag}: EVICT false-admit RATE stays > 0`);
	}
});

// (c) — REVISE is SURGICAL: it excludes the failing class but KEEPS a sibling. Neg control: it isn't just
//       deleting the method (EVICT keeps admitting everything; the revised pre admits the sibling via satisfies).
test('E8(c): REVISE does not over-specialize — a sibling class is still admitted (not method removal)', () => {
	for ( const [tag, wl] of workloads() ) {
		const revise = E8.runArm('REVISE', wl, K);
		const failing = wl.classes.find(( c ) => c.role === 'fail' );
		const sibling = wl.classes.find(( c ) => c.role === 'good' );
		// the REAL selection gate on the REAL revised pre: failing excluded, sibling admitted.
		assert.equal(C.satisfies(revise.finalPre, failing.facts), false, `${tag}: revised pre EXCLUDES the failing class`);
		assert.equal(C.satisfies(revise.finalPre, sibling.facts), true, `${tag}: revised pre still ADMITS the sibling (surgical)`);
		assert.equal(revise.finalState.failingExcluded, true);
		assert.equal(revise.finalState.siblingAdmitted, true);
		// NEG CONTROL: it is NOT "delete the method" — EVICT (no revision) still admits BOTH failing + sibling.
		const evict = E8.runArm('EVICT', wl, K);
		assert.equal(evict.finalState.failingExcluded, false, `${tag}: EVICT never excludes the failing class (pre unchanged)`);
		assert.equal(evict.finalState.siblingAdmitted, true, `${tag}: EVICT still admits the sibling`);
		// the revised pre also still honors the original gate (below-gate / wrong-region cases stay excluded).
		if ( wl.classes.some(( c ) => c.role === 'belowGate' ) )
			assert.equal(revise.finalState.belowGateExcluded, true, `${tag}: the original gate still excludes below-gate cases`);
	}
});

// (d) — both premise KINDS revise correctly (categorical compliance-flag + numeric tightened gate), AND the
//       honest characterization: reviseOnBlame is counterexample POINT-EXCLUSION, not bound-tightening.
test('E8(d): both premise kinds revise; reviseOnBlame is point-exclusion (honest, neg control)', () => {
	const m = E8.measure(K);
	const v = E8.verdict(m);
	assert.equal(v.allHold, true, 'all E8 kill-criteria hold for BOTH premise kinds');
	assert.equal(v.checks.length, 2, 'both categorical + numeric measured');
	// the discriminating atom each kind produced (premise-agnostic: categorical `!=` flag, numeric `!=` value).
	const cat = m.rows.find(( r ) => /CATEGORICAL/.test(r.wl.name) ).revise.finalPre;
	const num = m.rows.find(( r ) => /NUMERIC/.test(r.wl.name) ).revise.finalPre;
	assert.ok(cat.includes('$compliant!=false'), 'categorical revision adds a flag exclusion');
	assert.ok(num.includes('$score!=680'), 'numeric revision adds a value exclusion');
	// HONEST: a 2nd distinct failing value is NOT auto-excluded by the first revision (point, not bound).
	const pe = m.pointExclusion;
	assert.equal(pe.afterFirstRevision_660_admitted, true, 'a 2nd distinct failing value (660) survives the 680 revision');
	assert.equal(pe.afterSecondRevision_660_admitted, false, 'it needs its OWN blame to be excluded (one-time, not per-episode)');
});

// instrumentation guard — under the deterministic stub the EVICT/REVISE arms must produce the EXACT predicted
// shape (a broken accounting would not). This is the #34-style guard: refuse to trust a comparative result whose
// baseline shape is wrong.
test('E8 guard: episode-1 warming is identical across arms; the contrast is the failing class only', () => {
	for ( const [tag, wl] of workloads() ) {
		const revise = E8.runArm('REVISE', wl, K);
		const evict = E8.runArm('EVICT', wl, K);
		// episode 1 is IDENTICAL across arms (revision only takes effect from episode 2): same warming, same blame.
		assert.deepEqual(
			{ b: revise.perEpisode[0].blames, c: revise.perEpisode[0].calls, f: revise.perEpisode[0].falseAdmits },
			{ b: evict.perEpisode[0].blames, c: evict.perEpisode[0].calls, f: evict.perEpisode[0].falseAdmits },
			`${tag}: episode-1 (pre-revision) is identical across arms`);
		// the failing class is the ONLY one that ever blames (good/below-gate classes never do).
		assert.ok(evict.perEpisode.every(( e ) => e.blames === 1 ), `${tag}: exactly one class blames per episode`);
	}
});
