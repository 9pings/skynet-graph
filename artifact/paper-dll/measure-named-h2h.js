'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * #10 — the head-to-head against the NAMED agent-memory systems (MemGPT / Reflexion / GraphRAG),
 * behind the same uniform `solve()` iface + harness as E2. Deterministic stub by default (the
 * mechanism table); add a live local model for wall-clock + real-model behavior:
 *
 *   node artifact/paper-dll/measure-named-h2h.js                       # deterministic stub
 *   MODEL=qwen36-q2-vram BASE=http://localhost:5000 node artifact/paper-dll/measure-named-h2h.js  # live
 *
 * The honest claim it measures: given its FAIREST shot every named system can recover correctness on
 * drift — but only STRUCT recovers via an IN-ENGINE, per-entry, declarative contract at zero extra
 * LLM cost and minimal bounded context, so STRUCT is the unique Pareto-optimal point on
 * (calls) × (correct-on-drift) × (per-call context). Each ⊘/↻ ablation is the negative control.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { ARMS } = require('./arms.js');
const { NAMED_ARMS, makeFeedback } = require('./named-arms.js');
const E = require('./workload.js');
const H = require('./harness.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

const ALL = Object.assign({}, ARMS, NAMED_ARMS);
// headline order (ablations grouped under their system); STRUCT last so the verdict reads against it.
const ORDER = ['NAIVE', 'LONG-CONTEXT', 'RAG', 'CBR', 'SKILL', 'INVALIDATING',
	'MEMGPT', 'MEMGPT-BLIND', 'REFLEXION', 'REFLEXION-BLIND', 'GRAPHRAG', 'GRAPHRAG-REINDEX', 'STRUCT'];

async function runArms( w, env, names ) {
	const rows = {};
	for ( const name of names ) {
		const t0 = Date.now();
		const res = await ALL[name](w.stream, env);
		const wall = (Date.now() - t0) / 1000;
		rows[name] = Object.assign({}, res, H.score(res.actions, w), { wall });
	}
	return rows;
}

async function main() {
	const live = !!process.env.MODEL;
	// stub: the full mechanism table (3 kinds × 3 regions, APAC held out, TWO audited classes). live: a
	// compact workload (qwen is slow; ~13 arms) — 2 kinds × 2 regions, ONE audited class — keeps it tractable.
	const cfg = live
		? { kinds: ['loan', 'refund'], regions: ['EU', 'US'], heldOutRegion: 'none', audited: [{ region: 'EU', kind: 'loan' }], preCycles: 2, postCycles: 2 }
		: { kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'], heldOutRegion: 'APAC', audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }], preCycles: 2, postCycles: 3 };
	const w = E.makeWorkload(cfg); w.feedback = makeFeedback(w);

	// GUARD FIRST (#34): the stub NAIVE must be perfect, else the instrumentation is unsound — abort.
	const st = await H.selfTest(w);
	out(`harness self-test (stub): ${st.ok ? 'PASS' : 'FAIL'} — ${st.reason}`);
	if ( !st.ok ) { out('ABORT: instrumentation unsound'); process.exit(1); }

	let model;
	if ( live ) {
		const { makeAsk } = require(ROOT + '/lib/providers/llm.js');
		const ask = makeAsk({ base: process.env.BASE || 'http://localhost:5000', api: 'openai',
			model: process.env.MODEL, extraBody: { chat_template_kwargs: { enable_thinking: false } } });
		model = H.makeModel('live', { ask });
	} else model = H.makeModel('stub');
	const env = { workload: w, model };

	out(`\n#10 HEAD-TO-HEAD ${live ? '(LIVE model=' + process.env.MODEL + ')' : '(deterministic stub)'} — ` +
		`workload N=${w.meta.n} (pre ${w.meta.preCount}, post ${w.meta.postCount}, drift ${w.meta.driftCases}), audit=${w.meta.audited.join(',')}\n`);

	const order = live ? ['NAIVE', 'CBR', 'INVALIDATING', 'MEMGPT', 'MEMGPT-BLIND', 'REFLEXION', 'REFLEXION-BLIND', 'GRAPHRAG', 'GRAPHRAG-REINDEX', 'STRUCT'] : ORDER;
	const rows = await runArms(w, env, order);
	out('arm              | calls |' + (live ? ' wall(s) |' : '') + '  acc | drift | maxCtx | low-calls correct-drift min-ctx');
	out('-----------------|------:|' + (live ? '--------:|' : '') + '-----:|------:|-------:|--------------------------------');
	const S = rows.STRUCT, N = w.meta.n;
	for ( const name of order ) {
		const r = rows[name];
		const lowCalls = r.calls < N, correct = Math.abs(r.driftAcc - 1) < 1e-9, minCtx = r.maxContext <= S.maxContext;
		out(`${name.padEnd(16)} | ${String(r.calls).padStart(5)} |` +
			(live ? ` ${r.wall.toFixed(1).padStart(7)} |` : '') +
			` ${r.acc.toFixed(2)} | ${r.driftAcc.toFixed(2).padStart(5)} | ${String(r.maxContext).padStart(6)} | ` +
			`${lowCalls ? '✓' : '✗'}         ${correct ? '✓' : '✗'}            ${minCtx ? '✓' : '✗'}`);
	}

	// ── the Pareto / uniqueness verdict: does any arm match-or-beat STRUCT on ALL THREE corners? ──
	out('\nVERDICT (#10) — STRUCT vs the named systems:');
	const dominators = order.filter(( name ) => name !== 'STRUCT' ).filter(( name ) => {
		const r = rows[name];
		return r.calls <= S.calls && Math.abs(r.driftAcc - 1) < 1e-9 && r.maxContext <= S.maxContext;
	});
	out(`  STRUCT: calls ${S.calls}, drift ${S.driftAcc.toFixed(2)}, maxCtx ${S.maxContext} (the reference point)`);
	out(`  arms that match-or-beat STRUCT on (calls ≤) ∧ (drift=1) ∧ (ctx ≤): ${dominators.length ? dominators.join(', ') : 'NONE'}`);
	out(`  ⇒ STRUCT is ${dominators.length ? 'NOT' : 'the UNIQUE'} Pareto-optimal point ${dominators.length ? '(FAIL)' : '(PASS)'}`);

	// per named system: recovery + its mechanism-specific tax (vs STRUCT). Negative controls in parentheses.
	const tax = ( name ) => {
		const r = rows[name];
		const dCalls = r.calls - S.calls, dCtx = r.maxContext - S.maxContext;
		return `drift ${r.driftAcc.toFixed(2)}, +${dCalls} calls, +${dCtx} ctx vs STRUCT`;
	};
	out('\n  MemGPT   ' + tax('MEMGPT')     + `   (blind ⊘: drift ${rows['MEMGPT-BLIND'].driftAcc.toFixed(2)} = stale → paging is load-bearing)`);
	out('  Reflexion ' + tax('REFLEXION')   + `   (blind ⊘: drift ${rows['REFLEXION-BLIND'].driftAcc.toFixed(2)} = stale → the failure signal is load-bearing)`);
	out('  GraphRAG ' + tax('GRAPHRAG')     + `   (re-index ↻: drift ${rows['GRAPHRAG-REINDEX'].driftAcc.toFixed(2)} at +${rows['GRAPHRAG-REINDEX'].calls - S.calls} calls → recovery needs a BATCH re-summary)`);

	// drift-tax in isolation (deterministic structural measure → stub run only): re-run on a NO-DRIFT twin
	// (audited=[]) → calls(drift) − calls(no-drift). Pinned by tests/integration/paper-named-systems.test.js.
	if ( !live ) {
		const w0 = E.makeWorkload({ kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'],
			heldOutRegion: 'APAC', audited: [], preCycles: 2, postCycles: 3 });
		w0.feedback = makeFeedback(w0);
		const rows0 = await runArms(w0, { workload: w0, model }, ['STRUCT', 'MEMGPT', 'REFLEXION', 'GRAPHRAG-REINDEX']);
		out('\n  recovery cost in isolation (drift-tax = calls on the drifting stream − calls on a no-drift twin):');
		for ( const name of ['STRUCT', 'MEMGPT', 'REFLEXION', 'GRAPHRAG-REINDEX'] )
			out(`    ${name.padEnd(16)} drift-tax = ${rows[name].calls - rows0[name].calls} model calls` +
				(name === 'STRUCT' ? '   (the contract re-check itself is in-engine = 0 model calls; this is only re-derivation of evicted entries)' : ''));
	}
}
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
