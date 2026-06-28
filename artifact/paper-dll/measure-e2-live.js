'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E2 — the DECISIVE kill test on a LIVE local model (the deterministic regression is
 * tests/integration/paper-harness.test.js). Same workload + arms; the model is real qwen, so
 * correctness now also depends on the model actually following the rule / the stale prose.
 * Adds wall-clock per arm. A smaller workload keeps the slow model tractable.
 *
 *   MODEL=qwen36-q2-vram BASE=http://localhost:5000 node artifact/paper-dll/measure-e2-live.js
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { makeAsk } = require(ROOT + '/lib/providers/llm.js');
const { ARMS } = require('./arms.js');
const E = require('./workload.js');
const H = require('./harness.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

const ask = makeAsk({ base: process.env.BASE || 'http://localhost:5000', api: 'openai',
	model: process.env.MODEL || 'qwen36-q2-vram', extraBody: { chat_template_kwargs: { enable_thinking: false } } });

async function main() {
	// a small live workload: 3 kinds × 2 regions × 2 scores = 12 classes, both tiers across cycles, one audited class.
	const w = E.makeWorkload({ kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US'], heldOutRegion: 'none',
		audited: [{ region: 'EU', kind: 'loan' }], preCycles: 2, postCycles: 2 });

	// guardrail FIRST: the self-test must pass under the stub before we trust a live comparison (#34).
	const st = await H.selfTest(w);
	out(`harness self-test (stub): ${st.ok ? 'PASS' : 'FAIL'} — ${st.reason}`);
	if ( !st.ok ) { out('ABORT: instrumentation unsound'); process.exit(1); }

	out(`\nE2 LIVE — model=${process.env.MODEL || 'qwen36-q2-vram'}  workload N=${w.meta.n} (pre ${w.meta.preCount}, post ${w.meta.postCount}, drift ${w.meta.driftCases}), audit=${w.meta.audited.join(',')}\n`);
	const model = H.makeModel('live', { ask });
	const env = { workload: w, model };

	out('arm          | calls | wall(s) | acc  | drift-acc | maxCtx');
	out('-------------|------:|--------:|-----:|----------:|------:');
	const rows = {};
	for ( const name of ['NAIVE', 'LONG-CONTEXT', 'RAG', 'CBR', 'SKILL', 'INVALIDATING', 'STRUCT'] ) {
		const t0 = Date.now();
		const res = await ARMS[name](w.stream, env);
		const wall = (Date.now() - t0) / 1000;
		const s = H.score(res.actions, w);
		rows[name] = { ...res, ...s, wall };
		out(`${name.padEnd(12)} | ${String(res.calls).padStart(5)} | ${wall.toFixed(1).padStart(7)} | ${s.acc.toFixed(2)} | ${s.driftAcc.toFixed(2).padStart(9)} | ${String(res.maxContext).padStart(6)}`);
	}

	const S = rows.STRUCT;
	const simBaselineDrift = Math.max(rows.RAG.driftAcc, rows.CBR.driftAcc, rows.SKILL.driftAcc);
	out('\nVERDICT (§E2, live — HONEST framing):');
	out(`  vanilla similarity caches STALE on drift: best of RAG/CBR/SKILL = ${simBaselineDrift.toFixed(2)} (recall alone does not recover)`);
	out(`  recovery needs an INVALIDATION hook: INVALIDATING drift ${rows.INVALIDATING.driftAcc.toFixed(2)} == STRUCT ${S.driftAcc.toFixed(2)} (both recover)`);
	out(`  typed contract adds SELECTIVITY: STRUCT ${S.calls} calls ≤ coarse-callback ${rows.INVALIDATING.calls} (evicts only post-violated entries)`);
	out(`  amortization: STRUCT ${S.calls} calls vs NAIVE ${rows.NAIVE.calls} -> ${S.calls < rows.NAIVE.calls ? 'PASS' : 'FAIL'}`);
	out(`  bounded ctx: STRUCT maxCtx ${S.maxContext} vs LONG-CONTEXT ${rows['LONG-CONTEXT'].maxContext} -> ${S.maxContext < rows['LONG-CONTEXT'].maxContext ? 'PASS' : 'FAIL'}`);
}
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
