'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P4 — the K1-COVERAGE fraction (the reviewer's #1 attack, owned) + a 2nd domain + determinism.
 *
 * The honest ceiling (conception §0.1, paper §8): amortization is bounded by the K1-canonicalizable fraction —
 * only records whose decision premise is FULLY TYPED elide to a cached method; a record with an out-of-vocab /
 * prose decision-component needs a micro-LLM EVERY time. This rung MEASURES that fraction on a workload, shows
 * the amortization is a smooth GRADIENT in coverage (not a constant win), and shows SOUNDNESS holds at EVERY
 * coverage level (the non-K1 fraction degrades COST, never correctness — no cliff). The K1 classifier is the
 * REAL engine barrier: `canonicalize.canonValue(raw, {enum})` — a value that snaps is K1, a `miss` is non-K1.
 *
 * The decisive neg control: a GREEDY variant that amortizes BEYOND K1 (memoizes non-K1 records on their typed
 * key, ignoring the prose) becomes UNSOUND (collisions serve a wrong cached answer) — so the K1 ceiling is a
 * SOUNDNESS boundary, not a missed optimization.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { canonValue, digest } = require(ROOT + '/lib/providers/canonicalize.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// ── two typed domains ──────────────────────────────────────────────────────────────────────────────────────
const DOMAINS = {
	approval: {
		fields: { kind: ['loan', 'refund', 'wire'], region: ['EU', 'US'], score: ['high', 'low'] },
		typedRule( r ) { return r.score === 'high' ? 'approve' : 'reject'; },
		flip( a ) { return a === 'approve' ? 'reject' : 'approve'; },
	},
	triage: {
		fields: { topic: ['billing', 'outage', 'howto'], sev: ['low', 'high'] },
		typedRule( r ) { return r.sev === 'high' ? 'L2' : 'L1'; },
		flip( a ) { return a === 'L2' ? 'L1' : 'L2'; },
	},
};
// the ground truth: a CLEAN record follows the typed rule; a MESSY record carries a prose note that OVERRIDES
// (flips) it — a decision component only the LLM (reading the note) can resolve, never the typed key. So a clean
// and a messy record of the SAME typed class ALWAYS disagree → memoizing a messy record on its typed key is unsound.
for ( const d of Object.values(DOMAINS) ) d.truth = ( r ) => r.note ? d.flip(d.typedRule(r)) : d.typedRule(r);
// the model (stub): a PERFECT oracle — reads typed fields AND any prose note. Staleness/cost come from arm
// mechanism, not model error (same discipline as E2).
const oracle = ( domain, r ) => domain.truth(r);

// classes = the cartesian product of the typed fields (the K1 vocabulary).
function classesOf( domain ) {
	const keys = Object.keys(domain.fields);
	let acc = [{}];
	for ( const k of keys ) acc = acc.flatMap(( base ) => domain.fields[k].map(( v ) => ({ ...base, [k]: v })));
	return acc;
}

// a deterministic mixed stream: fraction p of records are CLEAN (typed, recurring across K classes); the rest
// are MESSY (same typed fields BUT a conflicting prose note — out-of-vocab decision component).
function makeStream( domain, p, n ) {
	const classes = classesOf(domain), recs = [];
	const cut = Math.round(p * 100);
	for ( let i = 0; i < n; i++ ) {
		const cls = classes[i % classes.length];
		if ( (i % 100) < cut ) recs.push({ id: i, ...cls });                          // CLEAN: typed only
		else recs.push({ id: i, ...cls, note: 'manual-override' });                   // MESSY: prose note flips the rule
	}
	return recs;
}

// the REAL K1 classifier: every typed field must snap to its enum (canonValue), and no prose decision-field.
function k1Classify( r, domain ) {
	const canon = {};
	for ( const f of Object.keys(domain.fields) ) {
		const c = canonValue(r[f], { enum: domain.fields[f] });
		if ( c.miss ) return { k1: false, key: null };
		canon[f] = c.value;
	}
	if ( r.note != null ) return { k1: false, key: null };                            // a prose note ⇒ non-K1
	return { k1: true, key: digest(canon) };
}

// STRUCT: memo K1 records on the canonical typed key; a non-K1 record is a micro-LLM EVERY time (the §0.1
// gradient). `greedy` = the neg control: also memoize non-K1 on the typed key (ignore the prose) → unsound.
function runArm( domain, recs, { greedy } ) {
	const memo = new Map(); let calls = 0, ok = 0, k1count = 0;
	for ( const r of recs ) {
		const c = k1Classify(r, domain); if ( c.k1 ) k1count++;
		const memoable = greedy ? true : c.k1;
		const key = c.key || (greedy ? digest(Object.fromEntries(Object.keys(domain.fields).map(( f ) => [f, r[f]]))) : null);
		let action;
		if ( memoable && key != null && memo.has(key) ) action = memo.get(key);
		else { calls++; action = oracle(domain, r); if ( memoable && key != null ) memo.set(key, action); }
		if ( action === domain.truth(r) ) ok++;
	}
	return { calls, acc: ok / recs.length, measuredCoverage: k1count / recs.length };
}

function runCoverage( domainName, p, n ) {
	const domain = DOMAINS[domainName], recs = makeStream(domain, p, n);
	const struct = runArm(domain, recs, { greedy: false });
	const greedy = runArm(domain, recs, { greedy: true });
	const naive = recs.length;
	return { p, measuredCoverage: struct.measuredCoverage, structCalls: struct.calls, naiveCalls: naive,
		amort: 1 - struct.calls / naive, structAcc: struct.acc, greedyAcc: greedy.acc };
}

function sweep( domainName, n ) {
	return [0, 0.25, 0.5, 0.75, 1].map(( p ) => runCoverage(domainName, p, n));
}

async function main() {
	out('\nP4 — K1-coverage fraction: amortization GRADIENT + sustained soundness (real canon barrier)\n');
	for ( const dn of ['approval', 'triage'] ) {
		out(`domain=${dn}  (N=200)`);
		out('  coverage(set) | measured K1 | STRUCT calls | amort | STRUCT acc | GREEDY acc (neg ctrl)');
		out('  --------------|-------------|--------------|-------|------------|----------------------');
		for ( const row of sweep(dn, 200) )
			out(`  ${(row.p * 100 + '%').padStart(12)} | ${(row.measuredCoverage * 100).toFixed(0).padStart(10)}% | ${String(row.structCalls).padStart(12)} | ${(row.amort * 100).toFixed(0).padStart(4)}% | ${row.structAcc.toFixed(2).padStart(10)} | ${row.greedyAcc.toFixed(2)}`);
		out('');
	}
	// determinism: re-run identical
	const a = JSON.stringify(sweep('approval', 200)), b = JSON.stringify(sweep('approval', 200));
	out(`determinism: two runs identical = ${a === b}`);
	out('\nVERDICT (P4):');
	const swA = sweep('approval', 200);
	const monotone = swA.every(( r, i ) => i === 0 || r.amort >= swA[i - 1].amort );
	const sound = swA.every(( r ) => r.structAcc === 1 );
	const greedyUnsound = swA.some(( r ) => r.greedyAcc < 1 );
	out(`  amortization is a GRADIENT in coverage (monotone): ${monotone}`);
	out(`  STRUCT SOUND at every coverage (no cliff): ${sound}`);
	out(`  amortizing BEYOND K1 (greedy) is UNSOUND → the ceiling is a soundness boundary: ${greedyUnsound}`);
	out(`  measured K1-coverage tracks the workload's typed fraction (own the number): ${swA.map(( r ) => (r.measuredCoverage * 100).toFixed(0) + '%').join(' ')}`);
}

module.exports = { DOMAINS, classesOf, makeStream, k1Classify, runArm, runCoverage, sweep };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
