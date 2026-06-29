'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the COMPOSED (2-link) arms behind one uniform iface:
 *     async (stream, env) -> { name, calls, tokens, maxContext, actions1[], actions2[] }
 * Every model call goes through arms.js#track so calls/tokens/per-call-context are attributed
 * IDENTICALLY to the single-link arms. Each arm runs the chain  decide (link 1) -> disburse (link 2),
 * where link 2 reads link 1's OUTCOME (promptObj.decision).
 *
 * This file holds the SURFACE arms (the kill-test set); the named systems (MemGPT/Reflexion/GraphRAG)
 * in their composed form live in composed-named-arms.js. The decisive contrast measured here:
 *   - STRUCT-2  re-asserts the upstream contract, re-derives ONLY the violated chain (reject + held),
 *               selectively — the cascade. drift recovered at BOTH links; contract re-check = 0 calls.
 *   - CBR-2     ( = STRUCT-2 - contract ) a typed memo of the COMPOSED outcome: post-audit the key is
 *               unchanged -> HIT -> serves the stale (approve, disbursed) -> WRONG at BOTH links.
 *               The compounding neg control: one stale entry poisons the whole chain.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { digest } = require(ROOT + '/lib/providers/canonicalize.js');         // the real K1 typed key
const C = require(ROOT + '/lib/authoring/contract.js');                       // the real defeasible-contract checker
const { track, newCounters, finalize } = require('./arms.js');

const typedKey = ( r ) => digest({ kind: r.kind, region: r.region, score: r.score });   // tier EXCLUDED (incidental)
const classOf = ( r ) => `${r.region}|${r.kind}`;

const finalize2 = ( name, c, actions1, actions2 ) =>
	Object.assign(finalize(name, c, actions1), { actions1, actions2 });

// ── NAIVE-2: re-derive BOTH links with the current audit (the correctness ceiling; no reuse). 2 calls/record ──
async function naive2( stream, env ) {
	const c = newCounters(), a1 = [], a2 = [];
	for ( const r of stream ) {
		const d = await track(c, env, { task: 'decide', record: r, knownAudited: env.workload.activeAuditAt(r.index) });
		a1[r.index] = d;
		a2[r.index] = await track(c, env, { task: 'disburse', record: r, decision: d });
	}
	return finalize2('NAIVE-2', c, a1, a2);
}

// ── CBR-2: typed memo of the COMPOSED outcome, NO defeasance ( = STRUCT-2 - contract ). On drift the key is
//    unchanged -> serves the stale (approve, disbursed) at BOTH links -> the staleness COMPOUNDS. ──
async function cbr2( stream, env ) {
	const c = newCounters(), a1 = [], a2 = [], memo = new Map();
	for ( const r of stream ) {
		const k = typedKey(r);
		if ( memo.has(k) ) { const e = memo.get(k); a1[r.index] = e.d; a2[r.index] = e.b; continue; }   // HIT: both stale
		const d = await track(c, env, { task: 'decide', record: r, knownAudited: env.workload.activeAuditAt(r.index) });
		const b = await track(c, env, { task: 'disburse', record: r, decision: d });
		memo.set(k, { d, b }); a1[r.index] = d; a2[r.index] = b;
	}
	return finalize2('CBR-2', c, a1, a2);
}

// ── STRUCT-2: the faithful 2-link proxy of the engine cascade. A typed memo per link; link 2 is keyed on the
//    UPSTREAM decision (= "gate on the overwritten outcome fact", the engine cascade pattern). At the audit the
//    defeasible contract re-asserts each cached approval's post `approve => compliant`; a violated post evicts the
//    link-1 entry. The audited class then re-derives link 1 -> reject, and link 2's lookup keys on the NEW decision
//    -> a MISS -> re-derives held: the cascade, SELECTIVE (only the violated chain re-derives). The stale link-2
//    (typed, approve) entry survives but is never looked up again (the decision changed) — no eviction needed. ──
async function struct2( stream, env ) {
	const c = newCounters(), a1 = [], a2 = [], memo1 = new Map(), memo2 = new Map(), blames = [];
	let evicted = false;
	const { auditAt, auditedSet } = env.workload;
	for ( const r of stream ) {
		// the defeasance pass, once, at the audit boundary: re-assert `approve => compliant` per cached approval.
		if ( !evicted && r.index >= auditAt ) {
			evicted = true;
			for ( const [k, e] of memo1 ) {
				if ( e.action !== 'approve' ) continue;
				const facts = { compliant: !auditedSet.has(classOf(e)) };
				// the truthiness atom needs the `$` ref prefix (finding #36); a bare `compliant` over-evicts.
				if ( !C.satisfies(['$compliant'], facts) ) { memo1.delete(k); blames.push({ key: k, because: 'compliant' }); }
			}
		}
		const k = typedKey(r);
		// LINK 1
		let d;
		if ( memo1.has(k) ) d = memo1.get(k).action;
		else { d = await track(c, env, { task: 'decide', record: r, knownAudited: env.workload.activeAuditAt(r.index) });
			memo1.set(k, { action: d, region: r.region, kind: r.kind, score: r.score }); }
		a1[r.index] = d;
		// LINK 2 — keyed on disburse's ACTUAL read-set {kind,region,decision} (score EXCLUDED — disburse reads
		// only the decision). A flipped decision is a fresh key -> the cascade re-derives; and the re-derived
		// (k,r,reject) "held" reuses the low-score sibling's entry (the engine's read-set keying does the same —
		// this is the M4.1 finding: a key derived from the real read-set amortizes better than a hand-kept one
		// that over-includes an incidental fact). Keeping score here would cost 2 needless re-derivations.
		const k2 = `${r.kind}|${r.region}|${d}`;
		let b;
		if ( memo2.has(k2) ) b = memo2.get(k2);
		else { b = await track(c, env, { task: 'disburse', record: r, decision: d }); memo2.set(k2, b); }
		a2[r.index] = b;
	}
	const res = finalize2('STRUCT-2', c, a1, a2); res.blames = blames; return res;
}

const COMPOSED_SURFACE_ARMS = { 'NAIVE-2': naive2, 'CBR-2': cbr2, 'STRUCT-2': struct2 };

module.exports = { COMPOSED_SURFACE_ARMS, naive2, cbr2, struct2, typedKey, classOf, finalize2 };
