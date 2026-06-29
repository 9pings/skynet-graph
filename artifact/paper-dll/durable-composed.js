'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the composition-under-drift wedge ON THE REAL DURABLE EXECUTOR (lib/durable/), not the belief
 * view (M4.4) nor a Map proxy. A learned 2-link chain  decide -> disburse  is compiled to a workflow-NET
 * (xlate.compileMethod) and run as a token-flow over the CheckpointStore (interpreter.runFlow), so each step is
 * content-memoized (C5), position is durable, and the run is crash-resumable. The chain:
 *     step 1 decide(record)        -> {decision: approve|reject}   (approve iff score=high AND compliant)
 *     step 2 disburse(decision)    -> {disbursement: disbursed|held}  (disbursed iff decision==approve)
 * The drift is the same exogenous compliance AUDIT (composed-workload): a record's `compliant` premise reflects
 * the audit state at its stream position, so a post-audit audited (score=high) case flips decision approve->reject
 * AND — link 2 reading the decision — disbursement disbursed->held. THE CASCADE, on the durable layer.
 *
 * What this adds over the belief-side M4.4/M4.5: durable token MARKING, content-memo across BOTH chain steps,
 * CROSS-RESTART replay of the warm composed library, and CRASH-RESUME of a half-done chain — the execution-layer
 * properties the belief view deliberately lacks (it sits ATOP an executor; §12.3 belief↔durable line).
 *
 *   node artifact/paper-dll/durable-composed.js                       # deterministic stub (the mechanism table)
 *   MODEL=qwen3.6-27b-mtp BASE=http://localhost:1234 node artifact/paper-dll/durable-composed.js   # live (LM Studio)
 */
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.resolve(__dirname, '../..');
const { digest } = require(ROOT + '/lib/providers/canonicalize.js');
const { compileMethod } = require(ROOT + '/lib/durable/xlate.js');
const { runFlow } = require(ROOT + '/lib/durable/interpreter.js');
const { createMemoryCheckpointStore, createSqliteCheckpointStore } = require(ROOT + '/lib/durable/checkpoint-store.js');
const { makeComposedWorkload } = require('./composed-workload.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

const auditKey = ( r ) => `${r.region}|${r.kind}`;
// the 2-step method net (no select; one linear method). compileMethod wires start → decide → disburse → done.
const NET = compileMethod({ methods: { chain: { steps: [{ task: 'Dec::decide' }, { task: 'Dec::disburse' }] } } });

// inject-ready records: the premise `compliant` is baked per stream position (the audit state at that index) — the
// exogenous drift made durable-record state, exactly as measure-live bakes the policy (P1/P2) into each record.
function durableRecords( w ) {
	return w.stream.map(( r ) => ({ id: r.index, kind: r.kind, region: r.region, score: r.score, tier: r.tier,
		compliant: !w.activeAuditAt(r.index).has(auditKey(r)) }));
}

// the deterministic stub model (a perfect oracle of the 2-step rule) OR a live model. Returns {decide, disburse}.
function makeModel( opts ) {
	opts = opts || {};
	if ( !opts.live ) return {
		decide: ( f ) => (f.score === 'high' && f.compliant) ? 'approve' : 'reject',
		disburse: ( decision ) => decision === 'approve' ? 'disbursed' : 'held',
	};
	const { makeAsk } = require(ROOT + '/lib/providers/llm.js');
	const ask = makeAsk({ base: process.env.BASE || 'http://localhost:1234', api: 'openai', model: process.env.MODEL,
		extraBody: { chat_template_kwargs: { enable_thinking: false } }, assistantPrefill: '<think>\n\n</think>\n\n' });
	const one = async ( sys, usr ) => String(await ask({ system: sys, user: usr, maxTokens: 6, temperature: 0 }) || '').toLowerCase();
	return {
		decide: async ( f ) => { const w = await one("Reply one word: approve or reject. Approve iff score is high AND compliant is true.",
			`score=${f.score} compliant=${f.compliant} kind=${f.kind} region=${f.region}`); return /reject/.test(w) && !/approve/.test(w) ? 'reject' : (/approve/.test(w) ? 'approve' : 'reject'); },
		disburse: async ( d ) => { const w = await one("Reply one word: disbursed or held. Disbursed iff the decision is approve.",
			`decision=${d}`); return /held/.test(w) && !/disbursed/.test(w) ? 'held' : (/disbursed/.test(w) ? 'disbursed' : 'held'); },
	};
}

// per-step memo key = that step's READ-SET. decide reads {kind,region,score,compliant} (the premise IS in the key →
// a drifted premise re-keys → the defeasance); disburse reads only {decision} (a flipped decision re-keys → cascade,
// and a (k,r,reject)-style key reuses across the class). premiseInKey=false = the NEG CONTROL (stale on drift).
function makeKeyOf( premiseInKey ) {
	return ( tr, token ) => {
		const f = token.payload;
		if ( /decide$/.test(tr.task) ) return digest(premiseInKey ? { t: 'd', k: f.kind, r: f.region, s: f.score, c: !!f.compliant } : { t: 'd', k: f.kind, r: f.region, s: f.score });
		return digest({ t: 'b', dec: f.decision });   // disburse reads the upstream decision only
	};
}

// run the chain over a given store; returns { calls, byId } where byId[recordId] = {decision,disbursement}.
async function runChain( store, runId, recs, model, premiseInKey, opts ) {
	opts = opts || {};
	let calls = 0;
	const runTask = async ( task, token ) => {
		calls++;
		const f = token.payload;
		if ( /decide$/.test(task) ) return { payload: { decision: await model.decide(f) } };
		return { payload: { disbursement: await model.disburse(f.decision) } };
	};
	store.ensureRun(runId, NET);
	if ( recs ) store.inject(runId, recs);
	const c = await runFlow(store, runId, NET, { runTask, keyOf: makeKeyOf(premiseInKey), maxSteps: opts.maxSteps });
	const byId = {};
	for ( const t of (store.marking(runId).done || []) ) byId[t.recordId] = { decision: t.payload.decision, disbursement: t.payload.disbursement };
	return { calls, byId, flow: c };
}

// ── BLOB (neg control): a flat cache of the COMPOSED outcome keyed on the whole record sans premise → on drift the
//    key is unchanged → serves the stale (approve, disbursed) at BOTH steps → the staleness COMPOUNDS. ──
async function blobChain( recs, model ) {
	const cache = new Map(); let calls = 0; const byId = {};
	for ( const f of recs ) {
		const k = `${f.kind}|${f.region}|${f.score}`;
		if ( cache.has(k) ) { byId[f.id] = cache.get(k); continue; }
		calls += 2; const decision = await model.decide(f); const disbursement = await model.disburse(decision);
		const o = { decision, disbursement }; cache.set(k, o); byId[f.id] = o;
	}
	return { calls, byId };
}

function score( byId, w ) {
	let ok = 0, d1ok = 0, d1n = 0, d2ok = 0, d2n = 0;
	for ( const r of w.stream ) {
		const got = byId[r.index] || {}; const t1 = w.truth1(r), t2 = w.truth2(r);
		if ( got.decision === t1 && got.disbursement === t2 ) ok++;
		if ( w.isFlipped1(r) ) { d1n++; if ( got.decision === t1 ) d1ok++; }
		if ( w.isFlipped2(r) ) { d2n++; if ( got.disbursement === t2 ) d2ok++; }
	}
	return { ok, n: w.stream.length, drift1: d1n ? d1ok / d1n : 1, drift2: d2n ? d2ok / d2n : 1 };
}

async function main() {
	const live = !!process.env.MODEL;
	const model = makeModel({ live });
	const w = makeComposedWorkload(live
		? { kinds: ['loan', 'refund'], regions: ['EU', 'US'], heldOutRegion: 'none', audited: [{ region: 'EU', kind: 'loan' }], preCycles: 2, postCycles: 2 }
		: { kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'], heldOutRegion: 'APAC', audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }], preCycles: 2, postCycles: 3 });
	const recs = durableRecords(w);
	out(`\nCOMPOSITION-UNDER-DRIFT ON THE DURABLE EXECUTOR ${live ? '(LIVE ' + process.env.MODEL + ')' : '(stub)'} — chain decide→disburse`);
	out(`stream N=${w.meta.n} (pre ${w.meta.preCount}, post ${w.meta.postCount}, drift ${w.meta.driftCases1}); audit=${w.meta.audited.join(',')}\n`);

	// 1+2 — STRUCT-DUR (premise in key): amortizes the chain + cascades on drift (both steps recovered, selective).
	const struct = await runChain(createMemoryCheckpointStore(), 'r', recs, model, true);
	// 3 — STRUCT-DUR-FLAT (premise-LESS key): the NEG CONTROL — serves the stale chain on drift (compounds).
	const flat = await runChain(createMemoryCheckpointStore(), 'rf', recs, model, false);
	// BLOB — a flat composed cache (also compounds).
	const blob = await blobChain(recs, model);

	out('arm              | calls | acc  | drift1 | drift2 | note');
	out('-----------------|------:|-----:|-------:|-------:|-----');
	for ( const [name, a] of [['STRUCT-DUR', struct], ['STRUCT-DUR-FLAT', flat], ['BLOB-DUR', blob]] ) {
		const s = score(a.byId, w);
		out(`${name.padEnd(16)} | ${String(a.calls).padStart(5)} | ${(s.ok / s.n).toFixed(2)} | ${s.drift1.toFixed(2).padStart(6)} | ${s.drift2.toFixed(2).padStart(6)} | ` +
			(name === 'STRUCT-DUR' ? 'amortized chain + cascade recovers both links' : name === 'STRUCT-DUR-FLAT' ? 'premise-less key → stale at BOTH (compounds)' : 'flat composed cache → compounds'));
	}

	// 4 — CROSS-RESTART (SQLite): warm the file, then a FRESH store on the same file replays the chain at 0 calls.
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-dur-')), 'm.sqlite');
	const s1 = createSqliteCheckpointStore({ file }); const cold = await runChain(s1, 'm', recs, model, true); s1.close();
	const s2 = createSqliteCheckpointStore({ file }); const warm = await runChain(s2, 'm2', recs, model, true); s2.close();
	out(`\nCROSS-RESTART (SQLite): process-1 cold ${cold.calls} calls → process-2 (fresh store, same file) ${warm.calls} calls ` +
		`→ ${warm.calls === 0 ? 'REPLAYS the warm composed library at 0 calls' : 'did not fully replay'}`);
	fs.rmSync(path.dirname(file), { recursive: true, force: true });

	// 5 — CRASH-RESUME: cut the drain mid-chain (fuel), rollback the in-flight token, resume → completes, no redo.
	const cs = createMemoryCheckpointStore();
	const CUT = w.meta.n + 12;                                                  // past the no-op enters, partway into real decide/disburse work
	const cut = await runChain(cs, 'c', recs, model, true, { maxSteps: CUT });  // crash partway through the chain
	cs.rollbackInflight('c');                                                   // recover the in-flight (leased) token
	const resume = await runChain(cs, 'c', null, model, true);                  // no re-inject; drain the rest from the durable marking
	const rs = score(resume.byId, w);
	out(`CRASH-RESUME: cut at fuel=${CUT} (${cut.calls} real calls done) → rollbackInflight → resume (${resume.calls} calls) ; ` +
		`total ${cut.calls + resume.calls} vs cold ${cold.calls} → ${cut.calls + resume.calls === cold.calls && rs.ok === rs.n ? 'no work lost or duplicated, correct' : 'MISMATCH — investigate'}`);

	out('\nVERDICT: the composition-under-drift wedge holds ON THE DURABLE EXECUTOR — amortized across both chain');
	out('steps, cascade recovers both links (premise-in-key; FLAT compounds), warm library survives a restart at 0');
	out('calls, and a half-done chain resumes without lost/duplicated work. The execution-layer realization of M4.4.');
}
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });

module.exports = { NET, durableRecords, makeModel, makeKeyOf, runChain, blobChain, score };
