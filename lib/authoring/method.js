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
const { instantiate, refHolesOf } = require('./abstract.js');

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

// ---------------------------------------------------------------------------- the method LINT (Brick 2)

// kinds we treat as K1-typed slot containers; anything else (incl. these prose markers) is a memo footgun.
const TYPED_KINDS = new Set(['enum', 'id', 'number', 'bool', 'list', 'subgraph']);
const PROSE_TYPES = new Set(['prose', 'text', 'string', 'str', 'freetext', 'free-text']);

// the fact keys a pre/post entry touches: the $refs it mentions, or — if it is a bare key (no $) — itself.
function frameKeys( entries ) {
	const keys = new Set();
	for ( const e of (entries || []) ) {
		if ( typeof e !== 'string' ) continue;
		const refs = e.match(/\$\$?([A-Za-z_][\w.:]*)/g);
		if ( refs ) refs.forEach(( r ) => keys.add(r.replace(/^\$\$?/, '')));
		else keys.add(e.trim());
	}
	return keys;
}

const isTypedName = ( t, opts ) =>
	typeof t === 'string' && t.length > 0 && !PROSE_TYPES.has(t.toLowerCase()) &&
	(!opts || !opts.types || opts.types.indexOf(t) >= 0);

/**
 * lintMethod — enforce the decidability invariants + the footprint/frame check on a METHOD DEFINITION, so the
 * "decidable line" is CHECKED, not emergent (design doc §3 / C4). Mirrors `validate.js`: `{ errors, warnings }`
 * with records `{ method, kind, message, slot? }`. Errors = a method that breaks an invariant; an uncontracted
 * method is a WARNING (the cost gradient — a runtime micro-LLM fallback, §0.1), not an error.
 *
 * @param def   { name, slots:{ <name>:{ role:'param'|'case', kind, frontier?, in?, out?, elem? } }, body?, contract? }
 * @param opts  { types? }  optional host type-alphabet — if given, slot type names must be in it.
 */
function lintMethod( def, opts ) {
	opts = opts || {};
	const errors = [], warnings = [];
	const method = (def && def.name) || '?';
	const err = ( kind, message, slot ) => errors.push({ method, kind, message, slot });
	const slots = (def && def.slots) || {};
	const used = def && def.body != null ? refHolesOf(def.body) : null;

	for ( const name of Object.keys(slots) ) {
		const s = slots[name] || {};
		if ( !name ) { err('unnamed-slot', 'a slot has an empty name'); continue; }                 // (a)
		if ( s.infer ) err('inference-slot', `slot "${name}" is infer:true — a body is SUPPLIED, never solved-for (undecidable)`, name);   // (c)
		if ( !TYPED_KINDS.has(s.kind) )                                                              // (b) K1
			err('prose-slot', `slot "${name}" kind "${s.kind}" is not K1-typed — a prose/untyped key re-keys every run (memo death)`, name);
		if ( s.kind === 'subgraph' ) {
			if ( !isTypedName(s.in, opts) || !isTypedName(s.out, opts) )                             // (b) typed interface
				err('prose-interface', `sub-graph slot "${name}" has a non-typed in/out interface (in=${s.in}, out=${s.out})`, name);
			if ( s.role === 'param' && !('frontier' in s) )                                          // (c) supplied
				err('unbound-param', `param sub-graph slot "${name}" has no frontier — it must be supplied by binding, not inferred`, name);
			if ( 'frontier' in s && !Array.isArray(s.frontier) )                                     // (d) fixed tentacles
				err('variable-tentacles', `slot "${name}" frontier must be a FIXED array, got ${JSON.stringify(s.frontier)}`, name);
			if ( Array.isArray(s.frontier) && used )                                                 // (c2) decl ↔ impl
				lintFrontierMatch(s.frontier, used, name, err);
		}
		if ( s.kind === 'list' && !isTypedName(s.elem, opts) )                                       // (b) typed elem
			err('untyped-collection', `collection slot "${name}" has no typed elem type (got ${JSON.stringify(s.elem)})`, name);
	}

	const c = def && def.contract;                                                                   // (e) frame
	if ( !c ) {
		warnings.push({ method, kind: 'uncontracted', message: `method "${method}" declares no contract — composition falls back to a runtime micro-LLM (cost gradient, §0.1)` });
	} else {
		const read = new Set(c.read || []), write = new Set(c.write || []);
		for ( const k of frameKeys(c.post) ) if ( !write.has(k) )
			err('frame-violation', `postcondition key "${k}" is outside the declared write-footprint {${[...write].join(', ')}}`);
		for ( const k of frameKeys(c.pre) ) if ( !read.has(k) )
			err('frame-violation', `precondition key "${k}" is outside the declared read-footprint {${[...read].join(', ')}}`);
	}
	return { errors, warnings };
}

function lintFrontierMatch( frontier, used, name, err ) {
	const declared = new Set(frontier);
	for ( const d of declared ) if ( !used.has(d) )
		err('frontier-mismatch', `slot "${name}" declares frontier ref "${d}" the body never uses`, name);
	for ( const u of used ) if ( !declared.has(u) )
		err('frontier-mismatch', `the body uses ref "${u}" not declared in slot "${name}" frontier`, name);
}

module.exports = { applySubgraphArg, mapSubgraph, mapTemplate, bindSubgraphArg, lintMethod };
