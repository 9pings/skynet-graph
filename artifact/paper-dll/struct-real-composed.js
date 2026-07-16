'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — STRUCT-REAL-2: the COMPOSED head-to-head's STRUCT backed by the ACTUAL engine (the
 * streaming-arm form of struct-real.js#composedCascadeDemo). It closes the same symmetry gap M4.1 closed
 * for the single link: is the composed STRUCT-2 (a two-Map proxy) faithful to the engine? Here the chain
 * is the real rule-driven graph (COMPOSED_TREE, 4 ensure-gated concepts) wrapped in the derivation cache:
 *
 *   ApproveDecision / RejectDecision   ensure $approvable / $approvable==false   (link 1, sets `decision`)
 *   Disburse / Hold                    ensure $decision=="approve" / =="reject"  (link 2, reads `decision`)
 *
 * On a premise-fall (the audit makes approvable=false) the engine UN-CASTS ApproveDecision and casts
 * RejectDecision -> `decision` flips approve->reject -> the change CASCADES: Disburse un-casts, Hold casts
 * -> `disbursement` flips disbursed->held. The JTMS un-learns the WHOLE chain, SELECTIVELY (only the audited
 * case). The cache namespaces by concept name AND the read-set, so a recurrent class replays at 0 model
 * calls and only the violated chain re-derives. Every provider routes through env.model (same accounting).
 *
 * Verdict target: STRUCT-REAL-2 REPRODUCES STRUCT-2 (calls + drift on both links) -> the Map proxy is
 * faithful, not an unfair stub, for the composed measure too.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const Graph = require(ROOT + '/lib/graph/index.js');
const { nextStable } = require(ROOT + '/lib/authoring/core/supervise.js');
const { createProviderCache } = require(ROOT + '/lib/providers/cache.js');
const { buildPrompt } = require('./composed-harness.js');
const { finalize2 } = require('./composed-arms.js');

const auditKey = ( r ) => `${r.region}|${r.kind}`;

// the COMPOSED defeasible tree (= struct-real.js#COMPOSED_TREE; copied so this file is self-contained).
const COMPOSED_TREE = { common: { childConcepts: {
	ApproveDecision: { _id: 'ApproveDecision', _name: 'ApproveDecision', require: ['score'], ensure: ['$approvable'], provider: ['Dec::approve'] },
	RejectDecision: { _id: 'RejectDecision', _name: 'RejectDecision', require: ['score'], ensure: ['$approvable==false'], provider: ['Dec::reject'] },
	Disburse: { _id: 'Disburse', _name: 'Disburse', require: ['decision'], ensure: ['$decision=="approve"'], provider: ['Dec::disburse'] },
	Hold: { _id: 'Hold', _name: 'Hold', require: ['decision'], ensure: ['$decision=="reject"'], provider: ['Dec::hold'] },
} } };

// cache keys = each concept's READ-SET. Link 1 keys on {k,r,s,approvable}; link 2 keys on {decision}
// (= "gate on the overwritten outcome fact": a flipped decision is a fresh key -> the cascade re-derives).
const keyDecide = ( g, c, scope ) => { const f = scope._; return { k: f.kind, r: f.region, s: f.score, a: !!f.approvable }; };
const keyDisburse = ( g, c, scope ) => { const f = scope._; return { k: f.kind, r: f.region, d: f.decision }; };

function makeStructReal2( opts ) {
	opts = opts || {};
	return async function structReal2( stream, env ) {
		const counters = { calls: 0, tokens: 0, maxContext: 0 };
		const a1 = [], a2 = [];
		const cache = createProviderCache(opts.store ? { store: opts.store } : {});

		// route a micro-task through env.model with identical accounting (a cache hit elides it).
		async function call( promptObj ) {
			const res = await env.model(promptObj);
			const len = buildPrompt(promptObj).len;
			counters.calls++; counters.tokens += Math.ceil(len / 4); if ( len > counters.maxContext ) counters.maxContext = len;
			return res.action;
		}
		const decideProv = ( g, c, scope, argz, cb ) => {
			const f = scope._;
			const knownAudited = f.approvable === false ? new Set([`${f.region}|${f.kind}`]) : new Set();
			call({ task: 'decide', record: { kind: f.kind, region: f.region, score: f.score, tier: f.tier }, knownAudited })
				.then(( action ) => cb(null, { $_id: '_parent', decision: action, [c._name]: true }) ).catch(cb);
		};
		const disburseProv = ( g, c, scope, argz, cb ) => {
			const f = scope._;
			call({ task: 'disburse', record: { kind: f.kind, region: f.region, tier: f.tier }, decision: f.decision })
				.then(( action ) => cb(null, { $_id: '_parent', disbursement: action, [c._name]: true }) ).catch(cb);
		};
		Graph._providers = cache.wrapFragment(
			{ Dec: { approve: decideProv, reject: decideProv, disburse: disburseProv, hold: disburseProv } },
			{ 'Dec::approve': keyDecide, 'Dec::reject': keyDecide, 'Dec::disburse': keyDisburse, 'Dec::hold': keyDisburse } );

		const g = new Graph({ lastRev: 0, freeNodes: [], segments: [], nodes: [] },
			{ label: 'struct-real-2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, COMPOSED_TREE);
		await nextStable(g);

		for ( const rec of stream ) {
			const compliant = !env.workload.activeAuditAt(rec.index).has(auditKey(rec));
			const id = 'r' + rec.index;
			await new Promise(( res ) => g.pushMutation({ _id: id, Node: true, kind: rec.kind, region: rec.region,
				score: rec.score, tier: rec.tier, compliant, approvable: rec.score === 'high' && compliant },
				null, undefined, undefined, undefined, () => res()));
			await nextStable(g);
			const e = g.getEtty(id);
			a1[rec.index] = e ? e._.decision : undefined;
			a2[rec.index] = e ? e._.disbursement : undefined;
		}
		return finalize2(opts.name || 'STRUCT-REAL-2', counters, a1, a2);
	};
}

const STRUCT_REAL2_ARMS = { 'STRUCT-REAL-2': makeStructReal2({ name: 'STRUCT-REAL-2' }) };

module.exports = { makeStructReal2, STRUCT_REAL2_ARMS, COMPOSED_TREE };
