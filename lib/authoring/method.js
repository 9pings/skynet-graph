/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * method — HIGHER-ORDER methods-as-graphs: a method receives a SUB-GRAPH as a typed named-slot parameter
 * and applies it (host-side, builds on `abstract.js`; engine-native splice via `pushMutation`). BRICK 1 of
 * the conception build (doc/WIP/studies/2026-06-28-concept-as-graph-conception-assembled.md §3 / C2).
 *
 * The parameter is FIRST-ORDER in mechanics: a body is a PARAMETERIZED template (holes from
 * `abstract.js#relativize`) bound BY NAME at a call site (`instantiate`) — never inferred. So "method takes
 * a sub-graph" is decidable substitution, not higher-order unification.
 *
 * Landmines respected: each application gets a FRESH id-base (finding #30 — else N applications collapse
 * onto one body via the existing-object merge path), the splice goes through the SEQUENCED `pushMutation`
 * (determinism), and an unbound frontier ref THROWS (a leak) rather than splicing an unsound partial.
 */
const { instantiate } = require('./abstract.js');

/**
 * Bind a parameterized body sub-graph to a NEW call site → a ground template. Throws on an unbound frontier
 * ref (a leak) — never returns a partially-bound template.
 * @param paramBody  parameterized template (holes via `relativize`)
 * @param ctx        { base, refs:{name:id} }  the call site (fresh base + the slot's frontier ids)
 * @returns the ground (bound) template
 */
function bindSubgraphArg( paramBody, ctx ) {
	const bound = instantiate(paramBody, ctx);
	if ( bound == null )
		throw new Error('applySubgraphArg: unbound frontier ref (leak) for refs=' + JSON.stringify((ctx && ctx.refs) || {}));
	return bound;
}

/**
 * Bind a body sub-graph into a call-site SLOT and splice it SEQUENCED under the slot (parented via
 * `_origin = targetId`).
 * @param graph
 * @param paramBody  the parameterized body
 * @param ctx        { base, refs } the call site (fresh base + frontier ids)
 * @param targetId   the slot object the splice mounts under (the parent)
 * @param cb         called once the splice settles
 * @returns the bound template
 */
function applySubgraphArg( graph, paramBody, ctx, targetId, cb ) {
	const bound = bindSubgraphArg(paramBody, ctx);
	graph.pushMutation(bound, targetId, false, undefined, undefined, cb);
	return bound;
}

/**
 * BUILD the MAP combinator's template (PURE — no graph mutation): apply a body sub-graph to EACH element of
 * a collection, each instance with its OWN fresh id-base (so N elements never collide onto one body, #30).
 * Returned as ONE combined template — a provider returns this via `cb` (the ENGINE applies it, parented under
 * the cast slot), or `mapSubgraph` pushes it directly.
 * @param opts.elements    [id]  the collection element node ids (the CASES)
 * @param opts.body        the parameterized body (the PARAM); frontier `elem` is bound to each element
 * @param opts.basePrefix  id-base prefix per element (default 'map' → map0, map1, …)
 * @param opts.refsOf      optional (elem,i) => extra frontier refs to bind besides `elem`
 * @returns the combined ground template (array)
 */
function mapTemplate( opts ) {
	opts = opts || {};
	const elements = opts.elements || [];
	const prefix = opts.basePrefix || 'map';
	const tpl = [];
	elements.forEach(function ( elem, i ) {
		const refs = Object.assign({ elem: elem }, opts.refsOf ? opts.refsOf(elem, i) : {});
		tpl.push.apply(tpl, bindSubgraphArg(opts.body, { base: prefix + i, refs: refs }));
	});
	return tpl;
}

/**
 * The MAP combinator, HOST-driven: build the fan-out template and splice it SEQUENCED under the slot.
 * (The ENGINE-driven form is a provider returning `mapTemplate(...)` — see method-subgraph.test.js.)
 * @param graph
 * @param opts     as `mapTemplate` + `opts.slotId` (the map segment the bodies mount under)
 * @param cb       called once the map settles
 * @returns the combined ground template
 */
function mapSubgraph( graph, opts, cb ) {
	const tpl = mapTemplate(opts);
	if ( !tpl.length ) { if ( cb ) setTimeout(cb); return tpl; }
	graph.pushMutation(tpl, opts.slotId, false, undefined, undefined, cb);
	return tpl;
}

module.exports = { applySubgraphArg, mapSubgraph, mapTemplate, bindSubgraphArg };
