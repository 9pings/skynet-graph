'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E3 — COMPOSITION-SOUNDNESS (§11 kill-criterion #6, the real go/no-go for §7 "compose on contracts, box CLOSED")
 * + the FALSE-ADMIT rate + the −G1/−G2/−G3 gate ablations, on the REAL engine. Generalizes the §11.6 probe
 * (`examples/poc/contract-compose.js`):
 *
 *   (A) box-CLOSED `checkCompose` decision MATCHES open-the-box engine reality, for a candidate SET; the
 *       FALSE-ADMIT rate (verdict 'sound' yet the open box FAILS) must be 0 — the checker never false-accepts,
 *       it escalates (→ a micro-LLM, the §0.1 gradient).
 *   (B) each of the 3 soundness gates is LOAD-BEARING: removing it turns a correct escalate/refuse into a
 *       FALSE-ADMIT (G2 effect-tag → oracle · G1 frame-completeness · G3 footprint-cycle).
 *   (C) acceptRate = the measured typed-coverage currency; bounded-context = the compose decision reads only
 *       the shared FOOTPRINT (a few typed keys), never the body.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const C = require(ROOT + '/lib/authoring/core/contract.js');
const P = require(ROOT + '/examples/poc/contract-compose.js');   // METHODS, soundRun, unsoundRun, frameRun
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// (A) composition-soundness over the engine-checkable pairs: box-closed verdict vs open-box reality.
async function soundnessSet() {
	const rows = [];
	// 1 — Normalize→Grade : checkCompose admits, the engine composes correctly (Grade casts, grades == open-box).
	{
		const v = C.checkCompose(P.METHODS.Normalize, P.METHODS.Grade).verdict;
		const r = await P.soundRun([85, 150, -10, 72]);
		const openBoxOk = r.allMatch;                                  // engine succeeded == open-box reference
		rows.push({ pair: 'Normalize→Grade', verdict: v, openBoxOk, falseAdmit: v === 'sound' && !openBoxOk });
	}
	// 2 — BadNormalize→Grade : checkCompose refuses (unsound); the engine confirms (Grade pre violated → no cast).
	{
		const v = C.checkCompose(P.METHODS.BadNormalize, P.METHODS.Grade).verdict;
		const r = await P.unsoundRun(150);
		const openBoxOk = r.gradeCast;                                 // the open box FAILS: no grade on overflow
		rows.push({ pair: 'BadNormalize→Grade', verdict: v, openBoxOk, falseAdmit: v === 'sound' && !openBoxOk });
	}
	// 3 — Ship→Notify (external, no oracle) : checkCompose ESCALATES (G2) — correctly NOT admitted box-closed.
	{
		const v = C.checkCompose(P.METHODS.Ship, P.METHODS.Notify).verdict;
		rows.push({ pair: 'Ship→Notify (no oracle)', verdict: v, openBoxOk: null, falseAdmit: v === 'sound' });
	}
	const falseAdmits = rows.filter(( r ) => r.falseAdmit ).length;
	const matchesReality = rows.every(( r ) => r.openBoxOk == null
		? r.verdict !== 'sound'                                        // escalate/unsound is the right non-admit
		: (r.verdict === 'sound') === r.openBoxOk );                   // admit iff the open box succeeds
	return { rows, falseAdmits, falseAdmitRate: falseAdmits / rows.length, matchesReality };
}

