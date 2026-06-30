/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * mine — sub-forest mining for crystallization (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-26-…, the #13 loop core).
 *
 * Inventing a nonterminal for a recurring sub-derivation = SUBDUE/SEQUITUR on the engine's
 * derivation forest. `mineChains` reads a corpus of apply-records (the `onConceptApply`
 * trace: `{concept, target}` firings) plus the concept schemas, and finds frequent
 * producer->consumer edges A->B (B `require`s a fact A produces, and both fired on the same
 * target). The top edges are candidate abstractions; `composeProviders` chains the
 * constituents' providers into one (threading each output into the next), so the proposed
 * abstract method can be measured by the MDL/utility gate (`abstraction.evaluate`).
 *
 *   const chains = mineChains(applyRecords, conceptTree);     // [{from,to,via,count}, …]
 *   const M = composeProviders(provA, provB);                 // one cast does both
 *   // -> evaluate({chainTree, abstractTree:{…M…}, …}) decides admission.
 *
 * `mineChains` keys only on STATIC produced facts (self-flag + applyMutations template keys
 * — the same extraction validate.js uses); provider-written facts are not statically known,
 * so the mined edge is the self-flag/template producer->consumer chain (the auditable spine).
 */
const { eachConcept, refsOf, refKeyOf, templateKeys } = require('./validate.js');
const { relativize, antiUnify, canon, hasHoles, emitMethodAsSubgraph, BASE } = require('./abstract.js');
const { memoSurfaceKeys } = require('./memo-stability.js');
const { digest } = require('../providers/canonicalize.js');

/**
 * Find frequent producer->consumer concept chains in a trace corpus.
 * @param records  [{ concept, target }]   apply-records (onConceptApply firings)
 * @param tree     the concept tree (for static produces/requires)
 * @returns [{ from, to, via, count }]  sorted by co-firing count (desc)
 */
function mineChains( records, tree ) {
	const concepts = [];
	eachConcept(tree, (c) => { if ( c._name ) concepts.push(c); });

	const produces = {}, requires = {};
	for ( const c of concepts ) {
		const schema = c._schema || c;
		produces[c._name] = new Set([c._name, ...templateKeys(schema.applyMutations)]);
		requires[c._name] = refsOf(schema.require, false).map((r) => refKeyOf(r).key);
	}

	const firedOn = {};                          // concept -> Set(target)
	for ( const r of (records || []) ) {
		if ( !r || !r.concept ) continue;
		(firedOn[r.concept] = firedOn[r.concept] || new Set()).add(r.target);
	}

	const out = [];
	for ( const A of concepts ) for ( const B of concepts ) {
		if ( A === B ) continue;
		let via = null;
		for ( const f of (requires[B._name] || []) )
			if ( produces[A._name] && produces[A._name].has(f) ) { via = f; break; }
		if ( !via ) continue;
		const tA = firedOn[A._name] || new Set(), tB = firedOn[B._name] || new Set();
		let count = 0;
		for ( const t of tA ) if ( tB.has(t) ) count++;
		if ( count > 0 ) out.push({ from: A._name, to: B._name, via, count });
	}
	out.sort((x, y) => y.count - x.count);
	return out;
}

/**
 * Chain N cb-style providers into one. Each provider's output facts are threaded into a
 * shadow scope for the next, and all output facts are merged into a single `_parent`
 * template — so one cast reproduces the whole chain (the inlined abstract method).
 * @param  {...Function} fns  providers `(graph, concept, scope, argz, cb)` -> cb(err, template)
 * @returns Function          a single provider with the same signature
 */
function composeProviders( ...fns ) {
	return function ( graph, concept, scope, argz, cb ) {
		const merged = {};
		const shadowFacts = Object.assign({}, (scope && scope._) || {});
		let i = 0;
		(function step() {
			if ( i >= fns.length ) {
				// the composed concept must mark ITS OWN self-flag cast (a provider concept
				// writes its self-flag in its template, else the engine never sees it cast and
				// re-fires it to the apply-cap). The constituents' flags are merged data facts.
				if ( concept && concept._name ) merged[concept._name] = true;
				return cb(null, Object.assign({ $_id: '_parent' }, merged));
			}
			const fn = fns[i++];
			const shadowScope = { _: shadowFacts, getRef: scope && scope.getRef ? scope.getRef.bind(scope) : undefined };
			fn(graph, concept, shadowScope, argz, function ( err, tpl ) {
				if ( err ) return cb(err);
				const objs = Array.isArray(tpl) ? tpl : (tpl ? [tpl] : []);
				for ( const o of objs ) {
					if ( !o || typeof o !== 'object' ) continue;
					for ( const raw of Object.keys(o) ) {
						if ( raw === '$_id' || raw === '$$_id' || raw === '_id' ) continue;
						const key = raw.replace(/^\$+/, '');
						merged[key] = o[raw];
						shadowFacts[key] = o[raw];
					}
				}
				step();
			});
		})();
	};
}

/** Normalize engine trace records (cfg.onConceptApply `_rec`) into mineChains input. */
function recordsFromTrace( rawRecords ) {
	return (rawRecords || [])
		.filter((r) => r && r.conceptName)
		.map((r) => ({ concept: r.conceptName, target: r.targetId }));
}

/**
 * A trace collector you plug into `cfg.onConceptApply` (or `graph.on('conceptApply', …)`),
 * then mine the accumulated firings. Keeps the corpus off the graph (host-side), so the
 * miner runs offline/between-episodes — never mid-stabilize.
 *   const miner = traceMiner();
 *   new Graph(seed, { …, onConceptApply: miner.onConceptApply }, conceptMap);
 *   const chains = miner.chains(conceptTree);   // [{from,to,via,count}, …]
 */
function traceMiner() {
	const records = [];
	return {
		records,
		onConceptApply: function ( rec ) { if ( rec && rec.conceptName ) records.push({ concept: rec.conceptName, target: rec.targetId }); },
		chains: function ( tree ) { return mineChains(records, tree); },
	};
}

// ─────────────────────────────── STRUCTURAL method mining (Gap B+D — the antiUnify-in-the-loop) ───────────────
//
// `mineChains` finds frequent producer->consumer EDGES (the spine of the provider-fusion crystallizer). For a
// STRUCTURAL method — one cast that CREATES a sub-graph (intermediate node + child segments) — the recurrence and
// the soundness check live at the level of the ground mutation TEMPLATE, not the static edge: a structural concept
// fires on N call sites, each producing a ground patch; the method is sound to crystallize iff those patches all
// generalize to ONE stable skeleton (Plotkin LGG, `abstract.antiUnify`) whose content leaves are a function of the
// firing's typed K1 signature (the canonicalization barrier — a content leaf NOT determined by the signature is the
// prose case, REFUSE). `mineMethods` is that check, a pure function over the enriched trace.

// engine bookkeeping that rides in a captured `rec.patch` (the serialized `_revs[r].tpl`) but is NOT method content:
// `_rev` is a per-apply monotonic counter (would falsely read as a content-var that varies on every firing — the
// probe that built this caught it), `_origin` is the creating-apply id (base-derived, redundant). Strip both before
// relativize/antiUnify so the skeleton is the method, not the bookkeeping. (`getMutationFromPath` strips `_rev` too.)
const SYS_KEYS = new Set(['_rev', '_origin']);

// `extra` (optional Set) = DECLARED prose/untracked keys (the model's free text). They ride in the cast
// patch but, like the canonicalization barrier in `llm.js` keeps prose out of the FactsDigest, they must be
// kept OFF the mined surface — prose varies per instance, so leaving it in would falsely read as a content-var
// and break signature-determination (the K1 "prose stays in the model" line). Stripping them lets the typed
// STRUCTURE crystallize while the prose stays per-instance (never baked into the method).
function stripPatch( x, extra ) {
	if ( Array.isArray(x) ) return x.map(( e ) => stripPatch(e, extra));
	if ( x && typeof x === 'object' ) {
		const out = {};
		for ( const k of Object.keys(x) ) if ( !SYS_KEYS.has(k) && !(extra && extra.has(k)) ) out[k] = stripPatch(x[k], extra);
		return out;
	}
	return x;
}

// every id this patch CREATES (its `$$_id`/`$_id`/`_id` values; `_parent` resolves to the base) — so the frontier
// inference never mistakes a created child for a call-site endpoint.
function createdIds( patch, base ) {
	const ids = new Set([base]);
	for ( const o of (Array.isArray(patch) ? patch : [patch]) ) {
		if ( !o || typeof o !== 'object' ) continue;
		for ( const k of ['$$_id', '$_id', '_id'] ) {
			const v = o[k];
			if ( typeof v === 'string' ) ids.add(v === '_parent' ? base : v.replace(/^\$+/, ''));
		}
	}
	return ids;
}

// walk a template's string VALUES with their immediate object KEY, in a deterministic (array-index, then
// sorted-key) order. `key` is the nearest object field the value sits under (an array carries its parent key).
function eachKeyedValue( tpl, fn, key ) {
	if ( Array.isArray(tpl) ) { for ( const x of tpl ) eachKeyedValue(x, fn, key); return; }
	if ( tpl && typeof tpl === 'object' ) { for ( const k of Object.keys(tpl).sort() ) eachKeyedValue(tpl[k], fn, k); return; }
	if ( typeof tpl === 'string' ) fn(key, tpl);
}

/**
 * Read the call-site ctx ({ base, refs, fields }) off a GROUND structural patch: the base is the cast target; a
 * frontier ref is an id-valued string that (a) is not the base, (b) is not created by this patch, (c) names an
 * EXISTING external object (∈ knownIds). Each distinct external id gets a deterministic name `f<i>` in scan order, so
 * two structurally-identical firings produce ALIGNED parameterized forms (the same endpoint → the same hole name →
 * antiUnify sees a structural hole, not a content diff). `fields[name]` records WHICH object field that endpoint sat
 * under (e.g. `originNode`) so the crystallized provider can re-read it off a new call site (`ctxFromScope`). A value
 * that is none of these is left LITERAL (it is content payload).
 */
function inferCtx( patch, base, knownIds ) {
	const created = createdIds(patch, base);
	const refs = {}, fields = {}, seen = new Map();
	let n = 0;
	eachKeyedValue(patch, ( key, v ) => {
		if ( v === base || created.has(v) ) return;
		if ( base && v.indexOf(base + '_') === 0 ) return;        // base-derived created id
		if ( knownIds && !knownIds.has(v) ) return;               // not a real external object → content, leave literal
		if ( !seen.has(v) ) { const name = 'f' + (n++); seen.set(v, name); refs[name] = v; fields[name] = key; }
	});
	return { base, refs, fields };
}

// ─────────────────────────────── DECLARED frontier (Phase 1: INFERRED → DECLARED) ─────────────────────────────
//
// `inferCtx` GUESSES the frontier by scanning the literal-id surface (a value ∈ knownIds, not base/created). That
// breaks the moment an endpoint is wired by a `$`-ref TOKEN (`$start`, `_parent:originNode`) — it isn't in knownIds
// so it reads as content, the frontier is empty, and the replay never rebinds (study 2026-06-30). `declaredCtx` reads
// each endpoint from its DECLARED field instead: the value at that field (whatever it is — a literal id OR a `$`-ref
// token) that is EXTERNAL (not the base, not created by this patch, not base-derived) IS the endpoint. So the value
// becomes a `⟦@ref⟧` hole regardless of its syntactic form, which is the whole Phase-1 fix. SAME `{base,refs,fields}`
// return shape as `inferCtx`, so every downstream consumer (relativize/antiUnify/signatureDetermined/ctxFromScope) is
// unchanged — this is a pure substitution at the ctx layer.

// Normalize a host-declared frontier into the canonical param list. Accepts an array of param specs, a plain
// `{name: field}` map, or `{name: {field, sort, role, requiredFacts}}`. `sort`/`role` default to a node-ref endpoint
// (the path-section common case) — the Laurie schema fields land here so endpoint and behavioral params are ONE shape
// differing only by `sort`/`role` (Phase 1 is the actual common substrate, not a behavioral-param bolt-on).
function normalizeFrontierParams( decl ) {
	if ( !decl ) return null;
	const arr = Array.isArray(decl) ? decl : Object.keys(decl).map(( name ) => {
		const v = decl[name];
		return typeof v === 'string' ? { name, field: v } : Object.assign({ name }, v);
	});
	// preserve the full param shape (a behavioral param carries its typed in/out/frontier interface) — only DEFAULT
	// the universal fields; never drop the interface, else a typed behavioral param arrives at the lint untyped.
	return arr.map(( p ) => Object.assign({}, p, {
		name: p.name, field: p.field, sort: p.sort || 'node-ref',
		role: p.role || 'endpoint', requiredFacts: p.requiredFacts || [],
	}));
}

/**
 * Read the call-site ctx off a GROUND structural patch from a DECLARED frontier (vs `inferCtx`'s knownIds scan).
 * @param patch    the ground structural patch (array of template objects)
 * @param base     the cast target id (= `_parent`)
 * @param params   normalized frontier params (`normalizeFrontierParams`); only `role:'endpoint'` params have a patch
 *                 location (behavioral params are indexed for selection, not mined into the body ctx — Phase 1).
 * @returns { base, refs:{name:value}, fields:{name:field} }  — identical shape to `inferCtx`.
 */
function declaredCtx( patch, base, params ) {
	const created = createdIds(patch, base);
	const refs = {}, fields = {}, ambiguous = [];
	for ( const p of (params || []) ) {
		if ( (p.role || 'endpoint') !== 'endpoint' || !p.field ) continue;
		// the patch field for a "a:b" replay path is its LEAF segment (the field the value actually sits under).
		const patchField = p.field.indexOf(':') >= 0 ? p.field.split(':').pop() : p.field;
		const found = new Set();                                   // distinct EXTERNAL values at this declared field (scan order)
		eachKeyedValue(patch, ( key, v ) => {
			if ( key !== patchField ) return;
			if ( v === base || created.has(v) ) return;            // internal / the base itself → not the frontier
			if ( base && v.indexOf(base + '_') === 0 ) return;     // base-derived created id
			found.add(v);
		});
		// SOUNDNESS: a declared field that resolves to >1 distinct external value is UNDER-DECLARED — relativize would
		// hole only the first and leave the rest LITERAL, so a learning-episode id leaks into a fresh replay (#30, an
		// orphaned segment via Segment.js:70-72). Flag it → the crystallizer REFUSES rather than mis-replaying. (Declare
		// one param per endpoint to resolve — never a cap on expressivity, a disambiguation of the declaration.)
		if ( found.size > 1 ) ambiguous.push({ name: p.name, field: p.field, values: [...found] });
		refs[p.name] = found.size ? [...found][0] : undefined;    // undefined ⇒ no hole ⇒ replay bypasses (never mis-binds)
		fields[p.name] = p.field;
	}
	const ctx = { base, refs, fields };
	if ( ambiguous.length ) ctx.ambiguous = ambiguous;
	// SOUNDNESS (collapse): two DISTINCT declared endpoints resolving to the SAME value can't be told apart by
	// `relativize` (it matches by value, first-ref-wins) → they merge into ONE hole and the second mis-binds at a
	// replay site where they differ. Flag → the crystallizer refuses (the endpoints are structurally indistinguishable).
	const byVal = {};
	for ( const name of Object.keys(refs) ) { const v = refs[name]; if ( v != null ) (byVal[v] = byVal[v] || []).push(name); }
	const collapsed = Object.keys(byVal).filter(( v ) => byVal[v].length > 1).map(( v ) => ({ value: v, names: byVal[v] }));
	if ( collapsed.length ) ctx.collapsed = collapsed;
	return ctx;
}

// SOUNDNESS net — a segment endpoint must rebind at replay, so it has to be either a BOUND frontier hole (`⟦@ref:…⟧`)
// or a base-derived id that names an object the method actually CREATES. Two ways it isn't, each ORPHANS/mis-wires at a
// fresh replay (#30) and each was adversarial-review-reproduced:
//   • LITERAL  — a plain external id the declaration missed (`hasHoles===false`): a baked learning id.
//   • PHANTOM  — a base-derived hole `⟦@base⟧<suffix>` whose suffix names NO created object: `relativizeVal` mis-holes
//                an external endpoint whose id collides with `<castTarget>_…` into the base id-space (so `hasHoles` is
//                true and the LITERAL check is blind); at replay it resolves to a non-existent `<newBase><suffix>`.
// `createdHoles` = the base itself (the cast target) ∪ every base-derived id the param declares as an object id. Reuses
// `abstract.hasHoles`/`BASE` (the ⟦…⟧ sentinel stays defined in ONE place).
const ENDPOINT_FIELDS = ['originNode', 'targetNode'];
const ID_KEYS = ['$$_id', '$_id', '_id'];
function leakedEndpoints( param ) {
	const objs = Array.isArray(param) ? param : [param];
	const createdHoles = new Set([BASE]);                         // the base (cast target) is a valid base-derived endpoint
	for ( const o of objs ) {
		if ( !o || typeof o !== 'object' ) continue;
		for ( const k of ID_KEYS ) { const v = o[k]; if ( typeof v === 'string' && v.indexOf(BASE) === 0 ) createdHoles.add(v); }
	}
	const out = [];
	for ( const o of objs ) {
		if ( !o || typeof o !== 'object' ) continue;
		for ( const f of ENDPOINT_FIELDS ) {
			const v = o[f];
			if ( typeof v !== 'string' ) continue;
			if ( !hasHoles(v) ) out.push({ field: f, value: v, kind: 'literal' });                        // a plain external literal
			else if ( v.indexOf(BASE) === 0 && !createdHoles.has(v) ) out.push({ field: f, value: v, kind: 'phantom' });   // mis-holed external
		}
	}
	return out;
}

// CONTENT-BLIND structural key: the parameterized form with every CONTENT scalar (anything that is not a hole
// sentinel) replaced by a placeholder, so all firings of ONE method (same structure + frontier, content varying by
// premise) group together — while a genuinely different structure (an extra intermediate, a different field set)
// gets a different key. Reuses `abstract.hasHoles` to recognise a sentinel (never re-derives the ⟦…⟧ format).
function blankContent( x ) {
	if ( Array.isArray(x) ) return x.map(blankContent);
	if ( x && typeof x === 'object' ) { const o = {}; for ( const k of Object.keys(x) ) o[k] = blankContent(x[k]); return o; }
	if ( typeof x === 'string' && hasHoles(x) ) return x;        // a base/ref hole is structural → keep
	return '§';                                                  // content scalar → blank
}
function shapeKey( param ) { return canon(blankContent(param)); }

/**
 * Mine RECURRENT STRUCTURAL methods from an enriched trace.
 * @param records  [{ concept, target, patch, premise }]  — enriched firings (see `methodTrace`)
 * @param tree     the concept tree (for the produced-fact set per concept)
 * @param opts.minCount  distinct call sites required to consider a method (default 2)
 * @param opts.knownIds  Set of existing object ids (frontier-vs-content disambiguation; pass graph object ids)
 * @returns [{ concept, count, stable, signatureDetermined, admissible, skeleton, contentVars, frontier,
 *            instances:[{target,ground,ctx,premise,premiseDigest,param}], templatesByDigest, produced }]
 *          one entry per (concept × structural-skeleton) bucket, sorted by count desc.
 */
function mineMethods( records, tree, opts ) {
	opts = opts || {};
	const minCount = opts.minCount || 2;
	const knownIds = opts.knownIds || null;
	const declaredParams = normalizeFrontierParams(opts.declaredFrontier);   // Phase 1: DECLARED frontier (else inferred)
	// DECLARED prose/untracked keys to strip before mining (the LLM free-text that must not fragment the method).
	const proseSet = ( opts.proseKeys && opts.proseKeys.length ) ? new Set(opts.proseKeys) : null;

	// static produced-fact set per concept (the contract write obligation, Gap C input).
	const produced = {};
	eachConcept(tree, ( c ) => { if ( c._name ) { const s = c._schema || c; produced[c._name] = [c._name, ...templateKeys(s.applyMutations)]; } });

	// 1. keep only STRUCTURAL firings (a patch that creates a sub-graph: > 1 object), relativize each.
	const byBucket = {};                                        // "concept skeletonCanon" -> instances
	for ( const r of (records || []) ) {
		if ( !r || !r.concept || !Array.isArray(r.patch) || r.patch.length <= 1 ) continue;
		const ground = stripPatch(r.patch, proseSet);
		const ctx = declaredParams ? declaredCtx(ground, r.target, declaredParams) : inferCtx(ground, r.target, knownIds);
		const param = relativize(ground, ctx);
		const key = r.concept + ' ' + shapeKey(param);            // content-BLIND: one method, content varies by premise
		(byBucket[key] = byBucket[key] || []).push({
			concept: r.concept, target: r.target, ground, ctx, premise: r.premise || {},
			premiseDigest: digest(r.premise || {}), param,
		});
	}

	// 2. per bucket: distinct-site count, pairwise-antiUnify stability, K1 signatureDetermined.
	const out = [];
	for ( const key of Object.keys(byBucket) ) {
		const inst = byBucket[key];
		const concept = inst[0].concept;
		const distinct = new Set(inst.map(( i ) => i.target));
		const count = distinct.size;

		// stable iff every pair of instances generalizes to one skeleton (no tree-shape difference).
		let stable = true; const cvPaths = new Set();
		for ( let i = 1; i < inst.length && stable; i++ ) {
			const r = antiUnify(inst[0].ground, inst[0].ctx, inst[i].ground, inst[i].ctx);
			if ( !r.stable ) stable = false;
			else for ( const d of r.contentVars ) cvPaths.add(d.path);
		}

		// K1 ceiling (the canonicalization barrier): content must be a FUNCTION of the typed signature — i.e. all
		// firings sharing a premise digest must produce the IDENTICAL parameterized method. A premise-class with two
		// different parameterized forms = content depends on something outside the signature (prose/nondeterminism) →
		// not signature-determined → REFUSE (it would graveyard a wrong typed fact through the cascade).
		let signatureDetermined = true;
		const byDigest = {};
		for ( const i of inst ) {
			const pc = canon(i.param);
			if ( byDigest[i.premiseDigest] === undefined ) byDigest[i.premiseDigest] = pc;
			else if ( byDigest[i.premiseDigest] !== pc ) signatureDetermined = false;
		}
		// a representative parameterized template per premise class (the crystallized provider replays these).
		const templatesByDigest = {};
		for ( const i of inst ) if ( !(i.premiseDigest in templatesByDigest) ) templatesByDigest[i.premiseDigest] = i.param;

		// T2b: validate the engine-native emit reproduces the body (behind opts.graph); the replay param stays captured.
		const emitChk = opts.graph ? emitEquivalence(opts.graph, inst[0].ground, inst[0].ctx, inst[0].target) : null;

		// SOUNDNESS net: any un-holed segment endpoint across the bucket's parameterized forms = a baked external id
		// (an endpoint the frontier missed). Surfaced for the crystallizer to refuse (a leak would orphan/mis-wire).
		const leakSeen = {}, leak = [];
		for ( const i of inst ) for ( const e of leakedEndpoints(i.param) ) { const k = e.field + '=' + e.value; if ( !leakSeen[k] ) { leakSeen[k] = 1; leak.push(e); } }

		out.push({
			concept, count, stable, signatureDetermined,
			admissible: stable && signatureDetermined && count >= minCount,
			skeleton: inst[0].param, contentVars: [...cvPaths].sort(),
			frontier: Object.keys(inst[0].ctx.refs).sort(), frontierFields: inst[0].ctx.fields,
			instances: inst, templatesByDigest, produced: produced[concept] || [concept],
			emitEquivalent: emitChk ? emitChk.equivalent : undefined,
			leak: leak.length ? leak : undefined,
		});
	}
	out.sort(( a, b ) => b.count - a.count);
	return out;
}

// ─────────────────────────────── T2b — ENGINE-NATIVE emit, behind opts.graph (validated, not the replay param) ────
//
// `emitMethodAsSubgraph` (abstract.js) closes the F6/U1a loop: serialize a derived sub-graph through the engine-native
// `getMutationFromPath` and relativize it into a re-mountable method. It was dead-but-tested; this wires it behind
// `opts.graph`. VERIFY-BEFORE-BUILD FINDING (scratchpad probe): for the modeled input the engine-native emit is NOT
// byte-identical to `relativize(capturedPatch, ctx)` — emit serializes the LIVE BODY ONLY (no parent cast object) and
// `getMutationFromPath` keeps `_origin` + emits `_id` where the captured patch carries `$$_id`. They ARE equivalent up
// to that bookkeeping (same skeleton, same holes, same content). So the crystallizer KEEPS the captured-patch param for
// replay (it also carries the parent's cast facts — Refined/alts — emit drops); emit is exercised + VALIDATED here. The
// plan's "fall back to relativize if the equivalence test fails" therefore resolves to: always relativize the captured
// patch (the kill-gate-proven path), with `emitEquivalent` recording that the F6 emit faithfully reproduces the body.

const idOfTplObj = ( o, base ) => {
	if ( !o || typeof o !== 'object' ) return null;
	if ( o.$_id === '_parent' ) return base;
	const v = o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : o._id);
	return typeof v === 'string' ? v.replace(/^\$+/, '') : v;
};
// normalize away the divergences the probe identified (unify the id key, drop `_origin`), then sort by id, so the two
// relativized bodies compare on STRUCTURE + CONTENT, not serialization form.
function normalizeBody( tpl ) {
	return (Array.isArray(tpl) ? tpl : [tpl]).map(( o ) => {
		if ( !o || typeof o !== 'object' ) return o;
		const out = {};
		for ( const k of Object.keys(o) ) {
			if ( k === '_origin' ) continue;
			out[(k === '_id' || k === '$$_id' || k === '$_id') ? 'id' : k] = o[k];
		}
		return out;
	}).sort(( a, b ) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Validate the engine-native emit (`emitMethodAsSubgraph`) against the captured-patch body for ONE firing, behind a
 * live `graph`. Returns { equivalent, emit, captured } — `equivalent` true iff the F6 serialize reproduces the body up
 * to engine bookkeeping. Used to annotate `m.emitEquivalent`; the crystallizer's replay param stays the captured patch.
 */
function emitEquivalence( graph, ground, ctx, base ) {
	if ( !graph ) return { equivalent: undefined, emit: null, captured: null };
	const bodyIds = [...createdIds(ground, base)].filter(( id ) => id !== base );
	const emit = emitMethodAsSubgraph(graph, bodyIds, ctx);
	const capturedBody = relativize((Array.isArray(ground) ? ground : [ground]).filter(( o ) => idOfTplObj(o, base) !== base), ctx);
	const equivalent = emit != null && canon(normalizeBody(emit)) === canon(normalizeBody(capturedBody));
	return { equivalent, emit, captured: capturedBody };
}

// the target's facts projected onto a concept's MEMO SURFACE (require/ensure/assert keys) — the typed K1 premise the
// firing was keyed on. Captured at apply time from the live graph (require keys aren't overwritten by the cast's own
// patch, so the post-apply projection is the firing premise).
function premiseOf( graph, conceptName, targetId ) {
	const keys = memoSurfaceKeys(graph, conceptName);
	const etty = graph.getEtty && graph.getEtty(targetId);
	const facts = etty && etty._;
	if ( !facts ) return {};
	const proj = {};
	for ( const k of keys ) if ( k in facts ) proj[k] = facts[k];
	return proj;
}

/**
 * An ENRICHED trace collector for structural mining — keeps the ground patch + the firing premise (which `traceMiner`
 * drops). Register it on the live graph's `conceptApply` event (so it can read the premise off the graph):
 *   const mt = methodTrace();
 *   const g = new Graph(seed, cfg, conceptMap); mt.listen(g);
 *   await nextStable(g);
 *   const methods = mt.methods(tree, { knownIds: new Set(Object.keys(g._objById)) });
 */
function methodTrace() {
	const records = [];
	function onApply( graph, rec ) {
		if ( !rec ) { rec = graph; graph = null; }               // tolerate the cfg.onConceptApply (rec-only) form
		if ( !rec || !rec.conceptName ) return;
		records.push({
			concept: rec.conceptName, target: rec.targetId, patch: rec.patch, applyId: rec.applyId,
			premise: graph ? premiseOf(graph, rec.conceptName, rec.targetId) : (rec.premise || {}),
		});
	}
	return {
		records, onApply, onConceptApply: onApply,
		listen: function ( graph ) { graph.on('conceptApply', onApply); return this; },
		methods: function ( tree, o ) { return mineMethods(records, tree, o); },
	};
}

module.exports = { mineChains, composeProviders, recordsFromTrace, traceMiner,
	mineMethods, methodTrace, stripPatch, inferCtx, declaredCtx, normalizeFrontierParams, emitEquivalence, premiseOf };
