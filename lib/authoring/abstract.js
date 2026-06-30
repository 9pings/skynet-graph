/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * abstract — ABSTRACTIVATION of a STRUCTURAL method (host-side, ZERO-CORE). The F6 slice the
 * decisive-experiment gate green-lit (study `doc/WIP/studies/2026-06-27-concept-as-graph-adaptive-
 * mount-abstraction.md` §8 / U1; finding #30).
 *
 * THE PROBLEM (#30). The derivation cache (`providers/cache.js`) replays a stored mutation TEMPLATE
 * verbatim. A LEAF template is id-RELATIVE (`$_id:'_parent'`) so a different RECORD of the same canonical
 * class replays soundly (method-instance.js: cost→0). But a STRUCTURAL template — one that CREATES a
 * sub-graph (an intermediate node + child segments) — bakes ABSOLUTE object ids at derivation time
 * (`base+'_m0'`, `originNode:'S'`, where `base = seg._id`). Replaying THAT verbatim in a DIFFERENT problem
 * injects the wrong id-space → unsound / a crash in `Segment._onOriginChange`. So flat caching transfers
 * structural decisions only across EXACT-structure repeats (same id-space), never related-but-different
 * problems. Cross-problem STRUCTURAL transfer needs PARAMETERIZED / relative templates.
 *
 * THE FIX (anti-unification + splice-time binding). A structural template is the LEAST GENERAL
 * GENERALIZATION (Plotkin 1970 LGG) of its ground instances: the differing parts are HOLES, the shared
 * skeleton is kept. Two kinds of hole:
 *   - STRUCTURAL holes — created ids derived from the cast object's id (`base+suffix`) and the FRONTIER
 *     refs the template consumes (the call-site endpoints, e.g. `originNode`/`targetNode`). These are
 *     bound DETERMINISTICALLY from the new call site at replay → free, sound, no model call.
 *   - CONTENT holes — the typed payload the model derived (the intermediate state/kind/role). These are
 *     the CACHED PAYLOAD, replayed verbatim. They are sound to replay IFF the cache KEY is the K1-canonical
 *     TYPED signature that determines them (the canonicalization barrier) — never raw prose.
 *
 * So: `relativize(tpl, ctx)` rewrites a ground structural template into a PARAMETERIZED one (store time);
 * `instantiate(paramTpl, ctx')` binds the holes to a NEW call site (replay time); `antiUnify(A, B)` checks
 * that two ground derivations of the same signature generalize to the SAME skeleton (the soundness /
 * crystallization check — the study's "≥2 ground derivations → one schema"). `methodTransform(spec)`
 * packages these as the generic `{onStore,onReplay}` hooks that `providers/cache.js#wrap` accepts, so a
 * STRUCTURAL provider gets cross-problem transfer with no change to the cache or the grammar.
 *
 *   const { methodTransform } = require('./abstract');
 *   const T = methodTransform({ frontier: { origin: 'originNode', target: 'targetNode' } });
 *   Graph._providers = cache.wrapFragment({ P: { plan } }, { 'P::plan': planSigKey }, { 'P::plan': T });
 *   //                                      key on the TYPED signature ^^^^^^^^^^     transform ^^^
 */

// sentinels for the two hole kinds, embedded INSIDE id-valued strings. The ⟦ ⟧ brackets are OUT of the id
// alphabet ([A-Za-z0-9_-]: shortid + authored ids), so a sentinel can never collide with a real id token —
// and they are HUMAN-READABLE: these holes appear in mutation templates, so prefer legible over opaque (an
// opaque/byte sentinel would only be justified for a numeric payload — weights/float vectors — not here).
const BASE = '⟦@base⟧';                                      // created-id prefix: BASE + suffix  (suffix '' = the base id itself)
const REF  = ( name ) => '⟦@ref:' + name + '⟧';              // a frontier ref hole, bound to a call-site id
const REF_RE = /^⟦@ref:(.+)⟧$/;

function isStr( x ) { return typeof x === 'string'; }

/**
 * Rewrite ONE id-valued string into its parameterized form, given the call-site `ctx`.
 *   ctx.base        the cast object's id (= scope._._id); created ids are `base` or `base+suffix`.
 *   ctx.refs        { name: idValue } the frontier ids the template consumes (endpoints, parent, …).
 * A value that is neither base-derived nor a known frontier ref is left LITERAL (it is content payload).
 * NB: refs are matched FIRST (exact) so a frontier id is never mistaken for a base-derived id; a frontier
 * ref never equals `base` (the cast object is not its own endpoint), so the order is unambiguous.
 */
function relativizeVal( v, ctx ) {
	if ( !isStr(v) ) return v;
	for ( const name in ctx.refs ) if ( ctx.refs[name] === v ) return REF(name);
	if ( v === ctx.base ) return BASE;
	if ( ctx.base && v.indexOf(ctx.base + '_') === 0 ) return BASE + v.slice(ctx.base.length);
	return v;
}

// the inverse: bind a parameterized id-valued string to a NEW call site `ctx`. Returns `undefined` if a
// required frontier ref is unbound in the new ctx (caller treats that as a BYPASS — never a wrong replay).
function instantiateVal( v, ctx, miss ) {
	if ( !isStr(v) ) return v;
	const m = REF_RE.exec(v);
	if ( m ) { const name = m[1]; if ( !(name in ctx.refs) || ctx.refs[name] == null ) { miss.bad = true; return v; } return ctx.refs[name]; }
	if ( v.indexOf(BASE) === 0 ) return ctx.base + v.slice(BASE.length);
	return v;
}

// walk a template (array | object | scalar) applying a per-string-value transform. Object KEYS are
// structural (`_id`, `$_id`, `originNode`, …), never data ids, so only VALUES are transformed. `'_parent'`
// (the cast-target alias) is already relative and matches nothing → passes through untouched.
function mapValues( tpl, fn ) {
	if ( Array.isArray(tpl) ) return tpl.map(( x ) => mapValues(x, fn));
	if ( tpl && typeof tpl === 'object' ) {
		const out = {};
		for ( const k in tpl ) out[k] = mapValues(tpl[k], fn);
		return out;
	}
	return fn(tpl);
}

/** Ground structural template + call-site ctx → PARAMETERIZED template (holes for ids/refs). */
function relativize( tpl, ctx ) {
	ctx = ctx || {}; ctx.refs = ctx.refs || {};
	return mapValues(tpl, ( v ) => relativizeVal(v, ctx));
}

/**
 * PARAMETERIZED template + a NEW call-site ctx → GROUND template (ids rebased, frontier refs rebound).
 * Returns `null` if any frontier ref hole is unbound in the new ctx (the caller bypasses to a fresh call).
 */
function instantiate( paramTpl, ctx ) {
	ctx = ctx || {}; ctx.refs = ctx.refs || {};
	const miss = { bad: false };
	const out = mapValues(paramTpl, ( v ) => instantiateVal(v, ctx, miss));
	return miss.bad ? null : out;
}

/** True iff a template still carries hole sentinels (i.e. it is a parameterized, not-yet-bound form). */
function hasHoles( tpl ) {
	let found = false;
	mapValues(tpl, ( v ) => { if ( isStr(v) && (v.indexOf(BASE) === 0 || REF_RE.test(v)) ) found = true; return v; });
	return found;
}

/** Deterministic, key-sorted, recursive stringify (for skeleton equality). */
function canon( x ) {
	if ( x === undefined ) return 'null';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(canon).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}

/**
 * Plotkin LGG (1970) over the engine's typed templates — the study's "≥2 ground derivations → one schema"
 * SOUNDNESS / crystallization check. Relativize TWO ground derivations (each with its own call-site ctx —
 * so ids/refs already align as STRUCTURAL holes), then compute their least general generalization: where
 * the two agree, keep the literal; where they DIFFER at a leaf, introduce a CONTENT variable; where the
 * TREE SHAPE differs (different keys / array length / object-vs-scalar), they do not generalize.
 *
 * `stable` = the two are SHAPE-COMPATIBLE (one structural skeleton; all differences are content leaves).
 * That justifies treating them as ONE parameterized method: the structural holes bind from the call site
 * (`instantiate`), the content variables are what the cache KEY must determine (the K1 signature — a
 * content var that is NOT a function of the typed key is a false-hit risk, the canonicalize.js line).
 * A shape mismatch ⇒ NOT one abstraction (don't crystallize them together).
 *
 * @returns { stable, skeleton, contentVars, shapeDiffs }
 *   skeleton    the LGG: structural holes + `{ '§var': path }` at each content leaf (documentation / gate input)
 *   contentVars [{ path, a, b }]  the per-instance-varying leaves (cache-key obligations)
 *   shapeDiffs  [path]            positions where the tree shape itself differs (empty ⇔ stable)
 */
function antiUnify( groundA, ctxA, groundB, ctxB ) {
	const sa = relativize(groundA, ctxA), sb = relativize(groundB, ctxB);
	const acc = { contentVars: [], shapeDiffs: [] };
	const skeleton = lgg(sa, sb, '', acc);
	return { stable: acc.shapeDiffs.length === 0, skeleton: acc.shapeDiffs.length === 0 ? skeleton : null,
		contentVars: acc.contentVars, shapeDiffs: acc.shapeDiffs };
}

// least general generalization of two (already structurally-relativized) values.
function lgg( a, b, path, acc ) {
	if ( canon(a) === canon(b) ) return a;                          // agree → keep the literal/skeleton
	const oa = a && typeof a === 'object', ob = b && typeof b === 'object';
	if ( !oa || !ob || Array.isArray(a) !== Array.isArray(b) ) {    // leaf disagreement OR object-vs-scalar
		if ( oa || ob ) { acc.shapeDiffs.push(path); return null; } //   shape mismatch (one side has structure)
		acc.contentVars.push({ path, a, b }); return { '§var': path };  // both scalars, differ → content variable
	}
	if ( Array.isArray(a) ) {
		if ( a.length !== b.length ) { acc.shapeDiffs.push(path); return null; }
		return a.map(( x, i ) => lgg(x, b[i], path + '[' + i + ']', acc));
	}
	const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
	if ( canon(ka) !== canon(kb) ) { acc.shapeDiffs.push(path); return null; }   // different field sets → shape mismatch
	const out = {};
	for ( const k of ka ) out[k] = lgg(a[k], b[k], path ? path + '.' + k : k, acc);
	return out;
}

/**
 * Read the call-site ctx (base + frontier refs) off a provider `scope`, per a declarative `spec`.
 *   spec.frontier   { name: factKey | "ref:path" }  — where each frontier id lives on the cast object.
 *                   A bare factKey reads `scope._[factKey]`; a "a:b" path resolves via `scope.getRef`.
 *   spec.base       optional fact key for the base id (default the cast object's own `_id`).
 * Returns null if the base id is unknown (→ the transform bypasses, never an unsound store/replay).
 */
function ctxFromScope( scope, spec ) {
	spec = spec || {};
	const f = (scope && scope._) || {};
	const base = spec.base ? f[spec.base] : f._id;
	if ( base == null ) return null;
	const refs = {};
	const frontier = spec.frontier || {};
	for ( const name in frontier ) {
		const where = frontier[name];
		let v;
		if ( isStr(where) && where.indexOf(':') >= 0 ) {            // a cross-object ref path
			try { const r = scope.getRef ? scope.getRef(where) : undefined; v = (r && r._ && r._._id !== undefined) ? r._._id : (r && r._id !== undefined ? r._id : r); } catch ( e ) { v = undefined; }
		} else {
			v = f[where];
		}
		refs[name] = v;
	}
	return { base, refs };
}

/**
 * Package relativize/instantiate as the generic `{onStore,onReplay}` transform that
 * `providers/cache.js#wrap(fn, keyFn, transform)` accepts:
 *   - onStore(groundTpl, {scope})  → PARAMETERIZED form to store (or null = don't store: not transfer-safe).
 *   - onReplay(paramTpl, {scope})  → GROUND form bound to the new call site (or null = bypass to a fresh call).
 * The cold call still returns its own ground template unchanged; only the STORED form is parameterized,
 * and only a HIT is re-bound — so the cold derivation is never perturbed.
 */
function methodTransform( spec ) {
	spec = spec || {};
	return {
		onStore: function ( tpl, info ) {
			const ctx = ctxFromScope(info && info.scope, spec);
			if ( !ctx ) return null;                                // unknown call site → don't store (no unsound future replay)
			const param = relativize(tpl, ctx);
			// only worth storing parameterized if it actually generalized (else it's a flat template under a
			// shared signature key → would leak on replay). Require at least one hole.
			return hasHoles(param) ? param : null;
		},
		onReplay: function ( paramTpl, info ) {
			const ctx = ctxFromScope(info && info.scope, spec);
			if ( !ctx ) return null;                                // unknown call site → bypass (fresh call)
			return instantiate(paramTpl, ctx);                      // null if a frontier ref is unbound → bypass
		}
	};
}

/**
 * EMIT-METHOD-AS-SUBGRAPH (study §8 / U1a), built on the ENGINE-NATIVE serializer `Graph#getMutationFromPath`.
 *
 * `relativize`/`instantiate` are the domain-agnostic GENERALIZATION of a pattern the engine already proved
 * in production (the epikeo/aetheris travel-path mounting: `MapPaths` normalizes a discovered sub-graph's
 * endpoints to the FORMAL ids 'start'/'target' and serializes it into `OpenPaths`; `pushPath`/`MountPaths`
 * re-mount it, BINDING the formal frontier back to the call site — `tpl[0].originNode = scope._.originNode`,
 * `relatedTpl.map(m => ({...m, $_id:'$'+m._id}))`). `getMutationFromPath` is the serializer that turns a
 * graph fragment into a mutation TEMPLATE (bagRef→`$$` refs, strips `_rev`).
 *
 * This helper closes the loop: take a DERIVED method's sub-graph (the objects a structural cast created),
 * serialize it through the engine primitive, and relativize it into a re-mountable PARAMETERIZED method —
 * so a method is a re-mountable graph (the study's U1a), not only a cached opaque provider output. Bind it
 * at a new call site with `instantiate(...)` and apply via `graph.pushMutation(bound, targetId, …)`.
 *
 * @param graph    the graph holding the derived sub-graph
 * @param subIds   the ids of the method's emitted objects (the created intermediate nodes + child segments)
 * @param ctx      { base, refs:{name:idValue} } — the derivation call site (as for `relativize`)
 * @returns the PARAMETERIZED method template (holes for ids/frontier refs), or null if a sub-id is missing.
 */
function emitMethodAsSubgraph( graph, subIds, ctx ) {
	const path = [];
	for ( const id of subIds || [] ) {
		const e = graph.getEtty ? graph.getEtty(id) : (graph._objById && graph._objById[id] && graph._objById[id]._etty);
		if ( !e || !e._ ) return null;
		path.push(Object.assign({}, e._));
	}
	if ( !path.length ) return null;
	const tpl = graph.getMutationFromPath ? graph.getMutationFromPath(path, [], null) : path;   // engine-native serialize
	return relativize(tpl, ctx);
}

/**
 * CONTENT-HOLE GENERALIZATION (the adapt operator — "conceptual blending" / Fauconnier-Turner via Plotkin LGG).
 * Given ≥2 parameterized templates of ONE method (its `templatesBySig` values — same structural skeleton, content
 * differing per signature class), discover WHICH leaves are CONTENT (vary across the instances) vs the SKELETON
 * (shared, kept verbatim — both the structural `⟦@…⟧` holes and the agreeing literals). It is `antiUnify` folded
 * over the set: the union of every pairwise content-var path. The result is a skeleton with a `{'§var': path}`
 * CONTENT HOLE at each varying leaf — so a controller can forge ONLY those holes for a new signature and reuse the
 * skeleton, instead of re-forging the whole method (the v0 demo's hard-coded "swap the `state` field" → principled).
 *
 * @param templates  array of ≥2 parameterized templates (already relativized — structural holes are literal here).
 * @returns { stable, skeleton, contentVars:[{path}] }  stable=false if a template's SHAPE differs from the first
 *          (then it is excluded from the union) or there are <2 templates; contentVars empty ⇒ nothing to forge.
 */
function generalizeContent( templates ) {
	const ts = (templates || []).filter(Boolean);
	if ( ts.length < 2 ) return { stable: false, skeleton: ts[0] || null, contentVars: [] };
	const paths = new Set();
	let stable = true;
	for ( let i = 1; i < ts.length; i++ ) {
		const au = antiUnify(ts[0], {}, ts[i], {});   // ctx={} → no further relativization; compare the parameterized forms
		if ( !au.stable ) { stable = false; continue; }   // a shape-incompatible template can't share this skeleton
		for ( const cv of au.contentVars ) paths.add(cv.path);
	}
	return { stable, skeleton: holePaths(ts[0], paths, ''), contentVars: [...paths].map(( p ) => ({ path: p })) };
}

// rewrite the leaves at `paths` into `{'§var': path}` content holes; path format MIRRORS lgg's (array `[i]`,
// object `k` / `parent.k`) so the holes line up with `generalizeContent`'s contentVars.
function holePaths( tpl, paths, path ) {
	if ( paths.has(path) ) return { '§var': path };
	if ( Array.isArray(tpl) ) return tpl.map(( x, i ) => holePaths(x, paths, path + '[' + i + ']'));
	if ( tpl && typeof tpl === 'object' ) { const o = {}; for ( const k in tpl ) o[k] = holePaths(tpl[k], paths, path ? path + '.' + k : k); return o; }
	return tpl;
}

/** Fill a content-hole skeleton (from `generalizeContent`) with forged values keyed by hole path → a parameterized
 *  template (structural holes still present, to be `instantiate`d at the call site). Returns null if any content
 *  hole was NOT forged (a partial forge must never silently bake an `undefined` leaf). */
function fillContentHoles( skel, valuesByPath ) {
	let missing = false;
	const walk = ( x ) => {
		if ( Array.isArray(x) ) return x.map(walk);
		if ( x && typeof x === 'object' ) {
			if ( '§var' in x && Object.keys(x).length === 1 ) { const p = x['§var']; if ( !valuesByPath || !(p in valuesByPath) ) { missing = true; return x; } return valuesByPath[p]; }
			const o = {}; for ( const k in x ) o[k] = walk(x[k]); return o;
		}
		return x;
	};
	const out = walk(skel);
	return missing ? null : out;
}

/** Collect the frontier-ref hole NAMES a parameterized template uses (reuses THIS module's REF_RE, so the
 *  sentinel format stays in ONE place — callers never re-derive it). Returns a Set of names. */
function refHolesOf( tpl, out ) {
	out = out || new Set();
	mapValues(tpl, function ( v ) { var m = isStr(v) && REF_RE.exec(v); if ( m ) out.add(m[1]); return v; });
	return out;
}

module.exports = {
	relativize, instantiate, antiUnify, hasHoles, methodTransform, ctxFromScope,
	emitMethodAsSubgraph, refHolesOf, BASE, REF, canon,
	generalizeContent, fillContentHoles
};
