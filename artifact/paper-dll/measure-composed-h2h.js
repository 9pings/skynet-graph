'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the COMPOSED head-to-head. The single-link #10 (measure-named-h2h.js) showed STRUCT is the
 * unique Pareto point for ONE method; this measures what happens across a learned METHOD CHAIN decide ->
 * disburse, where an upstream drift CASCADES. Deterministic stub by default; live with a local model:
 *
 *   node artifact/paper-dll/measure-composed-h2h.js                       # deterministic stub
 *   MODEL=qwen36-q2-vram BASE=http://localhost:5000 node artifact/paper-dll/measure-composed-h2h.js   # live
 *
 * The honest claim it measures: across a chain, STRUCT recovers BOTH links selectively (the JTMS cascade,
 * contract re-check in-engine = 0 model calls) while every surface/coarse memory either lets staleness
 * COMPOUND (stale link 1 -> stale link 2) or pays its mechanism tax AGAIN at each link. STRUCT-2 is the
 * unique Pareto-optimal point on (calls) × (drift1=1) × (drift2=1) × (per-call ctx); STRUCT-REAL-2 (the
 * actual engine) reproduces it (the proxy is faithful for the composed measure too).
 */
const path = require('path');
const { COMPOSED_SURFACE_ARMS } = require('./composed-arms.js');
const { COMPOSED_NAMED_ARMS, makeFeedback } = require('./composed-named-arms.js');
const { STRUCT_REAL2_ARMS } = require('./struct-real-composed.js');
const { pool } = require('./arms.js');
const W = require('./composed-workload.js');
const H = require('./composed-harness.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

const ALL = Object.assign({}, COMPOSED_SURFACE_ARMS, COMPOSED_NAMED_ARMS, STRUCT_REAL2_ARMS);

// CONCURRENT_ARMS=N fans the independent arms across a PARALLEL llm server (N in flight). The STRUCT-REAL* engine
// arms mutate the GLOBAL Graph._providers → run them SEQUENTIALLY; pool only the pure Map arms. calls/drift/ctx are
// concurrency-invariant (deterministic counts); per-arm `wall` is CONTENDED under the pool (the headline is the
// TOTAL wall printed by main) — for a clean per-arm wall, run with CONCURRENT_ARMS unset (sequential).
async function runArms( w, env, names ) {
	const conc = parseInt(process.env.CONCURRENT_ARMS || '1', 10);
	const rows = {};
	const runOne = async ( name ) => {
		const t0 = Date.now();
		const res = await ALL[name](w.stream, env);
		rows[name] = Object.assign({}, res, H.score(res, w), { wall: (Date.now() - t0) / 1000 });
	};
	if ( conc > 1 ) {
		const seq = names.filter(( n ) => /^STRUCT-REAL/.test(n) );          // global Graph._providers → sequential
		await pool(names.filter(( n ) => !/^STRUCT-REAL/.test(n) ), runOne, conc);
		for ( const n of seq ) await runOne(n);
	} else for ( const n of names ) await runOne(n);
	return rows;
}

async function main() {
	const live = !!process.env.MODEL;
	const cfg = live
		? { kinds: ['loan', 'refund'], regions: ['EU', 'US'], heldOutRegion: 'none', audited: [{ region: 'EU', kind: 'loan' }], preCycles: 2, postCycles: 2 }
		: { kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'], heldOutRegion: 'APAC', audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }], preCycles: 2, postCycles: 3 };
	const w = W.makeComposedWorkload(cfg); w.feedback = makeFeedback(w);

	// GUARD FIRST (#34): composed NAIVE perfect on BOTH links under the stub, else abort.
	const st = await H.selfTest(w, COMPOSED_SURFACE_ARMS['NAIVE-2']);
	out(`harness self-test (stub): ${st.ok ? 'PASS' : 'FAIL'} — ${st.reason}`);
	if ( !st.ok ) { out('ABORT: instrumentation unsound'); process.exit(1); }

	let model;
	if ( live ) {
		const { makeAsk } = require(path.resolve(__dirname, '../..') + '/lib/providers/llm.js');
		// assistantPrefill = the no-think method that WORKS on LM Studio + Qwen3.x (the chat_template_kwargs path is
		// a no-op there); the server returns only the continuation. Default endpoint = LM Studio (localhost:1234).
		const ask = makeAsk({ base: process.env.BASE || 'http://localhost:1234', api: 'openai',
			model: process.env.MODEL, extraBody: { chat_template_kwargs: { enable_thinking: false } },
			assistantPrefill: '<think>\n\n</think>\n\n' });
		model = H.makeModel('live', { ask });
	} else model = H.makeModel('stub');
	const env = { workload: w, model };

	out(`\nCOMPOSED HEAD-TO-HEAD ${live ? '(LIVE model=' + process.env.MODEL + ')' : '(deterministic stub)'} — ` +
		`chain decide->disburse, N=${w.meta.n} (pre ${w.meta.preCount}, post ${w.meta.postCount}, drift1 ${w.meta.driftCases1}, drift2 ${w.meta.driftCases2}), audit=${w.meta.audited.join(',')}\n`);

	const order = live
		? ['NAIVE-2', 'CBR-2', 'MEMGPT-2', 'MEMGPT-2-BLIND', 'REFLEXION-2', 'REFLEXION-2-BLIND', 'GRAPHRAG-2', 'GRAPHRAG-2-REINDEX', 'STRUCT-2', 'STRUCT-REAL-2']
		: ['NAIVE-2', 'CBR-2', 'MEMGPT-2', 'MEMGPT-2-BLIND', 'REFLEXION-2', 'REFLEXION-2-BLIND', 'GRAPHRAG-2', 'GRAPHRAG-2-REINDEX', 'STRUCT-2', 'STRUCT-REAL-2'];
	const conc = parseInt(process.env.CONCURRENT_ARMS || '1', 10);
	const tAll = Date.now();
	const rows = await runArms(w, env, order);
	const totalWall = (Date.now() - tAll) / 1000;
	if ( live ) out(`(arms run ${conc > 1 ? conc + '-way concurrent — per-arm wall is CONTENDED; headline = total' : 'sequentially'}; TOTAL wall ${totalWall.toFixed(1)}s)\n`);
	const S = rows['STRUCT-2'];
	out('arm                | calls |' + (live ? ' wall(s) |' : '') + ' drift1 | drift2 | maxCtx | low-calls drift1=1 drift2=1 min-ctx');
	out('-------------------|------:|' + (live ? '--------:|' : '') + '-------:|-------:|-------:|-----------------------------------');
	const N = w.meta.n;
	for ( const name of order ) {
		const r = rows[name];
		const lowCalls = r.calls < 2 * N, d1 = Math.abs(r.driftAcc1 - 1) < 1e-9, d2 = Math.abs(r.driftAcc2 - 1) < 1e-9, minCtx = r.maxContext <= S.maxContext;
		out(`${name.padEnd(18)} | ${String(r.calls).padStart(5)} |` +
			(live ? ` ${r.wall.toFixed(1).padStart(7)} |` : '') +
			` ${r.driftAcc1.toFixed(2).padStart(6)} | ${r.driftAcc2.toFixed(2).padStart(6)} | ${String(r.maxContext).padStart(6)} | ` +
			`${lowCalls ? '✓' : '✗'}        ${d1 ? '✓' : '✗'}       ${d2 ? '✓' : '✗'}       ${minCtx ? '✓' : '✗'}`);
	}

	// ── the Pareto / uniqueness verdict over the CHAIN: any arm match-or-beat STRUCT-2 on ALL FOUR corners? ──
	out('\nVERDICT (composed) — STRUCT-2 vs the named systems across the chain:');
	const dominators = order.filter(( name ) => !name.startsWith('STRUCT') ).filter(( name ) => {
		const r = rows[name];
		return r.calls <= S.calls && Math.abs(r.driftAcc1 - 1) < 1e-9 && Math.abs(r.driftAcc2 - 1) < 1e-9 && r.maxContext <= S.maxContext;
	});
	out(`  STRUCT-2: calls ${S.calls}, drift1 ${S.driftAcc1.toFixed(2)}, drift2 ${S.driftAcc2.toFixed(2)}, maxCtx ${S.maxContext} (the reference point)`);
	out(`  arms that match-or-beat STRUCT-2 on (calls ≤) ∧ (drift1=1) ∧ (drift2=1) ∧ (ctx ≤): ${dominators.length ? dominators.join(', ') : 'NONE'}`);
	out(`  ⇒ STRUCT-2 is ${dominators.length ? 'NOT' : 'the UNIQUE'} Pareto-optimal point ${dominators.length ? '(FAIL)' : '(PASS)'}`);
	if ( rows['STRUCT-REAL-2'] ) {
		const R = rows['STRUCT-REAL-2'];
		const same = R.calls === S.calls && Math.abs(R.driftAcc1 - S.driftAcc1) < 1e-9 && Math.abs(R.driftAcc2 - S.driftAcc2) < 1e-9;
		out(`  STRUCT-REAL-2 (the ACTUAL engine): calls ${R.calls}, drift1 ${R.driftAcc1.toFixed(2)}, drift2 ${R.driftAcc2.toFixed(2)}, maxCtx ${R.maxContext} ` +
			`→ ${same ? 'REPRODUCES STRUCT-2 (the proxy is faithful for the composed measure too)' : 'DIVERGES from STRUCT-2 — investigate'}`);
	}

	// ── COMPOUNDED STALENESS: how staleness propagates link-to-link for the surface/blind arms ──
	out('\n  COMPOUNDED STALENESS (drift1 -> drift2; a surface memory stale at link 1 stays stale at link 2):');
	for ( const name of ['CBR-2', 'MEMGPT-2-BLIND', 'REFLEXION-2-BLIND', 'GRAPHRAG-2'] ) {
		const r = rows[name];
		out(`    ${name.padEnd(18)} drift1 ${r.driftAcc1.toFixed(2)} -> drift2 ${r.driftAcc2.toFixed(2)}   ` +
			`${r.driftAcc1 < 1 && r.driftAcc2 < 1 ? '(compounds: wrong at BOTH links)' : ''}`);
	}

	// ── per named system: recovery + its mechanism tax (vs STRUCT-2), and how it MULTIPLIES down the chain ──
	const tax = ( name ) => { const r = rows[name]; return `drift1 ${r.driftAcc1.toFixed(2)}, drift2 ${r.driftAcc2.toFixed(2)}, +${r.calls - S.calls} calls, +${r.maxContext - S.maxContext} ctx vs STRUCT-2`; };
	out('\n  MemGPT-2    ' + tax('MEMGPT-2')   + `   (blind ⊘: drift2 ${rows['MEMGPT-2-BLIND'].driftAcc2.toFixed(2)} = compounds)`);
	out('  Reflexion-2 ' + tax('REFLEXION-2') + `   (blind ⊘: drift2 ${rows['REFLEXION-2-BLIND'].driftAcc2.toFixed(2)} = compounds; calls ~2N = per-record per-link)`);
	out('  GraphRAG-2  ' + tax('GRAPHRAG-2')  + `   (re-index ↻: drift2 ${rows['GRAPHRAG-2-REINDEX'].driftAcc2.toFixed(2)} at +${rows['GRAPHRAG-2-REINDEX'].calls - S.calls} calls = batch re-summary ×links)`);

	// drift-tax PER LINK in isolation (deterministic; stub only): calls on the drifting stream − calls on a no-drift twin.
	if ( !live ) {
		const w0 = W.makeComposedWorkload({ kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'],
			heldOutRegion: 'APAC', audited: [], preCycles: 2, postCycles: 3 });
		w0.feedback = makeFeedback(w0);
		const probe = ['STRUCT-2', 'MEMGPT-2', 'REFLEXION-2', 'GRAPHRAG-2-REINDEX'];
		const rows0 = await runArms(w0, { workload: w0, model }, probe);
		out('\n  recovery cost in isolation (drift-tax = calls on the drifting stream − calls on a no-drift twin):');
		for ( const name of probe )
			out(`    ${name.padEnd(18)} drift-tax = ${rows[name].calls - rows0[name].calls} model calls` +
				(name === 'STRUCT-2' ? '   (= re-derive ONLY the violated chain reject+held; the contract re-check is in-engine = 0 calls)' : ''));
	}
}
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
