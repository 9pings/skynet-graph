'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E8 — LIBRARY REVISION UNDER RECURRENT DRIFT (the paper "Defeasible Library Learning").
 *
 * The question E8 isolates: when a learned method's precondition is TOO GENERAL (over-admits) and a mid-stream
 * drift makes a sub-class non-compliant, does it matter whether the library REVISES the precondition or merely
 * EVICTS the stale cache entry? The prior arms (RAG/CBR/SKILL) never even get the drift event; the INVALIDATING
 * baseline gets it but invalidates by a coarse hand-coded callback. E8 zooms into the FINEST grain: the SAME
 * defeasance event, handled two ways, over K recurrent episodes (the same classes recur every episode AFTER the
 * drift). It exercises the REAL contract primitives — `assertPost` (blame), `reviseOnBlame` (specialize-the-pre,
 * CEGIS/ICE), `satisfies` (the selection-side admission gate) — never a reimplementation.
 *
 *   EVICT-ONLY (neg control)  on a violated post, drop the cached entry + re-derive. The PRE is never specialized,
 *                             so the over-general method KEEPS CLAIMING the failing class (`satisfies` still true),
 *                             re-derives its stale `approve`, re-blames, re-evicts — EVERY episode. Cost (blames +
 *                             re-derivations) recurs ∝ K; false-admit rate stays > 0. (A cache-level fix that never
 *                             touches the rule — the "stale skill stays retrievable" critique, made concrete.)
 *   REVISE      (real)        on the FIRST blame, `reviseOnBlame` narrows the pre with the counterexample's
 *                             discriminating atom. From the next episode `satisfies(revised.pre, case)` EXCLUDES the
 *                             failing class → 0 re-admit, 0 re-blame, 0 re-derivation of it; false-admit → 0 after
 *                             episode 1. AND it is SURGICAL: a sibling class is still admitted (not method removal).
 *
 * Two premise KINDS, to show `reviseOnBlame` is premise-agnostic:
 *   (a) CATEGORICAL — a compliance-flag flip. Over-general pre `score>=700` misses the regulatory premise; the audit
 *       sets `compliant=false` on one class. reviseOnBlame adds `$compliant!=false`.
 *   (b) NUMERIC — a tightened score gate. Over-general pre `score>=650`; the audit tightens the world post to
 *       `approve ⟹ score>=700`, so the borderline class score=680 now violates. reviseOnBlame adds `$score!=680`.
 *
 * HONEST CHARACTERIZATION (measured, not hidden): `reviseOnBlame` specializes by COUNTEREXAMPLE POINT-EXCLUSION
 * (`$key != value`), not by bound-tightening — it does NOT rewrite `score>=650` into `score>=700`. So per DISTINCT
 * failing value it pays exactly ONE blame, then flatlines for that value; a failing region with D distinct values
 * needs D one-time blames (still bounded + per-value flat — NOT per-episode like EVICT-ONLY). E8 measures the
 * single-recurring-value case for the table and reports the multi-value behavior explicitly (see `pointExclusion`).
 *
 * Deterministic: no Date.now / Math.random in the logic. Run: `node artifact/paper-dll/revise.js`.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const C = require(ROOT + '/lib/authoring/contract.js');     // the REAL defeasible-contract checker (assertPost/reviseOnBlame/satisfies)

const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');
const classKey = ( c ) => c.id;                              // a stable typed identity (the memo key)

// ── the two workloads (premise KINDS). Each = { initialPre, post, discriminatingKey, classes, truth } ──
// classes[i] = { id, facts, role:'good'|'fail'|'belowGate' }. The world post is POST-DRIFT throughout the K
// measured episodes (the over-general pre was learned in a prior, un-measured phase).

