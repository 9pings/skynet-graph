'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4.1 — STRUCT-REAL: the STRUCT arm of the head-to-head, backed by the ACTUAL engine instead of a hand-written
 * Map. It closes the paper's symmetry gap (E6 §6 "named-system fidelity"): if STRUCT is also a stub, the
 * comparison is symmetrically weak. Here STRUCT is the real rule-driven graph —
 *   - AMORTIZATION   via the engine's derivation cache (`lib/providers/cache.js`), keyed on the contract
 *                    READ-SET {kind,region,score,approvable} (tier EXCLUDED = the incidental axis): a recurrent
 *                    typed class replays at 0 model calls.
 *   - DEFEASANCE     via two mutually-exclusive ensure-gated concepts (ApproveDecision / RejectDecision) sharing
 *                    one `decide` provider. `approvable` (= score==high && compliant) is the directly-ingested
 *                    premise (E4 pattern); when it falls the engine UN-CASTS ApproveDecision (JTMS un-learn — no
 *                    stale belief served) and casts RejectDecision. The audited class re-derives keyed on the new
 *                    premise; the rest stays amortized. SELECTIVE: only the violated entries re-derive.
 *   - BOUNDED CTX    each provider call sees only its node's local facts, independent of graph size.
 * The provider routes the decision through `env.model` (stub or live) so calls/tokens/maxContext are attributed
 * IDENTICALLY to every other arm. The arm shape matches arms.js: `async (stream, env) => result`.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const Graph = require(ROOT + '/lib/graph/index.js');
const { nextStable } = require(ROOT + '/lib/authoring/core/supervise.js');
const { createProviderCache } = require(ROOT + '/lib/providers/cache.js');
const { buildPrompt } = require('./harness.js');

const auditKey = ( r ) => `${r.region}|${r.kind}`;

// DEFEASIBLE tree: two mutually-exclusive ensure-gated concepts (the decision belief). On a fallen premise
// ApproveDecision UN-CASTS (the JTMS un-learn) and RejectDecision casts — and because the cache namespaces by
// concept name, the routing to a different concept IS the defeasance (the engine's casting structure does the
// premise discrimination the Map STRUCT has to hand-encode into its key). Provider sets its own cast marker (#33).
const TREE = { common: { childConcepts: {
	ApproveDecision: { _id: 'ApproveDecision', _name: 'ApproveDecision', require: ['score'], ensure: ['$approvable'], provider: ['Dec::decide'] },
	RejectDecision: { _id: 'RejectDecision', _name: 'RejectDecision', require: ['score'], ensure: ['$approvable==false'], provider: ['Dec::decide'] },
} } };

// FLAT tree (the NEGATIVE CONTROL): a single always-on Decide concept — NO ensure gate, so no routing-by-premise.
// With a premise-less cache key the drifted case false-hits its pre-audit `approve` (stale): proving the
// ensure-gated defeasance is load-bearing, the engine reproducing CBR's failure mode.
const FLAT_TREE = { common: { childConcepts: {
	Decide: { _id: 'Decide', _name: 'Decide', require: ['score'], provider: ['Dec::decide'] },
} } };

// the cache key = the contract READ-SET. The flat control drops `approvable` (premise-less) AND uses one concept.
function makeKeyFn( keyIncludesPremise ) {
	return ( g, c, scope ) => {
		const f = scope._;
		const k = { k: f.kind, r: f.region, s: f.score };
		if ( keyIncludesPremise ) k.a = !!f.approvable;
		return k;
	};
}

/**
 * struct-real arm. opts.keyIncludesPremise (default true). The audit state comes from env.workload
 * (activeAuditAt / auditAt): a record at index >= auditAt whose class is audited has approvable=false.
 */
