'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P1b — the arms, behind ONE uniform iface. Each arm is `async (stream, env) -> result`, where
 *   env.model(promptObj) -> { action, len }   (the only model-call path; stub or live)
 *   env.workload         = the workload (truth/activeAuditAt/auditedSet/auditAt)
 * and `result = { name, calls, tokens, maxContext, actions[] }`. Every model call goes through
 * `track()` so calls / tokens / per-call-context are attributed identically across arms.
 *
 * The arms differ ONLY in mechanism — caching, defeasance, where the audit reaches the decision:
 *   NAIVE        re-derive every record WITH the current audit               -> correct, N calls, const ctx
 *   LONG-CONTEXT re-derive WITH audit + ALL history in the prompt            -> correct, N calls, O(N) ctx
 *   RAG          reuse nearest by SURFACE key (incl. incidental tier)        -> stale on drift, tier-split calls
 *   CBR          reuse on the TYPED key {kind,region,score} (= STRUCT key)   -> stale on drift  (= STRUCT − contract)
 *   SKILL        forge a PROSE skill, re-APPLY it via the model (no premise) -> stale on drift, pays apply-calls
 *   STRUCT       TYPED memo (real digest) + DEFEASIBLE contract (satisfies)  -> correct on drift, amortized, const ctx
 *
 * Decisive corner: STRUCT is the ONLY arm that is simultaneously (low calls) ∧ (correct-on-drift) ∧ (bounded ctx).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { digest } = require(ROOT + '/lib/providers/canonicalize.js');     // the real K1 typed key
const C = require(ROOT + '/lib/authoring/core/contract.js');                   // the real defeasible-contract checker

const typedKey = ( r ) => digest({ kind: r.kind, region: r.region, score: r.score });   // tier EXCLUDED (incidental)
const surfaceKey = ( r ) => `${r.kind}|${r.region}|${r.tier}|${r.score}`;                // tier INCLUDED (surface)
const auditKey = ( r ) => `${r.region}|${r.kind}`;

function newCounters() { return { calls: 0, tokens: 0, maxContext: 0 }; }
async function track( c, env, promptObj ) {
	const { action, len } = await env.model(promptObj);
	c.calls++; c.tokens += Math.ceil(len / 4); if ( len > c.maxContext ) c.maxContext = len;
	return action;
}
const finalize = ( name, c, actions ) => ({ name, calls: c.calls, tokens: c.tokens, maxContext: c.maxContext, actions });

// ── NAIVE: re-derive every record with the current audit (the correctness ceiling; no reuse) ──
async function naive( stream, env ) {
	const c = newCounters(), actions = [];
	for ( const r of stream )
		actions[r.index] = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index) });
	return finalize('NAIVE', c, actions);
}

// ── LONG-CONTEXT: correct (audit in prompt) but carries ALL history -> per-call context grows O(N) ──
async function longContext( stream, env ) {
	const c = newCounters(), actions = [], history = [];
	for ( const r of stream ) {
		const action = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index), history: history.slice() });
		actions[r.index] = action; history.push({ record: r, action });
	}
	return finalize('LONG-CONTEXT', c, actions);
}

// ── RAG: reuse nearest by SURFACE key (incl. incidental tier). No defeasance -> stale on the audited class ──
async function rag( stream, env ) {
	const c = newCounters(), actions = [], cache = new Map();
	for ( const r of stream ) {
		const k = surfaceKey(r);
		if ( cache.has(k) ) { actions[r.index] = cache.get(k); continue; }              // HIT: reuse (stale after audit)
		const action = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index) });
		cache.set(k, action); actions[r.index] = action;
	}
	return finalize('RAG', c, actions);
}

// ── CBR: reuse on the TYPED key (elides tier — amortizes like STRUCT) but NO defeasance = STRUCT − contract ──
async function cbr( stream, env ) {
	const c = newCounters(), actions = [], cache = new Map();
	for ( const r of stream ) {
		const k = typedKey(r);
		if ( cache.has(k) ) { actions[r.index] = cache.get(k); continue; }              // HIT: reuse (stale after audit)
		const action = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index) });
		cache.set(k, action); actions[r.index] = action;
	}
	return finalize('CBR', c, actions);
}

// ── SKILL-LIBRARY (Voyager-style prose): forge a prose skill, then re-APPLY it via the model on recurrence.
//    The prose snapshots the action with NO defeasible premise -> the apply reproduces the stale snapshot. ──
async function skillLibrary( stream, env ) {
	const c = newCounters(), actions = [], skills = new Map();
	for ( const r of stream ) {
		const k = typedKey(r);
		if ( !skills.has(k) ) {                                                         // forge from a fresh derivation
			const action = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index) });
			skills.set(k, { text: `For ${r.kind}/${r.region}/${r.score}: ${action}.`, action });
			actions[r.index] = action; continue;
		}
		const sk = skills.get(k);                                                       // APPLY the prose (pays a call)
		actions[r.index] = await track(c, env, { record: r, skillText: sk.text, forcedAction: sk.action, knownAudited: new Set() });
	}
	return finalize('SKILL', c, actions);
}