function categoricalWorkload() {
	// every class clears the over-general score gate (score>=700); the audit invalidates ONE (compliant=false).
	const classes = [
		{ id: 'EU|loan',   facts: { score: 720, compliant: false }, role: 'fail' },   // the drifted class
		{ id: 'EU|refund', facts: { score: 720, compliant: true  }, role: 'good' },   // sibling, same region
		{ id: 'US|loan',   facts: { score: 760, compliant: true  }, role: 'good' },
		{ id: 'US|wire',   facts: { score: 710, compliant: true  }, role: 'good' },
	];
	return {
		name: 'CATEGORICAL (compliance-flag flip)',
		initialPre: ['score>=700'],                                   // misses the compliance premise → over-general
		post: ['decision != "approve" || $compliant'],               // approve ⟹ compliant (the audited world post)
		discriminatingKey: 'compliant',                              // the typed fact the over-general pre failed to capture
		classes,
		truth: ( c ) => ( c.facts.score >= 700 && c.facts.compliant ) ? 'approve' : 'reject',
	};
}

function numericWorkload() {
	// the audit TIGHTENS the world threshold 650 -> 700; the borderline class (680) now violates the post.
	const classes = [
		{ id: 's680', facts: { score: 680 }, role: 'fail' },         // borderline: passed score>=650, fails score>=700
		{ id: 's720', facts: { score: 720 }, role: 'good' },
		{ id: 's760', facts: { score: 760 }, role: 'good' },
		{ id: 's620', facts: { score: 620 }, role: 'belowGate' },    // excluded by the original gate throughout
	];
	return {
		name: 'NUMERIC (tightened score gate)',
		initialPre: ['score>=650'],                                  // too loose: admits 680
		post: ['decision != "approve" || score>=700'],               // approve ⟹ score>=700 (the tightened world post)
		discriminatingKey: 'score',
		classes,
		truth: ( c ) => ( c.facts.score >= 700 ) ? 'approve' : 'reject',
	};
}

// ── the model (deterministic). A "model call" = a derivation. The LIBRARY METHOD body emits its crystallized
//    action (`approve`) — the audit is an EXTERNAL premise the body never consults (cf. contract-unlearn.js
//    `App::approve` always approves). The FALLBACK path reasons fresh with current world knowledge → the correct
//    action. Both cost exactly one call on a cache miss. No randomness, no clock. ──
const METHOD_ACTION = 'approve';

/**
 * runArm — replay K episodes of a workload under one revision policy.
 * @param policy 'EVICT' | 'REVISE'
 * @returns { policy, perEpisode:[{k,blames,calls,falseAdmits,admitted}], finalPre, totals, finalState }
 */
function runArm( policy, wl, episodes ) {
	let contract = { read: ['score'], write: ['decision'], pre: wl.initialPre.slice(),
		post: wl.post.slice(), effect: 'internal' };
	const memo = new Map();          // the LIBRARY memo (method-derived results), keyed by classKey
	const fbMemo = new Map();        // the FALLBACK memo (fresh correct derivations for excluded classes)
	const perEpisode = [];

	for ( let k = 1; k <= episodes; k++ ) {
		let blames = 0, calls = 0, falseAdmits = 0, admitted = 0;
		for ( const c of wl.classes ) {
			if ( C.satisfies(contract.pre, c.facts) ) {              // REAL admission gate (the revised pre feeds back here)
				admitted++;
				let action;
				if ( memo.has(classKey(c)) ) action = memo.get(classKey(c));
				else { action = METHOD_ACTION; calls++; memo.set(classKey(c), action); }   // method-body derivation
				// REAL runtime post-assert against the current (audited) world.
				const realized = Object.assign({ decision: action }, c.facts);
				const verdict = C.assertPost({ write: ['decision'], post: contract.post, effect: 'pure' }, realized, ['decision']);
				if ( !verdict.ok ) {
					blames++;
					if ( action !== wl.truth(c) ) falseAdmits++;     // the method admitted c and its action is WRONG
					if ( policy === 'REVISE' ) {                     // specialize the pre with the discriminating fact (CEGIS)
						contract = C.reviseOnBlame(contract, { key: wl.discriminatingKey, value: c.facts[wl.discriminatingKey] });
					}
					memo.delete(classKey(c));                        // both policies drop the stale entry; only REVISE also narrows the pre
				}
			} else {                                                 // the method no longer claims c → fallback (fresh, correct)
				if ( !fbMemo.has(classKey(c)) ) { fbMemo.set(classKey(c), wl.truth(c)); calls++; }
				// the fallback consults the current world → correct by construction → no blame, no false-admit.
			}
		}
		perEpisode.push({ k, blames, calls, falseAdmits, admitted });
	}

	const totals = perEpisode.reduce(( t, e ) => ({ blames: t.blames + e.blames, calls: t.calls + e.calls,
		falseAdmits: t.falseAdmits + e.falseAdmits }), { blames: 0, calls: 0, falseAdmits: 0 });
	const failing = wl.classes.find(( c ) => c.role === 'fail' );
	const sibling = wl.classes.find(( c ) => c.role === 'good' );
	const finalState = {
		failingExcluded: !C.satisfies(contract.pre, failing.facts),
		siblingAdmitted: C.satisfies(contract.pre, sibling.facts),
		belowGateExcluded: ( () => { const b = wl.classes.find(( c ) => c.role === 'belowGate' );
			return b ? !C.satisfies(contract.pre, b.facts) : null; } )(),
	};
	return { policy, perEpisode, finalPre: contract.pre.slice(), totals, finalState,
		falseAdmitRate: perEpisode.map(( e ) => e.falseAdmits / wl.classes.length) };
}

