'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E1 — AMORTIZATION + cross-problem STRUCTURAL TRANSFER over a HELD-OUT RELATED set, with the −F6 ablation.
 *
 * The defeasance pillar (E2) measured FACT-payload methods (classify -> a label). This rung measures the
 * other pillar: STRUCTURAL methods (a decomposition that CREATES a sub-graph with ids). Finding #30: a
 * structural template bakes ABSOLUTE ids, so a flat content cache cannot transfer it to a related-but-
 * different problem (it replays the wrong id-space). F6 (`abstract.js#methodTransform` = relativize-on-store /
 * bind-on-replay, keyed on the TYPED K1 signature) makes transfer sound + free. This generalizes the proven
 * `2026-06-27-f6-abstractivation/F6-transfer.js` to a held-out SET so we can report a TRANSFER RATE.
 *
 * Split (each problem in its OWN id-space = genuine cross-problem):
 *   TRAIN          : X→Y , P→Q              (cold; warm the library)
 *   HELD-OUT RELATED : X→Y , P→Q (new ids)  (the transfer target — same typed transitions, unseen instances)
 *   HELD-OUT NOVEL : M→N                     (the NEGATIVE CONTROL — unseen transition, must pay, no false replay)
 *
 * three modes: none (baseline, all pay) · flat (−F6 ablation: related is UNSOUND, #30 live) · F6 (related
 * transfers at 0 calls, sound). The engine (Graph + stabilization + abstract.js + cache.js) is REAL; the model
 * is the counting stub (transfer is an engine-mechanism, deterministic — E2 already proved live-currency amort).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const F6 = require('./F6-transfer.js');   // conceptTree, countingPlan, sigKey, transform, seedFor, runProblem
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// prefix-robust soundness inspector (F6-transfer's is hard-coded to single-char A/B/C prefixes).
function inspect( g, p ) {
	const S = p.pfx + 'S', G = p.pfx + 'G', R = p.pfx + 'root';
	const mid = g.getEtty(R + '_m0'), a0 = g.getEtty(R + '_a0'), b0 = g.getEtty(R + '_b0');
	const decomposed = !!(mid && a0 && b0);
	if ( !decomposed ) return { decomposed: false, sound: false, created: [] };
	const wiredOk = a0._.originNode === S && a0._.targetNode === R + '_m0'
		&& b0._.originNode === R + '_m0' && b0._.targetNode === G;
	const endpoints = [a0._.originNode, a0._.targetNode, b0._.originNode, b0._.targetNode];
	const created = Object.keys(g._objById).filter(( id ) => /_(m|a|b)\d/.test(id));
	// SOUND iff every created id + every wiring endpoint lives in THIS problem's id-space (no foreign prefix).
	const noForeign = created.every(( id ) => id.indexOf(p.pfx) === 0 ) && endpoints.every(( v ) => typeof v === 'string' && v.indexOf(p.pfx) === 0 );
	return { decomposed, sound: wiredOk && noForeign, created, interKind: mid._.kind };
}

async function runMode( label, problems, makeProviders ) {
	const plan = F6.countingPlan();
	const providers = makeProviders(plan);
	const rows = [];
	for ( const p of problems ) {
		const before = plan.n.calls;
		const { graph, crashed } = await F6.runProblem(p, providers);
		const cost = plan.n.calls - before;
		const ins = crashed ? { decomposed: false, sound: false, created: [] } : inspect(graph, p);
		rows.push({ pfx: p.pfx, role: p.role, cost, crashed: !!crashed, sound: ins.sound });
	}
	return { label, rows, calls: plan.n.calls };
}

function buildProblems() {
	return [
		{ pfx: 'TrXY', role: 'train', fromKind: 'X', toKind: 'Y', from: 'x', to: 'y' },
		{ pfx: 'TrPQ', role: 'train', fromKind: 'P', toKind: 'Q', from: 'p', to: 'q' },
		{ pfx: 'HoXY', role: 'related', fromKind: 'X', toKind: 'Y', from: 'x2', to: 'y2' },   // held-out, same transition
		{ pfx: 'HoPQ', role: 'related', fromKind: 'P', toKind: 'Q', from: 'p2', to: 'q2' },   // held-out, same transition
		{ pfx: 'HoMN', role: 'novel', fromKind: 'M', toKind: 'N', from: 'm', to: 'n' },       // held-out, NOVEL (neg ctrl)
	];
}

async function measure() {
	const problems = buildProblems();
	const { createProviderCache } = require(ROOT + '/lib/providers/cache.js');
	const none = await runMode('none', problems, ( plan ) => ({ P: { plan: plan.plan } }));
	const flat = await runMode('flat', problems, ( plan ) => {
		const c = createProviderCache();
		return { P: c.wrapFragment({ P: { plan: plan.plan } }, { 'P::plan': F6.sigKey }).P };
	});
	const f6 = await runMode('F6', problems, ( plan ) => {
		const c = createProviderCache();
		return { P: c.wrapFragment({ P: { plan: plan.plan } }, { 'P::plan': F6.sigKey }, { 'P::plan': F6.transform }).P };
	});

	const related = ( m ) => m.rows.filter(( r ) => r.role === 'related' );
	const novel = ( m ) => m.rows.filter(( r ) => r.role === 'novel' );
	const transferRate = ( m ) => { const rs = related(m); return rs.filter(( r ) => r.cost === 0 && r.sound ).length / rs.length; };
	return { none, flat, f6, related, novel, transferRate, n: problems.length };
}

async function main() {
	out('\nE1 — STRUCTURAL transfer over a held-out related set + the −F6 ablation (real engine)\n');
	const r = await measure();
	for ( const m of [r.none, r.flat, r.f6] ) {
		out(`mode ${m.label.padEnd(4)} (total ${m.calls} model-calls):`);
		for ( const row of m.rows )
			out(`   ${row.pfx.padEnd(5)} [${row.role.padEnd(7)}]  ${row.cost} call(s)  ${row.crashed ? 'CRASH' : (row.sound ? 'sound' : (row.cost === 0 ? 'UNSOUND-replay' : 'derived'))}`);
		out('');
	}
	out('VERDICT (E1 kill-criteria):');
	out(`  transfer rate on HELD-OUT RELATED: none ${(r.transferRate(r.none) * 100).toFixed(0)}% · flat ${(r.transferRate(r.flat) * 100).toFixed(0)}% · F6 ${(r.transferRate(r.f6) * 100).toFixed(0)}%  (kill if F6 < 30%)`);
	out(`  amortization: F6 ${r.f6.calls} calls vs none ${r.none.calls} (${r.none.calls - r.f6.calls} elided)`);
	out(`  −F6 ablation reproduces #30: flat related sound = ${r.related(r.flat).every(( x ) => x.sound )} (must be false)`);
	out(`  neg control (novel pays, no false replay): F6 novel cost = ${r.novel(r.f6).map(( x ) => x.cost).join(',')} (must be ≥1)`);
}

module.exports = { inspect, runMode, buildProblems, measure };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