function makeStructReal( opts ) {
	opts = opts || {};
	const flat = !!opts.flat;
	const tree = flat ? FLAT_TREE : TREE;
	const keyIncludesPremise = flat ? false : (opts.keyIncludesPremise !== false);
	return async function structReal( stream, env ) {
		const counters = { calls: 0, tokens: 0, maxContext: 0 };
		const actions = [];
		// opts.store (a Map-like, e.g. a file-backed createFileStore) makes the derivation cache PERSIST: a fresh
		// "process" passing the same store re-hydrates the warm library and replays recurrent classes at 0 calls
		// (cross-restart amortization, M4.2). Default = a fresh in-memory cache (no persistence).
		const cache = createProviderCache(opts.store ? { store: opts.store } : {});

		// the decide provider routes through env.model (same accounting as track()): a cold firing is one model
		// call; a cache hit elides it. The prompt is built identically to the other arms (comparable maxContext).
		async function decide( g, c, scope, argz, cb ) {
			const f = scope._;
			const r = { kind: f.kind, region: f.region, score: f.score, tier: f.tier };
			const knownAudited = f.approvable === false ? new Set([`${f.region}|${f.kind}`]) : new Set();
			const promptObj = { record: r, knownAudited };
			try {
				const res = await env.model(promptObj);
				const len = buildPrompt(promptObj).len;
				counters.calls++; counters.tokens += Math.ceil(len / 4); if ( len > counters.maxContext ) counters.maxContext = len;
				cb(null, { $_id: '_parent', decision: res.action, [c._name]: true });
			} catch ( e ) { cb(e); }
		}
		Graph._providers = cache.wrapFragment({ Dec: { decide } }, { 'Dec::decide': makeKeyFn(keyIncludesPremise) });

		// one graph; records are processed STREAMING — one node added + settled + awaited before the next. This
		// SERIALIZES the derivations so the cache amortizes even under a slow async (live) model: node-2 of a class
		// runs AFTER node-1's cache.set. (A batch seed fires all async providers concurrently → they race the cache
		// before any set lands → no amortization under a live model; the deterministic stub hides it. Real finding.)
		// The audit is exogenous state read off env.workload; the mutation-sequencing constraint holds (every node
		// enters via a sequenced, rev-logged pushMutation — never an out-of-band set). pushMutation's cb is the 6th arg.
		const g = new Graph({ lastRev: 0, freeNodes: [], segments: [], nodes: [] }, { label: 'struct-real', isMaster: true,
			autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
		await nextStable(g);

		for ( const rec of stream ) {
			const compliant = !env.workload.activeAuditAt(rec.index).has(auditKey(rec));
			const id = 'r' + rec.index;
			// pushMutation's cb is the 6th arg and fires with the APPLIED-objects map (not an (err,res) convention) —
			// resolve on its call (the mutation is sequenced + applied; nextStable then settles it).
			await new Promise(( res ) => g.pushMutation({ _id: id, Node: true, kind: rec.kind, region: rec.region,
				score: rec.score, tier: rec.tier, compliant: compliant, approvable: rec.score === 'high' && compliant },
				null, undefined, undefined, undefined, () => res()));
			await nextStable(g);
			const e = g.getEtty(id);
			actions[rec.index] = e ? e._.decision : undefined;
		}
		return { name: opts.name || 'STRUCT-REAL', calls: counters.calls, tokens: counters.tokens, maxContext: counters.maxContext, actions };
	};
}

const STRUCT_REAL_ARMS = {
	'STRUCT-REAL': makeStructReal({ name: 'STRUCT-REAL' }),
	'STRUCT-REAL-FLAT': makeStructReal({ name: 'STRUCT-REAL-FLAT', flat: true }),   // neg control: no defeasance gate → stale
};

/**
 * The MOAT, demonstrated directly: SELECTIVE JTMS un-learn on an ingested premise-fall. Two cases of the same
 * class are approved; a compliance audit ingests `compliant=false` on ONE → its ApproveDecision belief RETRACTS
 * (un-cast, no stale belief served) and RejectDecision casts → it flips to reject, while the sibling (not
 * ingested) stays approved. This is what a similarity cache CANNOT do — a stale entry there stays retrievable.
 * Returns the before/after state for assertions. The "model" here is a trivial deterministic decide.
 */
async function unlearnDemo() {
	let calls = 0;
	function decide( g, c, scope, argz, cb ) {
		calls++; const f = scope._;
		cb(null, { $_id: '_parent', decision: ( f.score === 'high' && f.compliant !== false ) ? 'approve' : 'reject', [c._name]: true });
	}
	const cache = createProviderCache({});
	Graph._providers = cache.wrapFragment({ Dec: { decide } }, { 'Dec::decide': makeKeyFn(true) });
	const seed = { lastRev: 0, freeNodes: [], segments: [], nodes: [
		{ _id: 'a1', Node: true, kind: 'loan', region: 'EU', score: 'high', compliant: true, approvable: true },
		{ _id: 'a2', Node: true, kind: 'loan', region: 'EU', score: 'high', compliant: true, approvable: true },
	] };
	const g = new Graph(seed, { label: 'unlearn', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, TREE);
	await nextStable(g);
	const dec = ( id ) => { const e = g.getEtty(id); return e ? e._.decision : undefined; };
	const cast = ( id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
	const before = { a1: dec('a1'), a2: dec('a2'), a1Approve: cast('a1', 'ApproveDecision'), calls };
	await new Promise(( res ) => g.ingest({ a1: { compliant: false, approvable: false } }, res));
	await nextStable(g);
	const after = { a1: dec('a1'), a2: dec('a2'), a1Approve: cast('a1', 'ApproveDecision'), a1Reject: cast('a1', 'RejectDecision'),
		a2Approve: cast('a2', 'ApproveDecision'), driftCalls: calls - before.calls };
	return { before, after };
}

// COMPOSED chain (M4.3): a downstream method B (Disburse/Hold) consumes the upstream outcome FACT `decision`.
// KEY PATTERN (the engine finding): a runtime JTMS cascade through a method chain works iff each concept gates on
// the upstream's OVERWRITTEN outcome fact (`$decision=="approve"`), NOT a cast marker or applyMutations — those do
// NOT revert on un-cast; only the mutually-exclusive two-concept pattern (Approve↔Reject overwrites `decision`)
// makes the fact genuinely CHANGE, which re-triggers the downstream gate. (Use "double quotes" for a string
// literal in an ensure — single-quoted `'approve'` silently fails to parse.)
const COMPOSED_TREE = { common: { childConcepts: {
	ApproveDecision: { _id: 'ApproveDecision', _name: 'ApproveDecision', require: ['score'], ensure: ['$approvable'], provider: ['Dec::approve'] },
	RejectDecision: { _id: 'RejectDecision', _name: 'RejectDecision', require: ['score'], ensure: ['$approvable==false'], provider: ['Dec::reject'] },
	Disburse: { _id: 'Disburse', _name: 'Disburse', require: ['decision'], ensure: ['$decision=="approve"'], provider: ['Dec::disburse'] },
	Hold: { _id: 'Hold', _name: 'Hold', require: ['decision'], ensure: ['$decision=="reject"'], provider: ['Dec::hold'] },
} } };

/**
 * M4.3 — COMPOSITION UNDER DRIFT (the capability no named system has). A two-link chain decision→disbursement.
 * On a premise-fall (audit ingest) the upstream RETRACTS (Approve→Reject) and the change CASCADES through the
 * chain (Disburse un-casts, Hold casts) — the JTMS un-learns the WHOLE derivation, selectively (only the
 * audited case). A similarity cache of the composed outcome serves STALE at BOTH links (the staleness COMPOUNDS).
 */
async function composedCascadeDemo() {
	let calls = 0;
	const mk = ( fact, val, name ) => ( g, c, s, a, cb ) => { calls++; cb(null, { $_id: '_parent', [fact]: val, [name]: true }); };
	Graph._providers = { Dec: {
		approve: mk('decision', 'approve', 'ApproveDecision'), reject: mk('decision', 'reject', 'RejectDecision'),
		disburse: mk('disbursement', 'disbursed', 'Disburse'), hold: mk('disbursement', 'held', 'Hold'),
	} };
	const seed = { lastRev: 0, freeNodes: [], segments: [], nodes: [
		{ _id: 'a1', Node: true, kind: 'loan', region: 'EU', score: 'high', compliant: true, approvable: true },
		{ _id: 'a2', Node: true, kind: 'loan', region: 'EU', score: 'high', compliant: true, approvable: true },
	] };
	const g = new Graph(seed, { label: 'composed', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, COMPOSED_TREE);
	await nextStable(g);
	const snap = ( id ) => { const e = g.getEtty(id)._, m = g._objById[id]._etty._mappedConcepts;
		return { decision: e.decision, disbursement: e.disbursement, Disburse: !!m.Disburse, Hold: !!m.Hold }; };
	const before = { a1: snap('a1'), a2: snap('a2') };

	// the audit falls on a1's premise → the whole a1 chain must cascade (decision AND disbursement); a2 untouched.
	await new Promise(( res ) => g.ingest({ a1: { compliant: false, approvable: false } }, res));
	await nextStable(g);
	const after = { a1: snap('a1'), a2: snap('a2') };

	// CONTRAST / negative control: a FLAT similarity cache keyed on the surface class caches the composed outcome;
	// the audit doesn't change the surface key, so a post-audit lookup serves the STALE pair at BOTH links.
	const flat = new Map(); const k = ( r ) => `${r.kind}|${r.region}|${r.score}`;
	flat.set(k({ kind: 'loan', region: 'EU', score: 'high' }), { decision: before.a1.decision, disbursement: before.a1.disbursement });
	const flatAfter = flat.get('loan|EU|high');   // same key post-audit → stale approve + disbursed
	return { before, after, flatAfter };
}

module.exports = { makeStructReal, STRUCT_REAL_ARMS, unlearnDemo, composedCascadeDemo, TREE, FLAT_TREE, COMPOSED_TREE };