// the HONEST point-exclusion probe: a SECOND distinct failing value is NOT auto-excluded by the first revision —
// reviseOnBlame is counterexample-driven (point `!=`), not bound-tightening. (Numeric premise only.)
function pointExclusionProbe() {
	const rev1 = C.reviseOnBlame({ read: ['score'], pre: ['score>=650'] }, { key: 'score', value: 680 });
	const v660Before = C.satisfies(rev1.pre, { score: 660 });           // a 2nd in-range failing value, still admitted
	const rev2 = C.reviseOnBlame(rev1, { key: 'score', value: 660 });   // needs its OWN blame
	const v660After = C.satisfies(rev2.pre, { score: 660 });
	return { afterFirstRevision_660_admitted: v660Before, afterSecondRevision_660_admitted: v660After,
		pre1: rev1.pre, pre2: rev2.pre };
}

function measure( episodes = 5 ) {
	const workloads = [categoricalWorkload(), numericWorkload()];
	const rows = workloads.map(( wl ) => ({
		wl, evict: runArm('EVICT', wl, episodes), revise: runArm('REVISE', wl, episodes) }));
	return { episodes, rows, pointExclusion: pointExclusionProbe() };
}

// ── verdict (the kill-criteria, computed not asserted) ──
function verdict( m ) {
	const K = m.episodes;
	const checks = m.rows.map(( { wl, evict, revise } ) => {
		const reviseBlamesOnce = revise.totals.blames === 1 && revise.perEpisode.slice(1).every(( e ) => e.blames === 0 );
		const evictReblames = evict.totals.blames === K && evict.perEpisode.every(( e ) => e.blames === 1 );
		const reviseFAtoZero = revise.perEpisode[0].falseAdmits === 1 && revise.perEpisode.slice(1).every(( e ) => e.falseAdmits === 0 );
		const evictFAstays = evict.perEpisode.every(( e ) => e.falseAdmits === 1 );
		const reviseCallsFlat = revise.perEpisode.slice(2).every(( e ) => e.calls === 0 );   // flat from episode 3 (ep2 = 1 fallback derive)
		const evictCallsRecur = evict.perEpisode.slice(1).every(( e ) => e.calls === 1 );      // re-derives the failing class each episode
		const surgical = revise.finalState.failingExcluded && revise.finalState.siblingAdmitted;
		const notDeletion = evict.finalState.siblingAdmitted && evict.finalState.failingExcluded === false;  // EVICT keeps admitting everything
		return { name: wl.name, reviseBlamesOnce, evictReblames, reviseFAtoZero, evictFAstays,
			reviseCallsFlat, evictCallsRecur, surgical, notDeletion };
	});
	const allHold = checks.every(( c ) => c.reviseBlamesOnce && c.evictReblames && c.reviseFAtoZero && c.evictFAstays
		&& c.reviseCallsFlat && c.evictCallsRecur && c.surgical && c.notDeletion );
	return { checks, allHold };
}

