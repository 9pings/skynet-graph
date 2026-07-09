/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * segment-proxy — THE SEGMENT-PROXY RÉACTIF (roadmap 2026-07-09 P2; ZERO-CORE, host-side). A concept-method mounted
 * as a reactive PROXY: it casts on its contract's cast-conditions, and AT CAST delegates its body to another instance
 * via the P1 bounded invoke (instead of expanding inline), ADMITS the bounded result through the P4 gate
 * (`assertPost`), and posts the summaryFacts as its own cast → JTMS-visible. The good C.8: an INTERFACE, not an
 * in-core COW object (KG-PROXY C proved the posted facts are re-evaluable, not a severing read-gate).
 *
 * The cast is the COST GRADIENT (contract.js §0.1): (1) delegate to the library method (the invoke), (2) gate the
 * result (assertPost), (3) LAST-RESORT LEARNING FALLBACK — on a hole / a gate refusal, an `forge` hook receives the
 * problem STACK reconstituted UP the parent chain (`reconstructStack`, BOUNDED to each level's typed interface — not
 * the prose) and may forge a method / adjust the slot qualification via the lattice. The forged method RE-ENTERS the
 * gate (propose→assertPost disposes→index back) — it is typed sub-graph, so determinism holds. The full `adapt`/
 * `crystallize` wiring of the fallback is the §5 plasticity layer; P2 provides the HOOK + the gate + the stack.
 *
 * Within one synchronous cast there is no extract→merge window, so the P4 assumption-recheck is not needed here (it
 * guards the async host-side flow); P2 reuses P4's assertPost GATE and returns the cast template via `cb` (the engine
 * applies it sequenced). GOTCHA respected: the template sets the proxy's own `<name>:true` cast marker.
 */
const { assertPost } = require('./contract.js');

/**
 * reconstructStack(graph, scope, opts) — reconstitute the bounded problem STACK by walking UP the `parentSeg` chain
 * (the projection sets `parentSeg` on every seeded segment). Collects each level's TYPED interface only (statement +
 * produces/needs), bounded by `maxDepth` — the reconstituted abstract context for a forge, WITHOUT the O(N) prose
 * blow-up (garde-fou 1: the separator-typed interface travels, not the raw context).
 * @returns [{ id, statement, produces, needs }]  (self first, root last)
 */
function reconstructStack( graph, scope, opts ) {
	opts = opts || {};
	const max = opts.maxDepth || 8;
	const stack = [], seen = new Set();
	let cur = scope && scope._, depth = 0;
	while ( cur && depth <= max ) {
		if ( cur._id == null || seen.has(cur._id) ) break;
		seen.add(cur._id);
		stack.push({ id: cur._id, statement: cur.statement, produces: cur.produces, needs: cur.needs });
		const pid = cur.parentSeg;
		if ( pid == null ) break;
		const pe = graph.getEtty ? graph.getEtty(pid) : null;
		cur = pe && pe._; depth++;
	}
	return stack;
}

/**
 * makeSegmentProxy(spec) — build a reactive proxy concept + its provider.
 * @param spec.name        the proxy concept name (its cast marker).
 * @param spec.ns          provider namespace (default 'Proxy').
 * @param spec.castWhen    extra require facts (besides Segment) that gate the cast (the contract's cast-conditions).
 * @param spec.contract    { read, write, pre, post, effect } — the method's typed contract (the P4 gate).
 * @param spec.methodMap   the concept map of the DELEGATE (the shared instance runs it).
 * @param spec.buildSeed   (scope, graph) => seed   build the invoke seed from the cast segment (the slot bindings).
 * @param spec.boundedFrom the delegate object id whose facts are the summary.
 * @param spec.boundedKeys Σ_sep — the frontier alphabet to cross (default = contract.write).
 * @param spec.invoke      (opts) => Promise<{summary,writeFootprint}>   the P1 invoke (default Graph.invokeGraph).
 * @param spec.oracle      G2 ground-truth probe for an effecting post.
 * @param spec.forge       ({scope, graph, contract, stack, reason, blame?}) => Promise<template>|template   the
 *                         last-resort learning fallback (§5). Receives the reconstituted parent stack.
 * @returns { conceptFragment, provider, name }
 */
function makeSegmentProxy( spec ) {
	spec = spec || {};
	const name = spec.name || 'Proxy';
	const ns = spec.ns || 'Proxy';
	const contract = spec.contract || {};
	const boundedKeys = spec.boundedKeys || contract.write || [];
	// invoke = the P1 wire. With a P3 pool, key it by libraryKey → N casts reuse ONE warm instance; else one-shot invokeGraph.
	const libraryKey = spec.libraryKey || name;
	const invoke = spec.invoke || (spec.pool ? ( iopts ) => spec.pool.invoke(libraryKey, iopts) : require('../index.js').invokeGraph);

	const conceptFragment = { [name]: { _id: name, _name: name,
		require: ['Segment'].concat(spec.castWhen || []), provider: [ ns + '::delegate' ] } };

	function delegate( graph, concept, scope, argz, cb ) {
		(async () => {
			// the fallback: reconstitute the stack from the parents, forge under the gate; else a typed refusal.
			const fallback = async ( reason, blame ) => {
				if ( typeof spec.forge === 'function' ) {
					const stack = reconstructStack(graph, scope, spec);
					const t = await spec.forge({ scope, graph, contract, stack, reason, blame });
					return t;                                                        // the forge returns a cast template (typed sub-graph)
				}
				return [ { $_id: '_parent', [name]: true, proxyRefused: (blame && blame.kind) || reason } ];
			};

			let seed;
			try { seed = spec.buildSeed(scope, graph); }
			catch ( e ) { return cb(null, await fallback('build-failed', { kind: e.message })); }

			// (1) DELEGATE via the P1 bounded invoke to another instance (not expand inline).
			let result;
			try { result = await invoke({ conceptMap: spec.methodMap, seed, boundedFrom: spec.boundedFrom, boundedKeys, settleTimeout: spec.settleTimeout }); }
			catch ( e ) { return cb(null, await fallback('invoke-failed', { kind: e.message })); }

			// (2) GATE the bounded result (P4 assertPost: G1 frame via the write-footprint · post-holds · G2 oracle).
			const post = assertPost(contract, result.summary || {}, result.writeFootprint || [], { oracle: spec.oracle });
			if ( !post.ok ) return cb(null, await fallback('gate-refused', post.blame));   // (3) last-resort learning fallback

			// admit — post the summaryFacts as this proxy's cast (JTMS-visible) + the cast marker.
			cb(null, [ Object.assign({ $_id: '_parent', [name]: true }, result.summary || {}) ]);
		})().catch(( e ) => cb(e));
	}

	return { conceptFragment, provider: { [ns]: { delegate } }, name };
}

module.exports = { makeSegmentProxy, reconstructStack };
