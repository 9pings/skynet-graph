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
const { nextStable } = require(ROOT + '/lib/authoring/supervise.js');
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
		const cache = createProviderCache({});

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

		// one graph; every record is a node carrying its audit-state-derived `approvable` (the audit is exogenous
		// state read off env.workload, not a record field). One settle derives all decisions: the derivation cache
		// amortizes recurrent classes (0 model calls); a drifted post-audit case (approvable=false) is a NEW key →
		// a cold re-derive → reject (SELECTIVE — only the violated class re-derives). The mutation-sequencing
		// constraint holds (all state enters via the seed = the rev-logged construction, never an out-of-band set).
		const nodes = stream.map(( rec ) => {
			const compliant = !env.workload.activeAuditAt(rec.index).has(auditKey(rec));
			return { _id: 'r' + rec.index, Node: true, kind: rec.kind, region: rec.region, score: rec.score,
				tier: rec.tier, compliant: compliant, approvable: rec.score === 'high' && compliant };
		});
		const g = new Graph({ lastRev: 0, freeNodes: [], segments: [], nodes }, { label: 'struct-real', isMaster: true,
			autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
		await nextStable(g);

		for ( const rec of stream ) { const e = g.getEtty('r' + rec.index); actions[rec.index] = e ? e._.decision : undefined; }
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

module.exports = { makeStructReal, STRUCT_REAL_ARMS, unlearnDemo, TREE, FLAT_TREE };