function main() {
	const m = measure(5), v = verdict(m), K = m.episodes;
	out('\nE8 — library REVISION under recurrent drift (real contract.js: assertPost / reviseOnBlame / satisfies)');
	out(`     K = ${K} recurrent episodes; the same classes recur every episode after the drift.\n`);

	for ( const { wl, evict, revise } of m.rows ) {
		out(`── ${wl.name} ──`);
		out(`   over-general pre: ${JSON.stringify(wl.initialPre)}   world post: ${JSON.stringify(wl.post)}`);
		const hdr = '   episode |' + Array.from({ length: K }, ( _, i ) => ` e${i + 1}`).join('  ') + '   | cumulative';
		const fmtRow = ( label, arm, field ) => `   ${label.padEnd(8)}|` +
			arm.perEpisode.map(( e ) => `  ${String(e[field]).padStart(2)}` ).join('') + `   | ${arm.totals[field]}`;
		out('   blames (per episode):');
		out(hdr);
		out(fmtRow('EVICT', evict, 'blames'));
		out(fmtRow('REVISE', revise, 'blames'));
		out('   re-derivations / model calls (per episode):');
		out(fmtRow('EVICT', evict, 'calls'));
		out(fmtRow('REVISE', revise, 'calls'));
		out('   false-admits (per episode):');
		out(fmtRow('EVICT', evict, 'falseAdmits'));
		out(fmtRow('REVISE', revise, 'falseAdmits'));
		out(`   REVISE false-admit RATE / episode: [${revise.falseAdmitRate.map(( r ) => r.toFixed(2)).join(', ')}]  → 0 after episode 1`);
		out(`   EVICT  false-admit RATE / episode: [${evict.falseAdmitRate.map(( r ) => r.toFixed(2)).join(', ')}]  → stays > 0`);
		out(`   REVISE final pre: ${JSON.stringify(revise.finalPre)}`);
		out(`     · failing class excluded=${revise.finalState.failingExcluded} · sibling still admitted=${revise.finalState.siblingAdmitted}` +
			( revise.finalState.belowGateExcluded != null ? ` · below-gate excluded=${revise.finalState.belowGateExcluded}` : '' ) + '   (surgical, not method removal)');
		out(`   EVICT  final pre: ${JSON.stringify(evict.finalPre)}  (never specialized → still admits the failing class)\n`);
	}

	const pe = m.pointExclusion;
	out('── HONEST CHARACTERIZATION: reviseOnBlame = counterexample POINT-EXCLUSION, not bound-tightening ──');
	out(`   revise(score=680) → ${JSON.stringify(pe.pre1)}`);
	out(`   a 2nd distinct failing value (660) is still admitted after that revision: ${pe.afterFirstRevision_660_admitted} (needs its own blame)`);
	out(`   revise(...,660)  → ${JSON.stringify(pe.pre2)}  → 660 admitted=${pe.afterSecondRevision_660_admitted}`);
	out('   ⇒ D distinct failing values cost D ONE-TIME blames (bounded, per-value flat) — NOT EVICT-ONLY\'s per-episode recurrence.\n');

	out('VERDICT (E8 kill-criteria, per premise kind):');
	for ( const c of v.checks ) {
		out(`   ${c.name}`);
		out(`     REVISE blames once then 0 = ${c.reviseBlamesOnce} | EVICT re-blames every episode (=K) = ${c.evictReblames}`);
		out(`     REVISE false-admit→0      = ${c.reviseFAtoZero} | EVICT false-admit stays >0        = ${c.evictFAstays}`);
		out(`     REVISE re-derivations flat = ${c.reviseCallsFlat} | EVICT re-derives every episode    = ${c.evictCallsRecur}`);
		out(`     REVISE surgical (sibling kept, failing dropped) = ${c.surgical} | EVICT is not deletion (keeps admitting) = ${c.notDeletion}`);
	}
	out(`\n   ALL CLAIMS HOLD: ${v.allHold}`);
	out('   E8 establishes: revising the precondition (reviseOnBlame) makes the library un-learn an over-general claim');
	out('   in ONE blame and flatline, where cache-eviction alone re-blames + re-derives the same stale class every episode.');
}

module.exports = { categoricalWorkload, numericWorkload, runArm, pointExclusionProbe, measure, verdict };
if ( require.main === module ) { try { main(); } catch ( e ) { console.error(e); process.exit(1); } }
