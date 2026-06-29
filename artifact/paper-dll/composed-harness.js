'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the shared harness for the COMPOSED (2-link) head-to-head. A strict extension of
 * harness.js: prompts/oracle/model handle BOTH micro-tasks via promptObj.task ('decide' | 'disburse'),
 * so every arm's model call is attributed identically (calls/tokens/maxContext) whatever the link.
 *
 * Scoring reports BOTH links separately (acc/driftAcc per link) so we can MEASURE compounded staleness:
 * a surface memory is stale at link 1 AND link 2; a partial recovery is right at link 1 but wrong at
 * link 2 (the cascade didn't propagate). The #34 self-test guard generalizes: composed NAIVE must be
 * perfect on BOTH links under the stub, else the instrumentation is unsound — abort.
 */
const { auditKey } = require('./arms.js');

// ── prompt construction (shared by stub + live so per-call CONTEXT is measured identically) ──
// task 'decide'  -> the link-1 approval micro-task (identical wording to harness.js#buildPrompt)
// task 'disburse' -> the link-2 micro-task: it READS the upstream decision (promptObj.decision)
function buildPrompt( promptObj ) {
	const r = promptObj.record;
	if ( promptObj.task === 'disburse' ) {
		let user = `disburse kind=${r.kind} region=${r.region} tier=${r.tier} decision=${promptObj.decision}`;
		if ( promptObj.skillText ) user += `\nskill="${promptObj.skillText}"`;
		if ( promptObj.history && promptObj.history.length )
			user += `\nhistory:\n` + promptObj.history.map(( h ) => `${h.record.kind}/${h.record.region}->${h.action}`).join('\n');
		const system = "You disburse 'disbursed' or 'held'. If a skill is given, follow it. Otherwise disbursed iff the decision is approve; else held. Reply with only one word: disbursed or held.";
		return { system, user, len: system.length + user.length };
	}
	// default: the link-1 decide prompt (kept byte-identical to harness.js for cross-measure comparability)
	let user = `decide kind=${r.kind} region=${r.region} tier=${r.tier} score=${r.score}`;
	const aud = promptObj.knownAudited;
	if ( aud && aud.size ) user += `\nnon-compliant=[${[...aud].join(',')}]`;
	if ( promptObj.skillText ) user += `\nskill="${promptObj.skillText}"`;
	if ( promptObj.history && promptObj.history.length )
		user += `\nhistory:\n` + promptObj.history.map(( h ) => `${h.record.kind}/${h.record.region}/${h.record.score}->${h.action}`).join('\n');
	const system = "You decide 'approve' or 'reject'. If a skill is given, follow it. Otherwise approve iff score is high AND the (region,kind) is NOT in non-compliant; else reject. Reply with only one word: approve or reject.";
	return { system, user, len: system.length + user.length };
}

// the deterministic oracle of the CURRENT 2-link rule, given ONLY what the prompt tells it.
function oracle( promptObj ) {
	if ( promptObj.forcedAction != null ) return promptObj.forcedAction;       // skill apply -> reproduce the snapshot
	if ( promptObj.task === 'disburse' ) return promptObj.decision === 'approve' ? 'disbursed' : 'held';
	const r = promptObj.record, aud = promptObj.knownAudited || new Set();
	return ( r.score === 'high' && !aud.has(auditKey(r)) ) ? 'approve' : 'reject';
}

/**
 * makeModel('stub', { oracleFn? })  -> deterministic, no network (oracleFn override = the neg-control hook)
 * makeModel('live', { ask })        -> calls the real local model, parses the link's two words.
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
			let action;
			if ( promptObj.task === 'disburse' )
				action = /held/.test(w) && !/disbursed/.test(w) ? 'held' : ( /disbursed/.test(w) ? 'disbursed' : 'held' );
			else
				action = /reject/.test(w) && !/approve/.test(w) ? 'reject' : ( /approve/.test(w) ? 'approve' : 'reject' );
			return { action, len: p.len };
		};
	}
	throw new Error('unknown model mode ' + mode);
}

// score one link: actions[index] vs truthFn, with the drift subset via isFlippedFn.
function scoreLink( actions, stream, truthFn, isFlippedFn ) {
	let ok = 0, n = 0, driftOk = 0, driftN = 0;
	for ( const r of stream ) {
		n++; if ( actions[r.index] === truthFn(r) ) ok++;
		if ( isFlippedFn(r) ) { driftN++; if ( actions[r.index] === truthFn(r) ) driftOk++; }
	}
	return { ok, n, driftOk, driftN, acc: ok / n, driftAcc: driftN ? driftOk / driftN : 1 };
}

// score BOTH links of a composed result { actions1, actions2 }.
function score( res, workload ) {
	const { stream, truth1, truth2, isFlipped1, isFlipped2 } = workload;
	const L1 = scoreLink(res.actions1, stream, truth1, isFlipped1);
	const L2 = scoreLink(res.actions2, stream, truth2, isFlipped2);
	return {
		acc1: L1.acc, driftAcc1: L1.driftAcc, acc2: L2.acc, driftAcc2: L2.driftAcc,
		// composite: a record is fully correct iff BOTH links are correct (the end-to-end view)
		acc: ( ( () => { let ok = 0; for ( const r of stream ) if ( res.actions1[r.index] === truth1(r) && res.actions2[r.index] === truth2(r) ) ok++; return ok / stream.length; } )() ),
		driftAcc: Math.min(L1.driftAcc, L2.driftAcc),
	};
}

/**
 * The composed HARNESS SELF-TEST (#34 guard). A composed NAIVE (re-derive BOTH links with the current
 * audit) MUST be perfect on link 1 AND link 2 — overall and on the drift cases — under the stub. Else
 * the oracle/ground-truth/wiring is broken; refuse to report any comparative result. Returns {ok,reason}.
 */
async function selfTest( workload, makeNaive, opts = {} ) {
	const model = makeModel('stub', opts);
	const res = await makeNaive(workload.stream, { workload, model });
	const s = score(res, workload);
	const ok = s.acc1 === 1 && s.driftAcc1 === 1 && s.acc2 === 1 && s.driftAcc2 === 1;
	return { ok, s, reason: ok ? 'composed naive is perfect on both links under the stub (instrumentation sound)'
		: `naive acc1=${s.acc1.toFixed(3)} drift1=${s.driftAcc1.toFixed(3)} acc2=${s.acc2.toFixed(3)} drift2=${s.driftAcc2.toFixed(3)} — oracle/scoring/wiring is BROKEN` };
}

module.exports = { buildPrompt, oracle, makeModel, score, scoreLink, selfTest };