// ── INVALIDATING-CACHE: the FAIR baseline (reviewer's request). A typed-key cache that DOES get the audit event,
//    but invalidates by a COARSE hand-coded class callback (no typed contract): on the audit it drops EVERY entry
//    of an audited class. It therefore RECOVERS on drift (unlike RAG/CBR/Skill) — isolating "has an invalidation
//    hook". The contrast vs STRUCT is what the typed contract adds: STRUCT re-asserts the POST per entry and evicts
//    ONLY the violated (approve) ones, so it is SELECTIVE; this coarse callback over-evicts (drops correct reject
//    entries too) and pays extra re-derivations — and it is per-event hand-coded, not declarative/premise-agnostic.
async function invalidatingCache( stream, env ) {
	const c = newCounters(), actions = [], cache = new Map();
	const { auditAt, auditedSet } = env.workload; let didEvict = false;
	for ( const r of stream ) {
		if ( !didEvict && r.index >= auditAt ) {
			didEvict = true;
			for ( const [k, e] of cache ) if ( auditedSet.has(`${e.region}|${e.kind}`) ) cache.delete(k);   // coarse: whole class
		}
		const k = typedKey(r);
		if ( cache.has(k) ) { actions[r.index] = cache.get(k).action; continue; }
		const action = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index) });
		cache.set(k, { action, region: r.region, kind: r.kind, score: r.score }); actions[r.index] = action;
	}
	return finalize('INVALIDATING', c, actions);
}

// ── STRUCT: real typed memo (digest) + DEFEASIBLE contract (satisfies). At the audit, the contract evicts
//    exactly the invalidated entries (the moat); the audited class re-derives, the rest stays amortized. ──
async function struct( stream, env ) {
	const c = newCounters(), actions = [], memo = new Map(), blames = [];
	let evicted = false;
	const { auditAt, auditedSet } = env.workload;
	for ( const r of stream ) {
		// fire the defeasance pass once, at the audit boundary: re-assert each cached approval's post
		// `approve ⟹ compliant` against the new audit fact; a violated post -> evict + blame (C-audit trail).
		if ( !evicted && r.index >= auditAt ) {
			evicted = true;
			for ( const [k, e] of memo ) {
				if ( e.action !== 'approve' ) continue;
				const facts = { compliant: !auditedSet.has(`${e.region}|${e.kind}`) };
				// the post `approve ⟹ compliant`, re-asserted against the audit fact. NB: the truthiness atom
				// needs the `$` ref prefix (`$compliant`) — a bare `compliant` silently evaluates false (engine
				// ref syntax; cf. contract-unlearn.js `ensure:['$compliant']`). Bare form = over-eviction.
				if ( !C.satisfies(['$compliant'], facts) ) { memo.delete(k); blames.push({ key: k, because: 'compliant' }); }
			}
		}
		const k = typedKey(r);
		if ( memo.has(k) ) { actions[r.index] = memo.get(k).action; continue; }         // HIT: amortized
		const action = await track(c, env, { record: r, knownAudited: env.workload.activeAuditAt(r.index) });
		memo.set(k, { action, region: r.region, kind: r.kind, score: r.score }); actions[r.index] = action;
	}
	const res = finalize('STRUCT', c, actions); res.blames = blames; return res;
}

const ARMS = { NAIVE: naive, 'LONG-CONTEXT': longContext, RAG: rag, CBR: cbr, SKILL: skillLibrary, INVALIDATING: invalidatingCache, STRUCT: struct };

// bounded-concurrency pool — run `worker(item,i)` over `items`, ≤ `conc` in flight, results in order. Used by the
// runners to fan independent ARMS across a PARALLEL llm server (LM Studio continuous batching). Pure Map arms are
// concurrency-safe (own state); the STRUCT-REAL* engine arms mutate the GLOBAL Graph._providers → the runners keep
// THOSE sequential and pool only the rest. (A cache hit / single-flight makes same-key derivations safe too.)
async function pool( items, worker, conc ) {
	conc = Math.max(1, conc || 1);
	const out = new Array(items.length); let next = 0;
	async function run() { while ( next < items.length ) { const i = next++; out[i] = await worker(items[i], i); } }
	await Promise.all(Array.from({ length: Math.min(conc, items.length) }, run));
	return out;
}

// track/newCounters/finalize are exported so sibling arm-sets (named-arms.js: MemGPT/Reflexion/GraphRAG)
// share IDENTICAL accounting — same call/token/maxContext attribution, no measurement drift across files.
module.exports = { ARMS, typedKey, surfaceKey, auditKey, track, newCounters, finalize, pool };
