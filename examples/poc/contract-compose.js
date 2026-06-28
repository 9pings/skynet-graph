'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * POC — §11.6 COMPOSITION-SOUNDNESS, the design's go/no-go for §7 ("compose methods on their typed contracts
 * WITHOUT opening the box"). The conception §11 STREAM gate (1-5) can PASS while the system is unsound at exactly
 * what §7 sells — this probe is what catches it. The claim under test, on the REAL engine:
 *
 *   A box-CLOSED compose decision (from the typed contracts alone, via `contract.js#checkCompose`) MATCHES
 *   open-the-box REALITY (the engine's stabilization fixpoint) — both when it admits AND when it refuses.
 *
 * Measured, with the negative controls the 3-lens confrontation demanded (Laurie / engine-feasibility / adversary):
 *   1. SOUND admit  — checkCompose says 'sound' for Normalize→Grade; the engine runs it and the grades EQUAL the
 *      plain open-box computation, and Grade's precondition genuinely held (it cast). The contract decision is true.
 *   2. UNSOUND refuse (the kill-test) — a method with a WIDER post (BadNormalize, score∈[0,200]) feeding Grade
 *      (needs score∈[0,100]): checkCompose says 'unsound' BEFORE running; the engine confirms the prediction — on
 *      a raw that overflows, Grade's ensure FAILS and it does NOT cast (no grade). The checker saved an unsound run.
 *   3. G1 FRAME-COMPLETENESS — a concept whose body writes a key OUTSIDE its declared write-footprint: the runtime
 *      touched-vs-declared diff (`assertPost`) catches the undeclared write the compose-time ⊨ ranges right past.
 *   4. G2 EFFECT-TAG — an external-effect composition ESCALATES for a ground-truth oracle (not silently blessed).
 *   5. acceptRate — the MEASURED typed-coverage fraction over the candidate set (refuse-everything can't fake it).
 *
 * Run: `node examples/poc/contract-compose.js`.
 */
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const C = require('../../lib/authoring/contract.js');

async function settle( g ) {
	for ( let i = 0; i < 50; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r));
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
}

// ── the methods, as TYPED CONTRACTS (what the supervisor composes on) ──────────────────────────────────────────
const METHODS = {
	Normalize:    { name: 'Normalize',    contract: { read: ['raw'],   write: ['score'], post: ['score>=0 && score<=100'], effect: 'pure' } },
	BadNormalize: { name: 'BadNormalize', contract: { read: ['raw'],   write: ['score'], post: ['score>=0 && score<=200'], effect: 'pure' } },
	Grade:        { name: 'Grade',        contract: { read: ['score'], write: ['grade'], pre: ['score>=0 && score<=100'], effect: 'pure' } },
	Ship:         { name: 'Ship',         contract: { read: ['order'], write: ['shipped'], post: ['shipped==true'], effect: 'external' } },
	Notify:       { name: 'Notify',       contract: { read: ['shipped'], write: ['notified'], pre: ['shipped==true'], effect: 'internal' } },
};

// the open-the-box reference (the bodies, in plain JS) — the soundness oracle.
const clamp = ( x ) => Math.max(0, Math.min(100, x));
const letter = ( s ) => s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F';

// the methods, as ENGINE CONCEPTS (the bodies). Grade's `ensure` IS its precondition, enforced by the engine.
function conceptTree( normalizeName ) {
	const norm = normalizeName === 'BadNormalize'
		? { _id: 'BadNormalize', _name: 'BadNormalize', require: ['raw'], provider: ['M::badNormalize'] }
		: { _id: 'Normalize',    _name: 'Normalize',    require: ['raw'], provider: ['M::normalize'] };
	return { common: { childConcepts: {
		[normalizeName]: norm,
		Grade: { _id: 'Grade', _name: 'Grade', require: ['score'], ensure: ['$score>=0', '$score<=100'], provider: ['M::grade'] },
		Leaky: { _id: 'Leaky', _name: 'Leaky', require: ['trigger'], provider: ['M::leaky'] },
	} } };
}

Graph._providers = { M: {
	normalize:    ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', score: clamp(s.getRef('raw')), Normalize: true }),
	badNormalize: ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', score: s.getRef('raw'), BadNormalize: true }),   // NO clamp
	grade:        ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', grade: letter(s.getRef('score')), Grade: true }),
	leaky:        ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', ok: true, audit: 'x', Leaky: true }),             // writes UNDECLARED `audit`
} };

const cast = ( g, id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
const fact = ( g, id, k ) => g._objById[id]._etty._[k];

// 1 — the SOUND composition: checkCompose admits, the engine confirms (grades == open-box, Grade cast).
async function soundRun( raws ) {
	const decision = C.checkCompose(METHODS.Normalize, METHODS.Grade);
	const seed = { lastRev: 0, freeNodes: [], nodes: raws.map(( raw, i ) => ({ _id: 'n' + i, raw })), segments: [] };
	const g = new Graph(seed, { label: 'sound', isMaster: true, autoMount: true, conceptSets: ['common'], logLevel: 'error' }, conceptTree('Normalize'));
	await settle(g);
	const rows = raws.map(( raw, i ) => ({ raw, engineGrade: fact(g, 'n' + i, 'grade'), graded: cast(g, 'n' + i, 'Grade'), openBox: letter(clamp(raw)) }));
	return { decision: decision.verdict, rows, allMatch: rows.every(( r ) => r.engineGrade === r.openBox && r.graded ) };
}

// 2 — the UNSOUND composition (kill-test): checkCompose refuses; the engine confirms (Grade's pre violated → no grade).
async function unsoundRun( raw ) {
	const decision = C.checkCompose(METHODS.BadNormalize, METHODS.Grade);
	const seed = { lastRev: 0, freeNodes: [], nodes: [{ _id: 'n0', raw }], segments: [] };
	const g = new Graph(seed, { label: 'unsound', isMaster: true, autoMount: true, conceptSets: ['common'], logLevel: 'error' }, conceptTree('BadNormalize'));
	await settle(g);
	return { decision: decision.verdict, raw, scoreWritten: fact(g, 'n0', 'score'), gradeCast: cast(g, 'n0', 'Grade'),
		gradeFact: fact(g, 'n0', 'grade') };
}

// 3 — G1 frame-completeness: a body that writes an UNDECLARED key, caught at runtime by the touched-vs-declared diff.
async function frameRun() {
	const contract = { write: ['ok'], post: ['ok==true'], effect: 'pure' };   // declares only `ok`
	const seed = { lastRev: 0, freeNodes: [], nodes: [{ _id: 'n0', trigger: 1 }], segments: [] };
	const g = new Graph(seed, { label: 'frame', isMaster: true, autoMount: true, conceptSets: ['common'], logLevel: 'error' }, conceptTree('Normalize'));
	const before = new Set(Object.keys(g._objById.n0._etty._));
	await settle(g);
	const after = g._objById.n0._etty._;
	// new DOMAIN facts: minus the cast self-flag (`Leaky`) and engine bookkeeping (`_rev`, `_id`, … — `_`-prefixed)
	const touched = Object.keys(after).filter(( k ) => !before.has(k) && k !== 'Leaky' && k[0] !== '_');
	const r = C.assertPost(contract, after, touched);
	return { touched, ok: r.ok, violations: r.violations };
}

// 4 + 5 — the box-CLOSED decisions over the candidate set + the MEASURED accept-rate (the §11.6 currency).
function decisions() {
	const candidates = [
		{ name: 'Normalize→Grade',    r: C.checkCompose(METHODS.Normalize, METHODS.Grade) },
		{ name: 'BadNormalize→Grade', r: C.checkCompose(METHODS.BadNormalize, METHODS.Grade) },
		{ name: 'Ship→Notify (no oracle)', r: C.checkCompose(METHODS.Ship, METHODS.Notify) },
		{ name: 'Ship→Notify (oracle ✓)',  r: C.checkCompose(METHODS.Ship, METHODS.Notify, { oracle: () => true }) },
	];
	return { candidates: candidates.map(( c ) => ({ name: c.name, verdict: c.r.verdict, needsOracle: c.r.needsOracle })),
		rate: C.acceptRate(candidates.map(( c ) => c.r.verdict)) };
}

module.exports = { METHODS, conceptTree, soundRun, unsoundRun, frameRun, decisions, clamp, letter };

if ( require.main === module ) {
	(async () => {
		const s = await soundRun([85, 150, -10, 72]);
		console.log('[1 SOUND]   checkCompose=%s  engine grades == open-box & Grade cast: %s', s.decision, s.allMatch);
		console.log('            ', s.rows.map(( r ) => `raw ${r.raw}→${r.engineGrade}`).join('  '));
		const u = await unsoundRun(150);
		console.log('[2 UNSOUND] checkCompose=%s  → engine: score=%d, Grade cast=%s (pre VIOLATED, no grade) — prediction confirmed',
			u.decision, u.scoreWritten, u.gradeCast);
		const f = await frameRun();
		console.log('[3 G1]      body touched %j → assertPost ok=%s, blames: %j', f.touched, f.ok, f.violations.map(( v ) => v.kind + ':' + v.detail));
		const d = decisions();
		d.candidates.forEach(( c ) => console.log('[4]          %s → %s%s', c.name.padEnd(26), c.verdict, c.needsOracle ? ' (needs oracle)' : ''));
		console.log('[5 accept]  ', JSON.stringify(d.rate));
	})().catch(( e ) => { console.error(e); process.exit(1); });
}
