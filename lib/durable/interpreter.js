/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * interpreter — LAYER B of the durable executor: the per-record TOKEN-FLOW interpreter. It walks case records
 * through a compiled workflow-net (`xlate.js`) VIA the `CheckpointStore` (`checkpoint-store.js`), so position is
 * durable + crash-resumable and each step is content-memoized. This is the skynet-NATIVE half the convergence
 * study (§5 Layer B) keeps out of the commodity plumbing: typed routing (from `selectCluster`'s gates) and
 * per-case determinism live here.
 *
 *   const store = createCheckpointStore({ file });
 *   const net   = compileMethod(spec);
 *   store.ensureRun(runId, net); store.inject(runId, records);
 *   const m = runFlow(store, runId, net, { runTask });   // drains to a fixpoint; resume by calling it again
 *
 * Per-case determinism: each token carries its OWN payload (its world); cross-record interleaving is
 * non-deterministic THROUGHPUT, not belief (the §12.3 belief↔durable line). A transition fires by kind:
 *  - select : evaluate the typed gates (the SAME `when` exprs as `selectCluster`, via the safe `expr.js`
 *             evaluator) against the record's facts → move to the matching branch; no match → the fallback.
 *  - task   : a provider MICRO-TASK. Content-addressed memo (C5): key = FactsDigest(canonical step input); a
 *             HIT replays at 0 calls (this is what makes crash-resume cheap AND amortizes a recurrent stream).
 *             A null `keyOf` BYPASSES the memo (fail-open, like cache.js); a null task = a no-op passthrough.
 *  - map    : Brick-1 fan-out — one child token per element of the `over` collection, each with its own
 *             `elemKey` (fresh per-child payload, #30). Children flow to a sink independently (the fold-back
 *             JOIN is DEFERRED — the JTMS-at-merge point).
 *
 * Termination = fuel (`maxSteps`): a step-indexed cutoff (a cyclic/divergent net stops; §4B), not a claim that
 * the net is sound (defeasance makes static workflow-soundness undecidable — we run to a fuel-bounded fixpoint).
 */
const { compileExpression } = require('../graph/expr.js');
const { indexByFrom } = require('./xlate.js');
const { digest } = require('../providers/canonicalize.js');

// resolve a `$ref` token against a flat/dotted record payload (the case's typed facts). selectCluster gates are
// flat typed facts; dotted access is supported for convenience. (Cross-object `:` walks are an engine concern.)
function resolveFact( payload, ref ) {
	if ( payload == null ) return undefined;
	if ( ref.indexOf('.') < 0 ) return payload[ref];
	return ref.split('.').reduce(( o, k ) => (o == null ? undefined : o[k]), payload);
}

// default content-memo key: the task + the FULL canonical payload. A host that carries incidental (untracked)
// fields should pass `keyOf` to project to TRACKED facts only (the K1 discipline) — else those re-key (no hit).
function defaultKeyOf( tr, token ) { return digest({ task: tr.task, in: token.payload || {} }); }

/**
 * Drain a run to a fixpoint over the CheckpointStore. Idempotent + resumable: call it again after a crash (the
 * caller should `store.rollbackInflight(runId)` first to recover any in-flight token).
 *
 * @param store   a CheckpointStore
 * @param runId
 * @param net     a compiled net (`compileMethod`)
 * @param opts.runTask  (task, token) => { payload?, created? }   — REQUIRED: run a micro-task (provider/LLM).
 *                       Returns a payload PATCH (merged forward) + optional createdRefs. Pure-compute or effecting.
 * @param opts.keyOf    (transition, token) => string|null        — memo key (default: task+canonical payload).
 * @param opts.lease    ms a claimed token is held (default 30000)
 * @param opts.batch    tokens leased per claim (default 32)
 * @param opts.maxSteps fuel — transition firings before a divergent cutoff (default 100000)
 * @returns { steps, taskCalls, memoHits, bypass, fanOut, routed, done, failed }  — MEASURED counters.
 */
function runFlow( store, runId, net, opts ) {
	opts = opts || {};
	const runTask = opts.runTask;
	if ( typeof runTask !== 'function' ) throw new Error('runFlow: opts.runTask (task, token) => {payload?,created?} is required');
	const keyOf = opts.keyOf || defaultKeyOf;
	const lease = opts.lease || 30000, batch = opts.batch || 32, fuel = opts.maxSteps || 100000;

	const byFrom = indexByFrom(net);
	const gateFns = {};                                          // precompile each select's gates once
	for ( const t of net.transitions ) if ( t.kind === 'select' )
		gateFns[t.from] = (t.gates || []).map(( g ) => ({ to: g.to, fn: compileExpression(g.when, { empty: false }) }));

	const c = { steps: 0, taskCalls: 0, memoHits: 0, bypass: 0, fanOut: 0, routed: 0, done: 0, failed: 0 };

	while ( c.steps < fuel ) {
		const toks = store.claim(runId, { limit: batch, lease });
		if ( !toks.length ) break;                              // nothing claimable → fixpoint (or all in terminal places)
		for ( const t of toks ) {
			if ( c.steps >= fuel ) break;
			c.steps++;
			const tr = byFrom[t.placeId];
			if ( !tr ) { store.fail(t, 'no transition from place ' + t.placeId); c.failed++; continue; }

			if ( tr.kind === 'select' ) {
				let to = tr.fallback;
				for ( const g of gateFns[tr.from] ) if ( g.fn(( ref ) => resolveFact(t.payload, ref)) ) { to = g.to; break; }
				store.move(t, to); c.routed++;
				continue;
			}

			if ( tr.kind === 'map' ) {
				const coll = resolveFact(t.payload, tr.over);
				if ( !Array.isArray(coll) || !coll.length ) { store.move(t, tr.empty); continue; }
				const places = coll.map(() => tr.bodyStart);
				const payloads = coll.map(( elem, i ) => Object.assign({}, t.payload, { [tr.elemKey]: elem, _i: i }));
				store.move(t, places, { payloads }); c.fanOut += coll.length;
				continue;
			}

			// kind === 'task'
			if ( tr.task == null ) { store.move(t, tr.to); continue; }   // no-op passthrough (enter/noop)
			const key = keyOf(tr, t);
			let out;
			if ( key != null && (out = store.memoGet(key)) !== undefined ) {
				c.memoHits++;                                  // C5 replay — 0 model calls (cheap resume + amortization)
			} else {
				out = runTask(tr.task, t) || {};
				c.taskCalls++;
				if ( key != null ) store.memoSet(key, out); else c.bypass++;
			}
			store.move(t, tr.to, { payload: out.payload, created: out.created });
		}
	}

	const st = store.stats(runId);
	c.done = st.done; c.failed = st.failed;
	if ( c.steps >= fuel ) c.divergent = true;                 // fuel exhausted = a cutoff, NOT a semantic fixpoint
	return c;
}

module.exports = { runFlow, resolveFact, defaultKeyOf };
