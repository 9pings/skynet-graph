'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P1a — the shared harness: the model (deterministic STUB | live qwen), prompt construction +
 * per-call-context measurement, the campaign runner, scoring (overall + correct-on-drift + max
 * per-call context), and the HARNESS SELF-TEST (the #34 guard: a deterministic instrumentation
 * check that fails loudly if the oracle/scoring/wiring is broken — i.e. it would have caught the
 * live 0/24 "everything wrong but calls/wall right" store bug before any conclusion was drawn).
 */
const path = require('path');
const { ARMS, auditKey } = require('./arms.js');

// ── prompt construction (shared by stub + live so per-call CONTEXT is measured identically) ──
function buildPrompt( promptObj ) {
	const r = promptObj.record;
	let user = `decide kind=${r.kind} region=${r.region} tier=${r.tier} score=${r.score}`;
	const aud = promptObj.knownAudited;
	if ( aud && aud.size ) user += `\nnon-compliant=[${[...aud].join(',')}]`;
	if ( promptObj.skillText ) user += `\nskill="${promptObj.skillText}"`;
	if ( promptObj.history && promptObj.history.length )
		user += `\nhistory:\n` + promptObj.history.map(( h ) => `${h.record.kind}/${h.record.region}/${h.record.score}->${h.action}`).join('\n');
	const system = "You decide 'approve' or 'reject'. If a skill is given, follow it. Otherwise approve iff score is high AND the (region,kind) is NOT in non-compliant; else reject. Reply with only one word: approve or reject.";
	return { system, user, len: system.length + user.length };
}

// the deterministic oracle of the CURRENT rule, given ONLY what the prompt tells it.
function oracle( promptObj ) {
	if ( promptObj.forcedAction != null ) return promptObj.forcedAction;     // skill apply -> reproduce the snapshot
	const r = promptObj.record, aud = promptObj.knownAudited || new Set();
	return ( r.score === 'high' && !aud.has(auditKey(r)) ) ? 'approve' : 'reject';
}

/**
 * makeModel('stub', { oracleFn? })  -> deterministic, no network (oracleFn override = the neg-control hook)
 * makeModel('live', { ask })        -> calls the real local model, parses approve/reject
 * Returns async (promptObj) -> { action, len }.
 */
function makeModel( mode, opts = {} ) {
	if ( mode === 'stub' ) {
		const orc = opts.oracleFn || oracle;
		return async ( promptObj ) => ({ action: orc(promptObj), len: buildPrompt(promptObj).len });
	}
	if ( mode === 'live' ) {
		const ask = opts.ask;
		if ( !ask ) throw new Error('live model needs opts.ask');
		return async ( promptObj ) => {
			const p = buildPrompt(promptObj);
			const raw = await ask({ system: p.system, user: p.user, maxTokens: 6, temperature: 0 });
			const w = String(raw || '').toLowerCase();
			const action = /reject/.test(w) && !/approve/.test(w) ? 'reject' : ( /approve/.test(w) ? 'approve' : 'reject' );
			return { action, len: p.len };
		};
	}
	throw new Error('unknown model mode ' + mode);
}

function score( actions, workload ) {
	const { stream, truth, isFlipped } = workload;
	let ok = 0, n = 0, driftOk = 0, driftN = 0;
	for ( const r of stream ) {
		n++; if ( actions[r.index] === truth(r) ) ok++;
		if ( isFlipped(r) ) { driftN++; if ( actions[r.index] === truth(r) ) driftOk++; }
	}
	return { ok, n, driftOk, driftN, acc: ok / n, driftAcc: driftN ? driftOk / driftN : 1 };
}

async function runCampaign( { workload, model, armNames } ) {
	const env = { workload, model };
	const names = armNames || Object.keys(ARMS);
	const results = [];
	for ( const name of names ) {
		const res = await ARMS[name](workload.stream, env);
		results.push({ ...res, ...score(res.actions, workload) });
	}
	return { results, meta: workload.meta };
}

/**
 * The HARNESS SELF-TEST (#34 guard). Under the deterministic stub the NAIVE arm (re-derive every
 * record with the current audit) MUST be perfect — overall AND on the drift cases. If it is not,
 * the oracle / ground-truth / scoring wiring is broken; refuse to report any comparative result.
 * Returns { ok, naive, reason }.
 */
async function selfTest( workload, opts = {} ) {
	const model = makeModel('stub', opts);                                    // opts.oracleFn = neg-control hook
	const { results } = await runCampaign({ workload, model, armNames: ['NAIVE'] });
	const naive = results[0];
	const ok = naive.acc === 1 && naive.driftAcc === 1;
	return { ok, naive, reason: ok ? 'naive is perfect under the stub (instrumentation sound)'
		: `naive acc=${naive.acc.toFixed(3)} driftAcc=${naive.driftAcc.toFixed(3)} — oracle/scoring/wiring is BROKEN` };
}

module.exports = { buildPrompt, oracle, makeModel, score, runCampaign, selfTest };
