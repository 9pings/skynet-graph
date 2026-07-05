'use strict';
/*
 * stream-lab.js — le LAB déterministe de la boucle d'apprentissage des restrictions (roadmap #2),
 * protocole Laurie (../../sota/2026-07-03-restriction-learning-lab-laurie.md) appliqué à la lettre :
 *   - DEUX ATOMES D'ORACLE DIVERGENTS (le fix FATAL 8a) : le succès SUPERFICIEL (permissif — un mauvais
 *     filtre numérique matche des lignes par accident → FAUX-POSITIF qui soulève la LGG de A au-delà de la
 *     cible) vs le CONTRAT PROFOND par-slot (localisant — l'atome nomme le slot fautif). Ils divergent
 *     exactement sur les combos badFilter.
 *   - 4 arms sur streams IDENTIQUES : A = LGG-seul (positifs superficiels, échecs ignorés) · B = LGG +
 *     négatifs BLAME-LOCALISÉS seulement (le deep VETO le positif ; non-localisé → jeté) · C = LGG + TOUT
 *     échec = négatif sur toutes les facettes (le contrôle UNSOUND) · D = B + optimisme à horizon doublant.
 *   - 2 canaux de bruit, CORRÉLÉS-RARE (Laurie 3/4) : N1 = faux-échec NON-localisable sur la 1re occurrence
 *     de chaque sorte rare (P ∝ 1/freq) · N2 = wrong-blame ρ∈{0,.1,.3} — sur un badFilter, l'atome est
 *     flippé vers le slot BON dont la sorte est rare (le faux-blame indistinguable d'une vraie restriction).
 *   - Comptes EXACTS pré-enregistrés (Laurie 6/8b — « A CONVERGE, au mauvais point-fixe sous faux-positifs »),
 *     tenus sur 3 permutations × 2 treillis, par-cellule, jamais moyennés.
 *   - Bootstrap : S=null → admit (on ne peut pas refuser par ignorance ; documenté). L'apprenant ne lit QUE
 *     les atomes pass/fail (jamais la table de types — Laurie 8c).
 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { lattice, slotLearner } = require('./learn-core.js');

// ── the two lattices (≥3 leaves under each target cut + one multi-parent pair; L2 deeper on numeric) ────
const LATS = {
	L1: lattice({ column: null, categorical: 'column', numeric: 'column', textual: 'column',
		status: 'categorical', client: 'categorical', priority: 'categorical',
		amount: 'numeric', copies: 'numeric', year: 'numeric',
		genre: ['categorical', 'textual'], topic: ['categorical', 'textual'] }),
	L2: lattice({ column: null, categorical: 'column', numeric: 'column', textual: 'column', money: 'numeric',
		status: 'categorical', client: 'categorical', priority: 'categorical',
		amount: 'money', copies: 'numeric', year: 'numeric',
		genre: ['categorical', 'textual'], topic: ['categorical', 'textual'] }),
};
const TARGET = { filter: 'categorical', metric: 'numeric' };
const FILTER_GOOD = ['status', 'client', 'priority', 'genre', 'topic'];
const FILTER_BAD = ['amount', 'copies', 'year'];
const METRIC_GOOD = ['amount', 'copies', 'year'];
const RARE = new Set(['priority', 'genre', 'topic', 'year']);              // commons appear ×4, rares ×2

// ── the base stream (before permutation): good coverage with the freq profile + bad combos ─────────────
function baseStream() {
	const ev = [];
	const good = ( f0, f1, m ) => ev.push({ f0, f1, m, badness: 'good' });
	for ( let r = 0; r < 4; r++ ) { good('status', 'client', 'amount'); good('client', 'status', 'copies'); }
	good('priority', 'status', 'amount'); good('genre', 'client', 'copies');
	good('topic', 'status', 'amount'); good('status', 'priority', 'year');
	good('genre', 'topic', 'copies'); good('client', 'topic', 'year');
	// bad combos RECUR (×2): the wedge = L_bad − first-exposures needs repeated arrivals (A never brakes,
	// B refuses the repeat — Laurie 6's exact counts require L_bad > |distinct|). Half the badFilter events
	// carry a RARE good sort on the OTHER slot — the N2 wrong-blame channel needs a rare victim to flip onto
	// (a false-blame on a rare sort is indistinguishable from a true restriction — Laurie 3).
	for ( let r = 0; r < 2; r++ ) {
		for ( const f of FILTER_BAD ) { ev.push({ f0: f, f1: 'priority', m: 'amount', badness: 'badFilter', badSlot: 0 });
			ev.push({ f0: 'genre', f1: f, m: 'copies', badness: 'badFilter', badSlot: 1 }); }
		ev.push({ f0: 'status', f1: 'client', m: 'status', badness: 'badMetric' });
		ev.push({ f0: 'client', f1: 'status', m: 'client', badness: 'badMetric' });
	}
	return ev;
}
const PERMS = {
	dump: ( ev ) => ev.slice(),
	reversed: ( ev ) => ev.slice().reverse(),
	interleaved: ( ev ) => { const g = ev.filter(( e ) => e.badness === 'good'), b = ev.filter(( e ) => e.badness !== 'good'), out = [];
		for ( let i = 0; i < Math.max(g.length, b.length); i++ ) { if ( g[i] ) out.push(g[i]); if ( b[i] ) out.push(b[i]); } return out; },
};

// ── the ORACLE (authored world — the learner NEVER reads it, only the emitted atoms) ────────────────────
// N1: the FIRST stream-occurrence of each rare sort on a GOOD event false-fails, unlocalized (∝ 1/freq).
// N2: wrong-blame on ⌈ρ·nBadFilter⌉ badFilter events (deterministic prefix among those whose OTHER slot is
//     rare-sorted — the bias that makes false-blame look like a true restriction), atom flipped to that slot.
function oracle( stream, rho ) {
	const rareSeen = new Set();
	const flippable = stream.filter(( e ) => e.badness === 'badFilter' && RARE.has(e.badSlot === 0 ? e.f1 : e.f0) );
	const nFlip = Math.ceil(rho * stream.filter(( e ) => e.badness === 'badFilter' ).length);
	const flipped = new Set(flippable.slice(0, nFlip));
	return stream.map(( e ) => {
		if ( e.badness === 'good' ) {
			const rare = [e.f0, e.f1].find(( s ) => RARE.has(s) && !rareSeen.has(s) );
			[e.f0, e.f1].forEach(( s ) => RARE.has(s) && rareSeen.add(s) );
			if ( rare ) return { ...e, shallowOK: false, atoms: ['unlocalized'] };            // N1
			return { ...e, shallowOK: true, atoms: [] };
		}
		if ( e.badness === 'badFilter' ) {
			if ( flipped.has(e) ) return { ...e, shallowOK: true, atoms: ['slot' + (1 - e.badSlot)] };  // N2 wrong-blame
			return { ...e, shallowOK: true, atoms: ['slot' + e.badSlot] };   // the DIVERGENCE: shallow OK ∧ deep violated
		}
		return { ...e, shallowOK: false, atoms: ['metric'] };                 // badMetric: both agree it failed
	});
}

// ── one arm over one oracle-annotated stream ───────────────────────────────────────────────────────────
function runArm( L, events, policy ) {
	const learners = { slot0: slotLearner(L, policy.optim), slot1: slotLearner(L, policy.optim), metric: slotLearner(L, policy.optim) };
	const M = { overGen: 0, overNarrowGood: 0, extraMounts: 0, refusals: [], traj: [], blockedGoodEver: new Set() };
	const sortsOf = ( e ) => ({ slot0: e.f0, slot1: e.f1, metric: e.m });
	const goodFor = ( facet, sort ) => (facet === 'metric' ? METRIC_GOOD : FILTER_GOOD).includes(sort);
	for ( const e of events ) {
		const so = sortsOf(e);
		// ADMISSION during LEARNING: only a BLOCKED sort refuses (+ the optimism retry). `outside-S` is NOT a
		// refusal here — S is the learned ARTIFACT (the post-learning dispatch gate), not an in-stream filter;
		// gating on S would starve the learner of exactly the evidence that generalizes S (and would violate
		// Laurie 6's exact count "A over-gen = L_bad — A never brakes"). A REFUSED event emits NO atoms (the
		// learner reads mount outcomes only — Laurie 8c); its cost is the fallback (over-narrow when good).
		let refusedBy = null, retried = false;
		for ( const [f, l] of Object.entries(learners) ) {
			const a = l.admit(so[f]);
			if ( a.retry ) retried = true;
			if ( !a.ok && a.why !== 'outside-S' ) { refusedBy = f + ':' + a.why; break; }
		}
		if ( refusedBy ) { if ( e.badness === 'good' ) M.overNarrowGood++; M.refusals.push(refusedBy); continue; }
		if ( retried ) M.extraMounts++;
		if ( e.badness !== 'good' ) M.overGen++;
		// outcome processing per policy
		const localized = e.atoms.filter(( a ) => a !== 'unlocalized' );
		if ( policy.arm === 'A' ) {
			if ( e.shallowOK ) for ( const [f, l] of Object.entries(learners) ) l.positive(so[f]);
		} else if ( policy.arm === 'C' ) {
			if ( e.shallowOK && !e.atoms.length ) for ( const [f, l] of Object.entries(learners) ) l.positive(so[f]);
			else for ( const [f, l] of Object.entries(learners) ) { l.negative(so[f], 'any-failure'); if ( goodFor(f, so[f]) ) M.blockedGoodEver.add(so[f]); }
		} else {                                                              // B and D: blame-gate PRIMARY
			if ( localized.length ) for ( const a of localized ) { learners[a].negative(so[a], 'blame'); if ( goodFor(a, so[a]) ) M.blockedGoodEver.add(so[a]); }
			else if ( e.shallowOK && !e.atoms.length ) for ( const [f, l] of Object.entries(learners) ) l.positive(so[f]);
			// unlocalized failure → DISCARDED (neither positive nor negative)
		}
		M.traj.push({ f: learners.slot0.state().S, m: learners.metric.state().S });
	}
	M.final = { slot0: learners.slot0.state(), slot1: learners.slot1.state(), metric: learners.metric.state() };
	return M;
}

const ARMS = {
	A: { arm: 'A', optim: {} }, B: { arm: 'B', optim: {} },
	C: { arm: 'C', optim: {} }, D: { arm: 'D', optim: { optimismEvery: 3 } },
};

// ── drive: 2 lattices × 3 permutations × ρ∈{0,.1,.3} × 4 arms; pre-registered checks per cell ──────────
( function main() {
	const results = { cells: [], checks: [] };
	let allPass = true;
	const check = ( cell, name, cond, detail ) => { results.checks.push({ cell, name, pass: !!cond, detail });
		if ( !cond ) { allPass = false; console.log('    ✗ ' + name + ' — ' + detail); } };

	for ( const [lname, L] of Object.entries(LATS) )
	for ( const [pname, perm] of Object.entries(PERMS) )
	for ( const rho of [0, 0.1, 0.3] ) {
		const cell = `${lname}/${pname}/ρ=${rho}`;
		const events = oracle(perm(baseStream()), rho);
		const R = {};
		for ( const [an, pol] of Object.entries(ARMS) ) R[an] = runArm(L, events, pol);
		results.cells.push({ cell, arms: Object.fromEntries(Object.entries(R).map(( [k, v] ) => [k,
			{ overGen: v.overGen, overNarrowGood: v.overNarrowGood, extraMounts: v.extraMounts,
			  finalFilterS: v.final.slot0.S, finalMetricS: v.final.metric.S, blockedGood: [...v.blockedGoodEver].sort() }])) });

		// B's first-exposure bound: one unavoidable mount per distinct (facet × bad sort) + the flipped events
		// (a wrong-blame leaves the true bad sort unblocked once more).
		const nFacetSort = new Set(events.filter(( e ) => e.badness === 'badFilter' ).map(( e ) => 'slot' + e.badSlot + ':' + (e.badSlot === 0 ? e.f0 : e.f1))).size
			+ new Set(events.filter(( e ) => e.badness === 'badMetric' ).map(( e ) => e.m)).size;
		const nFlips = Math.ceil(rho * events.filter(( e ) => e.badness === 'badFilter' ).length);
		const nBadDistinct = nFacetSort + nFlips;
		console.log(`── ${cell}: A og=${R.A.overGen} B og=${R.B.overGen} C og=${R.C.overGen} D og=${R.D.overGen} · ` +
			`onGood A=${R.A.overNarrowGood} B=${R.B.overNarrowGood} C=${R.C.overNarrowGood} D=${R.D.overNarrowGood} (D extra=${R.D.extraMounts}) · ` +
			`S_filter A=${JSON.stringify(R.A.final.slot0.S)} B=${JSON.stringify(R.B.final.slot0.S)}`);

		// THE WEDGE (8a-dependent): A's LGG is lifted past the target by shallow FALSE-POSITIVES; B brakes.
		check(cell, 'wedge>0 (A overGen > B overGen)', R.A.overGen > R.B.overGen, `A=${R.A.overGen} B=${R.B.overGen}`);
		check(cell, 'B first-exposure bound (overGen ≤ distinct bad combos)', R.B.overGen <= nBadDistinct, `B=${R.B.overGen} ≤? ${nBadDistinct}`);
		// 8b: A CONVERGES — to the WRONG fixpoint (column) under false-positives; B holds the target.
		check(cell, 'A fixpoint = column (wrong, lifted)', JSON.stringify(R.A.final.slot0.S) === '["column"]', JSON.stringify(R.A.final.slot0.S));
		check(cell, 'B fixpoint = target cut', JSON.stringify(R.B.final.slot0.S) === JSON.stringify([TARGET.filter]), JSON.stringify(R.B.final.slot0.S));
		if ( rho === 0 ) {
			check(cell, 'ρ=0: B overNarrow-on-good == A (==0 beyond ignorance)', R.B.overNarrowGood === R.A.overNarrowGood, `A=${R.A.overNarrowGood} B=${R.B.overNarrowGood}`);
			check(cell, 'ρ=0: D pays insurance for nothing (cost ≥ B, extraMounts>0 possible)', R.D.overGen + R.D.extraMounts >= R.B.overGen, `D=${R.D.overGen}+${R.D.extraMounts} B=${R.B.overGen}`);
		}
		// C self-seals GOOD rare sorts (N1 rare-correlated unlocalized failures admitted as negatives)
		check(cell, 'C blocks good sorts (self-sealing) where B blocks none at ρ=0', rho > 0 || (R.C.blockedGoodEver.size > 0 && R.B.blockedGoodEver.size === 0),
			`C=${[...R.C.blockedGoodEver]} B=${[...R.B.blockedGoodEver]}`);
		if ( rho > 0 ) {
			// the B(ρ) degradation exists (wrong-blame seals a good rare sort) AND D recovers (unseal via retry+positive)
			check(cell, `ρ=${rho}: wrong-blame seals good sorts in B`, R.B.blockedGoodEver.size > 0, `B blockedGood=${[...R.B.blockedGoodEver]}`);
			check(cell, `ρ=${rho}: D ends with fewer sealed good sorts than B`, R.D.final.slot0.blocked.filter(( s ) => FILTER_GOOD.includes(s)).length
				<= R.B.final.slot0.blocked.filter(( s ) => FILTER_GOOD.includes(s)).length,
				`D=${R.D.final.slot0.blocked} B=${R.B.final.slot0.blocked}`);
		}
	}

	console.log('\n' + (allPass ? 'ALL PRE-REGISTERED CHECKS PASS (per-cell, never averaged)' : 'SOME CHECKS FAILED — see ✗ lines'));
	fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(results, null, 2));
	console.log('wrote RESULTS.json — cells: ' + results.cells.length + ', checks: ' + results.checks.length +
		', failed: ' + results.checks.filter(( c ) => !c.pass ).length);
	process.exit(allPass ? 0 : 1);
})();