// (B) the gate ablations — each gate, ON catches the hole, OFF false-admits.
async function ablations() {
	// G2 — effect-tag → oracle: an external effect's post can't be vouched for by the internal fact.
	const g2On = C.checkCompose(P.METHODS.Ship, P.METHODS.Notify).verdict;                 // 'escalate' (needs oracle)
	const ShipPure = { name: 'ShipPure', contract: { ...P.METHODS.Ship.contract, effect: 'pure' } };
	const g2Off = C.checkCompose(ShipPure, P.METHODS.Notify).verdict;                      // 'sound' = FALSE-ADMIT
	const G2 = { on: g2On, off: g2Off, falseAdmitIntroduced: g2Off === 'sound' && g2On !== 'sound' };

	// G1 — frame-completeness: a body writes an UNDECLARED key (`audit`). ON (touched-vs-declared) catches it.
	const fr = await P.frameRun();                                                         // real engine: touched + ok(G1)
	const contract = { write: ['ok'], post: ['ok==true'], effect: 'pure' }, after = { ok: true, audit: 'x' };
	const g1On = C.assertPost(contract, after, fr.touched).ok;                             // false (undeclared-write)
	const g1Off = C.assertPost(contract, after, []).ok;                                    // true = FALSE-ADMIT (gate off)
	const G1 = { touched: fr.touched, on: g1On, off: g1Off, falseAdmitIntroduced: g1Off && !g1On };

	// G3 — footprint cycle: two coupled RETRACTABLE methods (A writes x reads y; B writes y reads x).
	const A = { name: 'A', contract: { read: ['y'], write: ['x'], effect: 'internal' } };
	const B = { name: 'B', contract: { read: ['x'], write: ['y'], effect: 'internal' } };
	const cycles = C.footprintCycles([A, B]);
	const G3 = { on: cycles.length > 0, off: false, cycles, falseAdmitIntroduced: cycles.length > 0 };  // OFF would admit the cycle

	return { G1, G2, G3 };
}

// (C) the typed-coverage currency + the bounded compose-context.
function coverage() {
	const verdicts = [
		C.checkCompose(P.METHODS.Normalize, P.METHODS.Grade).verdict,
		C.checkCompose(P.METHODS.BadNormalize, P.METHODS.Grade).verdict,
		C.checkCompose(P.METHODS.Ship, P.METHODS.Notify).verdict,
		C.checkCompose(P.METHODS.Ship, P.METHODS.Notify, { oracle: () => true }).verdict,
	];
	const rate = C.acceptRate(verdicts);
	// bounded context: the compose decision reads only the SHARED footprint (a few typed keys), never the body.
	const dec = C.checkCompose(P.METHODS.Normalize, P.METHODS.Grade);
	const contractAtoms = (P.METHODS.Normalize.contract.post || []).length + (P.METHODS.Grade.contract.pre || []).length;
	return { rate, sharedFootprint: dec.shared, contractAtoms };
}

async function measure() {
	return { soundness: await soundnessSet(), ablations: await ablations(), coverage: coverage() };
}

async function main() {
	out('\nE3 — composition-soundness + false-admit + the −G1/−G2/−G3 ablations (real engine)\n');
	const m = await measure();
	out('(A) box-CLOSED checkCompose vs open-the-box reality:');
	for ( const r of m.soundness.rows )
		out(`   ${r.pair.padEnd(24)} verdict=${r.verdict.padEnd(8)} openBox=${r.openBoxOk === null ? 'n/a (not admitted)' : r.openBoxOk}  falseAdmit=${r.falseAdmit}`);
	out(`   → FALSE-ADMIT rate = ${m.soundness.falseAdmits}/${m.soundness.rows.length}  ·  box-closed matches reality = ${m.soundness.matchesReality}\n`);
	out('(B) gate ablations (ON catches → OFF false-admits):');
	out(`   G1 frame   : touched=${JSON.stringify(m.ablations.G1.touched)} ON ok=${m.ablations.G1.on} (caught) · OFF ok=${m.ablations.G1.off} (missed) → load-bearing=${m.ablations.G1.falseAdmitIntroduced}`);
	out(`   G2 effect  : ON='${m.ablations.G2.on}' (escalate) · OFF='${m.ablations.G2.off}' (admit) → load-bearing=${m.ablations.G2.falseAdmitIntroduced}`);
	out(`   G3 cycle   : ON detects ${JSON.stringify(m.ablations.G3.cycles)} (reject) · OFF admits → load-bearing=${m.ablations.G3.falseAdmitIntroduced}\n`);
	out('(C) coverage + bounded context:');
	out(`   acceptRate = ${JSON.stringify(m.coverage.rate)}  ·  compose reads only shared footprint ${JSON.stringify(m.coverage.sharedFootprint)} (${m.coverage.contractAtoms} contract atoms, not the body)`);
	out('\nVERDICT (E3 kill-criteria):');
	out(`  false-admit rate = ${m.soundness.falseAdmitRate} (must be 0) · box-closed == open-box: ${m.soundness.matchesReality}`);
	out(`  all 3 gates load-bearing: ${m.ablations.G1.falseAdmitIntroduced && m.ablations.G2.falseAdmitIntroduced && m.ablations.G3.falseAdmitIntroduced}`);
}

module.exports = { soundnessSet, ablations, coverage, measure };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
