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
 * crystallize — the live crystallization loop (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-26-…, pass 3). Composes the pass-1/2 bricks end-to-end:
 *
 *   run an episode with a trace miner  →  mine the dominant producer→consumer chain
 *     →  compose the constituents' providers into ONE cast  →  gate by MDL/utility
 *     (fixpoint-equivalent + net-cheaper)  →  (adopt) install under a memo-stability guard.
 *
 * This is "observe → crystallize a typed production" — promoting a recurring sub-derivation
 * (a nonterminal in the derivation forest) into a first-class, auditable, defeasible concept.
 * `crystallize` makes the DECISION (offline, on fresh boots — never mid-stabilize); `adopt`
 * installs an admitted candidate into a target grammar, fail-closed on memo regression.
 *
 *   const r = await crystallize({ episodeTree, seed, providers, equivKeys });
 *   if (r.admitted) await adopt(nextGraph, r.candidate);   // adopt into the next episode's grammar
 */
const Graph = require('../graph/index.js');
const { nextStable } = require('./supervise.js');
const { traceMiner, composeProviders, methodTrace, mineMethods } = require('./mine.js');
const { rankCandidates } = require('./mdl.js');
const { evaluate, bootMeasure, factsEqual } = require('./abstraction.js');
const { assertMemoStable } = require('./memo-stability.js');
const { createLifecycle } = require('./lifecycle.js');
const { normalize } = require('./contract.js');
const { instantiate, ctxFromScope, canon, emitMethodAsSubgraph } = require('./abstract.js');
const { normalizeFrontierParams } = require('./mine.js');
const { lintMethod } = require('./method.js');
const { memoSurfaceKeys } = require('./memo-stability.js');
const { digest } = require('../providers/canonicalize.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

// find a concept schema by name/key anywhere in a tree
function conceptByName( tree, name ) {
	let found = null;
	(function walk( n ) {
		if ( !n || typeof n !== 'object' || found ) return;
		const kids = n.childConcepts;
		if ( kids ) for ( const k of Object.keys(kids) ) {
			if ( kids[k]._name === name || k === name ) { found = kids[k]; return; }
			walk(kids[k]);
		}
	})(tree);
	return found;
}

// resolve a concept's provider function from a providers map ("Ns::fn" | ["Ns::fn", …])
function providerFn( providers, provRef ) {
	const p = Array.isArray(provRef) ? provRef[0] : provRef;
	if ( !p ) return null;
	const parts = String(p).split('::');
	return providers[parts[0]] && providers[parts[0]][parts[1]];
}

/**
 * Decide whether the dominant mined chain should crystallize into one production.
 * @param opts.episodeTree/seed/providers/equivKeys  the episode + the equivalence contract
 * @param opts.minCount  minimum co-firing count to consider a chain (default 2)
 * @param opts.idFor     (chain)->id   name the crystallized concept (default Crystal_<from>_<to>)
 * @returns { chain, candidate:{schema,providerName,provider}|null, verdict?, admitted, reason? }
 */
async function crystallize( opts ) {
	const { episodeTree, seed, providers, equivKeys } = opts;
	const minCount = opts.minCount || 2;

	// 1. run the episode with a trace miner (offline; fresh boot)
	Graph._providers = Object.assign({}, Graph._providers || {}, providers || {});
	const miner = traceMiner();
	const g = new Graph(clone(seed), {
		label: 'crystallize', isMaster: true, autoMount: true, conceptSets: ['common'],
		bagRefManagers: {}, logLevel: 'error', onConceptApply: miner.onConceptApply,
	}, { common: clone(episodeTree) });
	await nextStable(g);

	const chains = miner.chains(episodeTree);
	// MDL rank (cheap, O(corpus), NO boot): order candidates by bits saved across the whole
	// trace, best first. A pure RANKER by default — `evaluate` stays the admit AUTHORITY (MDL
	// is conservative at tiny N and can't verify equivalence/model-cost). Opt-in `mdlPrefilter`
	// lets MDL cheaply skip a clearly-unprofitable (ΔL≥0) candidate before the expensive boot.
	const ranked = rankCandidates(chains, { tree: episodeTree, records: miner.records, alphabet: opts.alphabet || { knownFacts: [], palette: [] } });
	const top = ranked[0];
	if ( !top || top.count < minCount )
		return { chain: top ? plainChain(top) : null, candidate: null, admitted: false, reason: 'no frequent chain' };
	const mdl = top.mdl;
	if ( opts.mdlPrefilter && mdl && !mdl.admit )
		return { chain: plainChain(top), candidate: null, admitted: false, reason: 'mdl-prefilter (ΔL≥0, not worth a boot)', mdl };

	// 2. compose the from/to providers into one cast
	const fromS = conceptByName(episodeTree, top.from), toS = conceptByName(episodeTree, top.to);
	const fromFn = providerFn(providers, fromS && fromS.provider), toFn = providerFn(providers, toS && toS.provider);
	if ( !fromFn || !toFn )
		return { chain: plainChain(top), candidate: null, admitted: false, reason: 'non-provider constituent (v0 composes provider concepts)', mdl };

	const id = opts.idFor ? opts.idFor(top) : ('Crystal_' + top.from + '_' + top.to);
	const composed = composeProviders(fromFn, toFn);
	const providerName = 'Crystal::' + id;
	const augmented = Object.assign({}, providers, { Crystal: Object.assign({}, providers.Crystal, { [id]: composed }) });
	const schema = { _id: id, _name: id, require: (fromS.require || []).slice(), provider: [providerName] };

	// 3. MDL/utility gate (fixpoint-equivalent + net-cheaper vs the chain)
	const verdict = await evaluate({ seed, providers: augmented, chainTree: episodeTree, abstractTree: { childConcepts: { [id]: schema } }, equivKeys });
	return { chain: plainChain(top), candidate: { schema, providerName, provider: composed }, verdict, admitted: verdict.admit, mdl };
}

// the plain mined-chain shape (drop the attached `mdl` annotation so `res.chain` stays the
// stable { from, to, via, count } record).
function plainChain( c ) {
	const out = { from: c.from, to: c.to, via: c.via, count: c.count };
	if ( c.length != null ) out.length = c.length;
	return out;
}

/**
 * Install an admitted candidate into a target graph, fail-closed on memo regression
 * (assertMemoStable over the existing incumbents). Registers the composed provider first.
 * @returns the memoDiff (stable) — throws on a memo-stability violation.
 */
async function adopt( graph, candidate ) {
	const parts = candidate.providerName.split('::');
	Graph._providers = Object.assign({}, Graph._providers, {
		[parts[0]]: Object.assign({}, Graph._providers[parts[0]], { [parts[1]]: candidate.provider }),
	});
	const incumbents = Object.keys(graph._conceptLib || {});
	return assertMemoStable(graph, incumbents, () => new Promise((res) => graph.addConcept(null, candidate.schema, () => res())));
}

// Offline adoption: rewrite the episode grammar to USE the crystal — drop the chain's
// constituents and add the crystallized production. This materializes the refactor win (one
// cast instead of the chain) WITHOUT needing a core deleteConcept: the next episode is simply
// authored with the new grammar (the form the adversarial lens endorsed).
function rewriteAdopt( episodeTree, chain, candidateSchema ) {
	const t = clone(episodeTree);
	const kids = t.childConcepts || (t.childConcepts = {});
	for ( const k of Object.keys(kids) )
		if ( k === chain.from || k === chain.to || kids[k]._name === chain.from || kids[k]._name === chain.to ) delete kids[k];
	kids[candidateSchema._id] = candidateSchema;
	return t;
}

/**
 * Multi-episode consolidation (CLS): crystallize a candidate, ADOPT it by rewriting the
 * grammar (chain → crystal), then over `rounds` episodes verify it reproduces the baseline
 * and feed the outcome to the plasticity ledger — a proven crystal anneals to FROZEN.
 * @returns { candidate, chain, verdict, adoptedTree, lifecycle, plasticity, regime, reputation,
 *            applies:{chain,adopted}, consolidated }  (or the crystallize decision if not admitted)
 */
async function consolidate( opts ) {
	const rounds = opts.rounds || 3;
	const lc = opts.lifecycle || createLifecycle(opts.lifecycleOpts);
	const dec = await crystallize(opts);
	if ( !dec.admitted ) return Object.assign({}, dec, { lifecycle: lc, consolidated: false });

	const id = dec.candidate.schema._id;
	lc.register(id);
	const augmented = Object.assign({}, opts.providers, { Crystal: Object.assign({}, opts.providers && opts.providers.Crystal, { [id]: dec.candidate.provider }) });
	const baseline = (await bootMeasure(opts.episodeTree, opts.seed, augmented, { equivKeys: opts.equivKeys })).facts;
	const adoptedTree = rewriteAdopt(opts.episodeTree, dec.chain, dec.candidate.schema);

	let adoptedApplies = 0;
	for ( let r = 0; r < rounds; r++ ) {
		const run = await bootMeasure(adoptedTree, opts.seed, augmented, { equivKeys: opts.equivKeys });
		adoptedApplies = run.applies;
		lc.record(id, factsEqual(baseline, run.facts));   // genuine outcome (equivalent to baseline?)
	}

	return {
		candidate: dec.candidate, chain: dec.chain, verdict: dec.verdict, adoptedTree,
		lifecycle: lc, plasticity: lc.plasticity(id), regime: lc.regime(id), reputation: lc.reputation(id),
		applies: { chain: dec.verdict.chainApplies, adopted: adoptedApplies },
		consolidated: lc.regime(id) === 'frozen',
	};
}

// ─────────────────────────────── Gap C — born-defeasible contract synthesis ───────────────────────────────────
//
// The paper novelty: a crystallized method is BORN with a typed DEFEASIBLE contract `{ read, write, pre, post,
// effect }`, so drift retracts it (assertPost/reviseOnBlame) and composition is checkable box-CLOSED (checkCompose).
// The post is the OBSERVED INVARIANT over the method's output (`equivKeys`) expressed in contract.js's abstract-
// domain FRAGMENT (presence/enum/interval) — never a raw structured value (that would graveyard or be unverifiable).
// If no fragment-expressible post exists → return null = REFUSE the contract path (the K1 ceiling, again).

const SYS = new Set(['$_id', '$$_id', '_id', '_name', '_rev', '_origin']);

// the facts the cast sets on its PARENT (the object whose id is the base / `_parent`) — the method's downstream-
// visible output, stripped of structural/bookkeeping keys.
function parentFacts( ground, base ) {
	for ( const o of (Array.isArray(ground) ? ground : [ground]) ) {
		if ( !o || typeof o !== 'object' ) continue;
		const idv = o.$_id === '_parent' ? base : String(o.$$_id || o.$_id || o._id || '').replace(/^\$+/, '');
		if ( o.$_id === '_parent' || idv === base ) {
			const f = {};
			for ( const k of Object.keys(o) ) if ( !SYS.has(k) ) f[k.replace(/^\$+/, '')] = o[k];
			return f;
		}
	}
	return {};
}

// the union of the facts the cast sets on its parent, across instances — the WRITTEN set (an output, never part of
// the pre-cast signature). Derived from the patches (a provider concept's writes aren't statically known).
function parentFactKeys( instances ) {
	const keys = new Set();
	for ( const i of (instances || []) ) for ( const k of Object.keys(parentFacts(i.ground, i.target)) ) keys.add(k);
	return keys;
}

const isScalar = ( v ) => v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
function litAtom( key, v ) { return typeof v === 'string' ? key + "=='" + v + "'" : key + '==' + v; }

// the fragment-expressible invariant over ONE output key across the observed instances, or null (refuse).
function invariantAtom( key, vals ) {
	const uniq = [...new Set(vals.map(( v ) => JSON.stringify(v)))].map(( s ) => JSON.parse(s));
	if ( !uniq.every(isScalar) ) return null;                   // a structured (object/array) output → not in-fragment
	if ( uniq.length === 1 ) return litAtom(key, uniq[0]);      // constant → presence/enum invariant
	if ( uniq.every(( v ) => typeof v === 'number') ) {         // numeric → interval band
		return '$' + key + '>=' + Math.min(...uniq) + ' && $' + key + '<=' + Math.max(...uniq);
	}
	if ( uniq.every(( v ) => typeof v === 'string') ) return key + ' in [' + uniq.join(', ') + ']';   // enum band
	return null;                                                // mixed / bool-varying → not a clean invariant
}

/**
 * Synthesize a method's defeasible contract from the mined instances.
 * @param opts.concept    the crystallized concept name (its self-flag is part of `write`)
 * @param opts.read       the read-set (the method's require / signature keys)
 * @param opts.instances  the mined firings (each `{ ground, target }`) — output observed on the parent
 * @param opts.equivKeys  the output facts that define the method's effect (the post is induced over these)
 * @param opts.effect     'pure' (default) | 'external' | 'irreversible'
 * @returns { read, write, pre, post, effect }  or null if no fragment-expressible post (refuse the contract path)
 */
function synthesizeContract( opts ) {
	opts = opts || {};
	const read = [...new Set(opts.read || [])];
	const writeSet = new Set([opts.concept].filter(Boolean));
	for ( const i of (opts.instances || []) ) for ( const k of Object.keys(parentFacts(i.ground, i.target)) ) writeSet.add(k);

	const post = [];
	for ( const k of (opts.equivKeys || []) ) {
		const vals = (opts.instances || []).map(( i ) => parentFacts(i.ground, i.target)[k]).filter(( v ) => v !== undefined);
		if ( !vals.length ) continue;
		const atom = invariantAtom(k, vals);
		if ( atom == null ) return null;                        // an output not expressible in the fragment → refuse
		post.push(atom);
	}
	if ( !post.length ) return null;                            // nothing verifiable to assert → refuse the contract path
	if ( normalize(post).refuse.length ) return null;           // belt-and-braces: the post must parse clean in-fragment
	return { read, write: [...writeSet], pre: [], post, effect: opts.effect || 'pure' };
}

// ─────────────────────────────── Gap A — STRUCTURAL crystallization (re-mountable method) ─────────────────────
//
// The provider-fusion `crystallize` inlines a 2-step PROVIDER chain into one cast. `crystallizeStructural` does the
// harder thing the F6 slice (abstract.js) enables: turn a RECURRENT structural cast (one that creates a sub-graph)
// into a re-mountable parameterized METHOD — a concept whose provider, at a NEW call site, binds the learned
// sub-graph template (structural holes from the site + content from the learned per-signature table) and applies it
// at ZERO model calls. Novel-but-related problems sharing a typed signature reuse the structural decision (#30/F6,
// now crystallized into a first-class defeasible concept), and an unseen signature BYPASSES (no false replay).
//
// v0 ASSUMPTIONS (honest scope): call-site endpoints are LITERAL ids in the patch (the canonical aetheris/epikeo
// structural-mount style abstract.js generalizes) — a provider wiring endpoints via `$`-refs would yield an empty
// inferred frontier and not rebind. The premise is captured POST-apply, so a method that ECHOES one of its require
// keys is REFUSED (the soundness guard below). Content must be a function of the TYPED signature (the K1 ceiling);
// an undeclared corpus-correlated input the provider reads can still mis-key — the inherent canon limit `cache.js`
// shares (a modeling-discipline violation, not crystallizer-detectable).

const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };

// add the crystal's OWN cast marker to the parent object of an instantiated template (the provider-cast-marker
// discipline: a wired provider must self-flag the cast, else the engine re-fires it to the apply-cap → divergent).
function injectCastMarker( ground, base, cryId ) {
	return (Array.isArray(ground) ? ground : [ground]).map(( o ) => {
		if ( !o || typeof o !== 'object' ) return o;
		const idv = String(o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : o._id)).replace(/^\$+/, '');
		return (o.$_id === '_parent' || idv === base) ? Object.assign({}, o, { [cryId]: true }) : o;
	});
}

/**
 * The crystallized structural provider. Keys on the typed K1 signature (the pre-cast memo-surface keys minus the
 * ones the cast writes, so the replay digest matches the mining digest); on a hit it RE-MOUNTS the learned sub-graph
 * bound to the new call site (0 model calls), on a miss/unknown-site it casts a NO-OP marker (never re-fires).
 */
function buildStructuralProvider( spec ) {
	// T4 — the ctxFromScope frontier map { name: field } is DERIVED from the reified FrontierSignature's role:'endpoint'
	// params (behavioral params are indexed for selection, never bound to a call-site node here). A `field` of "a:b"
	// form is a cross-object ref path — ctxFromScope already resolves it (the actual `$`-ref runtime rebind). Falls back
	// to a directly-supplied `spec.frontierFields` (the inferred path / a test passing the map verbatim).
	const frontierFields = spec.frontierFields || ((spec.frontier && spec.frontier.params) || [])
		.filter(( p ) => (p.role || 'endpoint') === 'endpoint')
		.reduce(( m, p ) => { if ( p.field ) m[p.name] = p.field; return m; }, {});
	return function ( graph, concept, scope, argz, cb ) {
		const noop = { $_id: '_parent', [spec.cryId]: true };          // a cast marker with no structural output (bypass)
		const ctx = ctxFromScope(scope, { frontier: frontierFields });
		if ( !ctx ) return cb(null, noop);                             // unknown base → bypass
		const tpl = spec.templatesBySig[digest(projectFacts(scope._ || {}, spec.signatureKeys))];
		if ( !tpl ) return cb(null, noop);                             // unseen signature class → bypass (no model in the crystal)
		const ground = instantiate(tpl, ctx);
		if ( !ground ) return cb(null, noop);                          // an unbound frontier ref → bypass
		return cb(null, injectCastMarker(ground, ctx.base, spec.cryId)); // 0-call structural re-mount
	};
}

const asArr = ( v ) => v == null ? [] : Array.isArray(v) ? v : [v];

/**
 * Reify the FrontierSignature — "which elements are generic for which method" (study §"the precious meta-info"): the
 * LGG result `antiUnify` computes (the structural holes = the frontier params; the content vars = the bound payload).
 *   - `params`         the holes, each `{ name, sort, field, role, requiredFacts }` — the declared endpoints (+ any
 *                      host-declared behavioral params); inferred episodes synthesize node-ref endpoints from the mine.
 *   - `summaryFacts`   the SOUND post the Phase-2 proxy must carry across the frontier (← contract.post / equivKeys).
 *   - `appConditions`  the parent NACs (require/assert) — the application conditions that orient selection.
 *   - `summary`        the I6 home (declared in Phase 1, ENFORCED in Phase 2: a JTMS-justified function of the body).
 * The two Laurie schema fields land NOW (free typed fields; retrofitting post-ship = a migration): `param.sort`
 * (node-ref|method-ref|predicate-ref — endpoint and behavioral params are the SAME hole, different sort) and `summary`.
 */
function reifyFrontier( declaredParams, top, fromS, contract, equivKeys ) {
	const params = declaredParams
		? declaredParams.map(( p ) => Object.assign({}, p, { name: p.name, sort: p.sort || 'node-ref', field: p.field, role: p.role || 'endpoint', requiredFacts: p.requiredFacts || [] }))
		: (top.frontier || []).map(( name ) => ({ name, sort: 'node-ref', field: (top.frontierFields || {})[name], role: 'endpoint', requiredFacts: [] }));
	const summaryFacts = contract ? contract.post.slice() : asArr(equivKeys).slice();
	return {
		params, summaryFacts,
		appConditions: { require: asArr(fromS && fromS.require).slice(), assert: asArr(fromS && fromS.assert).slice() },
		summary: { facts: summaryFacts },
	};
}

/**
 * The O(1) library-INDEX key (H2): `digest(canonicalTuple(params.map(role:sort)) + signatureKeys)`. Dispatch is a
 * dictionary lookup on this key — NEVER an HRG recognizer (membership is NP-complete). It is deliberately BODY-BLIND
 * (it never inspects the method body — else the subgraph-iso/NP cliff returns, study Gap C), so it is a COARSE BUCKET
 * key, NOT a unique method id: two methods with the same role:sort multiset + the same signature key-names collide on
 * purpose (e.g. two interface-identical wirings). `sort` and signature route across buckets (I4); within a bucket,
 * final selection refines on the full FrontierSignature (param names/fields) + application conditions — still body-blind.
 * (Not yet consumed at runtime — stored on `schema.libraryKey` for the Phase-2 library index.)
 */
function libraryKey( frontierSignature, signatureKeys ) {
	const tuple = (frontierSignature.params || []).map(( p ) => (p.role || 'endpoint') + ':' + (p.sort || 'node-ref')).sort();
	return digest({ params: tuple, signature: (signatureKeys || []).slice().sort() });
}

// H1/H3 — a param `sort` maps to a `lintMethod` slot kind: a node-ref endpoint is an id slot; a behavioral param
// (method-ref / predicate-ref) is a typed SUB-GRAPH slot (it MUST carry a typed in/out interface + a fixed frontier,
// else it re-keys every run = memo death — the constraint IS the library-selection benefit).
const SORT_KIND = { 'node-ref': 'id', 'method-ref': 'subgraph', 'predicate-ref': 'subgraph' };

/**
 * Lint a reified FrontierSignature through `method.js#lintMethod` (single source of truth; validate STRUCTURE not
 * grammar). Endpoint params are id slots (always typed); a behavioral param becomes a sub-graph slot that lintMethod
 * rejects if its interface/frontier is untyped/absent (H3 — an untyped behavioral param can never be a clean
 * selection key). Phase 1 ADMITS + LINTS + INDEXES behavioral params; it does NOT yet MOUNT them (that is Phase 2).
 */
function lintFrontier( frontierSignature, opts ) {
	opts = opts || {};
	const method = opts.name || 'crystal';
	const extra = [], slots = {};
	for ( const p of (frontierSignature.params || []) ) {
		const role = p.role || 'endpoint';
		if ( role === 'endpoint' ) { slots[p.name] = { role: 'param', kind: SORT_KIND[p.sort] || 'id' }; continue; }
		// a behavioral param is ALWAYS a typed sub-graph slot (regardless of sort), and its sort must itself be
		// behavioral — a node-ref behavioral param is a mis-declaration (the review's H1/H3 nit: keying typedness off
		// `sort` alone admitted a `role:submethod, sort:node-ref` param as an id slot; bind role→kind, not sort→kind).
		if ( p.sort !== 'method-ref' && p.sort !== 'predicate-ref' )
			extra.push({ method, kind: 'role-sort-mismatch', slot: p.name,
				message: `${role} param "${p.name}" must have a behavioral sort (method-ref|predicate-ref), got ${JSON.stringify(p.sort)}` });
		slots[p.name] = { role: 'param', kind: 'subgraph', in: p.in, out: p.out, frontier: p.frontier };
	}
	const r = lintMethod({ name: method, slots, contract: opts.contract }, { types: opts.types });
	return { errors: extra.concat(r.errors), warnings: r.warnings };
}

const hasBehavioral = ( frontierSignature ) => (frontierSignature.params || []).some(( p ) => (p.role || 'endpoint') !== 'endpoint');

/**
 * Decide + build a STRUCTURAL crystal from a live episode.
 * @param opts.episodeTree/seed/providers   the episode to observe (a structural concept firing on ≥minCount sites)
 * @param opts.equivKeys                    output facts defining the method's effect (the induced defeasible post)
 * @param opts.minCount                     distinct call sites required (default 2)
 * @param opts.idFor                        (method)->id   name the crystal (default Crystal_<concept>)
 * @param opts.effect                       'pure' (default) | 'external' | 'irreversible'
 * @returns { method, candidate:{schema,providerName,provider,signatureKeys,frontierFields,templatesBySig}|null,
 *            contract, admitted, reason?, methods }
 */
async function crystallizeStructural( opts ) {
	const { episodeTree, seed, providers, equivKeys } = opts;
	const minCount = opts.minCount || 2;

	Graph._providers = Object.assign({}, Graph._providers || {}, providers || {});
	const mt = methodTrace();
	const g = new Graph(clone(seed), {
		label: 'crystallize-structural', isMaster: true, autoMount: true, conceptSets: ['common'],
		bagRefManagers: {}, logLevel: 'error',
	}, { common: clone(episodeTree) });
	mt.listen(g);
	await nextStable(g);

	// Phase 1: a DECLARED frontier (each endpoint read off its declared field) supersedes the inferred knownIds scan —
	// fixes the `$`-ref endpoint case, unblocks k-ary, and reifies the FrontierSignature below. Falls back to inference.
	const declaredParams = normalizeFrontierParams(opts.declaredFrontier);
	const methods = mt.methods(episodeTree, { minCount, knownIds: new Set(Object.keys(g._objById)),
		declaredFrontier: declaredParams, graph: g, proseKeys: opts.proseKeys });
	const admissibleAll = methods.filter(( m ) => m.admissible);
	const top = admissibleAll[0];
	if ( !top ) return { method: null, candidate: null, admitted: false, reason: 'no admissible structural method', methods };
	const build = ( m ) => buildCandidateFromMined(m, { episodeTree, g, equivKeys, opts, declaredParams });
	const first = build(top);
	const res = Object.assign({ method: top, methods }, first);
	// opts.all — promote EVERY admissible (concept × skeleton) bucket: the mining buckets by structural skeleton
	// (mine.js shapeKey), so a heterogeneous trace yields ONE method per structure class; a library-building host
	// indexes them all (pass an `idFor` that disambiguates, else the schema ids collide).
	if ( opts.all ) res.candidates = admissibleAll.map(( m ) => Object.assign({ method: m }, m === top ? first : build(m)));
	return res;
}

/**
 * The post-boot half of crystallizeStructural: mine + build candidates from ALREADY-CAPTURED trace records
 * (`methodTrace().records` off a LIVE run) — no episode re-run, no model re-spend. The live harness use:
 * capture per-task firings, then crystallize per class from the accumulated trace.
 * @param opts.records      the enriched firings [{concept,target,patch,premise}]
 * @param opts.episodeTree  the concept tree the firings came from
 * @param opts.schemaGraph  ANY graph booted with that tree (schema source for the memo surface — an empty-seed
 *                          boot suffices; the task graphs themselves may be long discarded)
 * @param opts.equivKeys/proseKeys/declaredFrontier/idFor/minCount/all  as crystallizeStructural
 * @returns same shape as crystallizeStructural ({ method, candidate, admitted, reason?, methods, candidates? })
 */
function crystallizeFromRecords( opts ) {
	const declaredParams = normalizeFrontierParams(opts.declaredFrontier);
	const methods = mineMethods(opts.records, opts.episodeTree, { minCount: opts.minCount || 2,
		declaredFrontier: declaredParams, proseKeys: opts.proseKeys });
	const admissibleAll = methods.filter(( m ) => m.admissible);
	const top = admissibleAll[0];
	if ( !top ) return { method: null, candidate: null, admitted: false, reason: 'no admissible structural method', methods };
	const build = ( m ) => buildCandidateFromMined(m, { episodeTree: opts.episodeTree, g: opts.schemaGraph, equivKeys: opts.equivKeys, opts, declaredParams });
	const first = build(top);
	const res = Object.assign({ method: top, methods }, first);
	if ( opts.all ) res.candidates = admissibleAll.map(( m ) => Object.assign({ method: m }, m === top ? first : build(m)));
	return res;
}

// the per-bucket candidate build: soundness gates → contract → signature → templates → frontier → schema.
// Returns { admitted, candidate|null, reason?, contract?, frontier?, libraryKey?, lint? } (no method/methods —
// the caller attaches them).
function buildCandidateFromMined( top, env ) {
	const { episodeTree, g, equivKeys, opts, declaredParams } = env;

	// SOUNDNESS GATE (the declared path must keep the id-space invariant the inferred `knownIds` gate enforced: every
	// created segment endpoint is base-derived or a BOUND, DISTINCT frontier hole — else a learning id leaks/mis-wires
	// at replay, #30). Three refusals, each adversarial-review-reproduced:
	//   • ambiguous  — a declared field resolves to >1 external value (under-declared field) → relativize holes only the first.
	//   • collapsed  — two distinct declared endpoints share a value → relativize merges them into one hole → mis-bind.
	//   • leak       — a parameterized segment endpoint is still a plain external literal (an endpoint the frontier missed).
	const ambig = top.instances.map(( i ) => i.ctx && i.ctx.ambiguous).filter(Boolean)[0];
	if ( ambig )
		return { candidate: null, admitted: false,
			reason: 'frontier-field-ambiguous (' + ambig.map(( a ) => a.field + '→[' + a.values.join(',') + ']' ).join('; ') + ' — declare one param per endpoint)' };
	const collapsed = top.instances.map(( i ) => i.ctx && i.ctx.collapsed).filter(Boolean)[0];
	if ( collapsed )
		return { candidate: null, admitted: false,
			reason: 'frontier-endpoints-collapsed (' + collapsed.map(( c ) => c.names.join('=') + '@' + c.value ).join('; ') + ' — distinct endpoints coincide in value, indistinguishable)' };
	if ( top.leak )
		return { candidate: null, admitted: false,
			reason: 'frontier-endpoint-leak (' + top.leak.map(( e ) => e.field + '=' + e.value + (e.kind === 'phantom' ? ' [phantom: mis-holed external]' : '') ).join(', ') + ' — an external endpoint is not covered by the declared frontier)' };

	const fromS = conceptByName(episodeTree, top.concept);
	const requireKeys = fromS ? (Array.isArray(fromS.require) ? fromS.require.slice() : (fromS.require ? [fromS.require] : [])) : [];
	const cryId = opts.idFor ? opts.idFor(top) : ('Crystal_' + top.concept);

	// born-defeasible contract (the paper novelty) — null = refuse the contract path (no fragment-expressible post).
	const contract = synthesizeContract({ concept: cryId, read: requireKeys, instances: top.instances, equivKeys: equivKeys || [], effect: opts.effect });

	// SOUNDNESS GUARD (the premise is captured POST-apply — `mine.js#premiseOf` — there is no ZERO-CORE pre-apply
	// hook): if the cast ECHOES/overwrites one of its OWN require keys (e.g. `kind:'norm-'+kind`), that key's mined
	// (post-cast) value differs from its pre-cast value AND excluding it from the signature would silently mis-replay
	// the method onto an unseen value of it. We cannot soundly recover the pre-cast premise for such a key → REFUSE.
	// (Reviewer-found hole; regression `Gap A — a require key echoed by the cast …`.) The canonical structural method
	// writes only NEW output facts (self-flag/guard/created-ids), never a require key, so this never trips it.
	const writtenParent = parentFactKeys(top.instances);
	const echoedRequire = requireKeys.filter(( k ) => writtenParent.has(k));
	if ( echoedRequire.length && !opts.signatureKeys )
		return { candidate: null, admitted: false, reason: 'require-key-overwritten (' + echoedRequire.join(',') + ' — premise capture unreliable, cannot soundly mine)' };

	// the K1 signature = the keys read PRE-cast (the concept's memo surface) MINUS any the cast itself writes (a
	// written key is an output, not a premise; excluding it also keeps the replay digest — over pre-cast facts —
	// aligned with the mining digest). After the guard above, no require key is in `written`, so require keys (the
	// genuine pre-cast premise) are always kept. `opts.signatureKeys` can override (testing / a host-declared signature).
	const written = new Set([...writtenParent, top.concept, ...(contract ? contract.write : [])]);
	const signatureKeys = opts.signatureKeys || memoSurfaceKeys(g, top.concept).filter(( k ) => !written.has(k));

	// AUTHORITATIVE K1 re-check at the REPLAY granularity (mineMethods' signatureDetermined is a coarse full-premise
	// pre-filter; THIS is the gate that matches what the crystal will actually key on). Build one parameterized
	// template per signature class — and REFUSE (never first-wins) if a class maps to two different methods: that is
	// content not determined by the replay signature → a silent mis-replay risk (the canonicalization barrier).
	const templatesBySig = {};
	for ( const i of top.instances ) {
		const sig = digest(projectFacts(i.premise, signatureKeys)), pc = canon(i.param);
		if ( !(sig in templatesBySig) ) templatesBySig[sig] = { param: i.param, canon: pc };
		else if ( templatesBySig[sig].canon !== pc )
			return { candidate: null, admitted: false, reason: 'signature-insufficient (content not determined by the replay signature)' };
	}
	for ( const k of Object.keys(templatesBySig) ) templatesBySig[k] = templatesBySig[k].param;

	// T3 — reify the FrontierSignature (the declared endpoints + the sound summary + the parent NACs). The provider's
	// endpoint rebind map is DERIVED from it (T4); the signature is stored as `schema.frontier`, a sibling of
	// `schema.contract`, so it serializes with the tree and round-trips through rollback.
	const frontier = reifyFrontier(declaredParams, top, fromS, contract, equivKeys);

	// H3 — a declared behavioral param (sub-method / predicate) must carry a typed interface + frontier, else it
	// re-keys every run and can never be a clean selection key. Reject at author time (lintMethod, single source of
	// truth). Endpoint-only signatures never trip this (an id slot is always typed) — zero regression on the existing flow.
	if ( hasBehavioral(frontier) ) {
		// lint the PARAM TYPING only (H3) — do NOT re-frame-check the contract here: it is already validated at
		// synthesis (`synthesizeContract`/`contract.normalize`), and `method.js#frameKeys` expects `$`-prefixed post
		// atoms whereas `synthesizeContract` emits bare `key==value` atoms (a known format mismatch → a false frame
		// violation if fed). Passing no contract yields only an 'uncontracted' WARNING (benign), never an error.
		const lint = lintFrontier(frontier);
		if ( lint.errors.length )
			return { candidate: null, admitted: false, frontier, lint,
				reason: 'untyped-behavioral-param (' + lint.errors.map(( e ) => e.kind ).join(',') + ')' };
	}

	const libKey = libraryKey(frontier, signatureKeys);
	const provider = buildStructuralProvider({ cryId, signatureKeys, frontier, templatesBySig });
	const schema = { _id: cryId, _name: cryId, require: requireKeys.slice(), provider: ['Crystal::' + cryId] };
	if ( fromS && fromS.ensure ) schema.ensure = clone(fromS.ensure);    // carry the re-fire guard (e.g. !$Refined)
	if ( contract ) schema.contract = contract;
	schema.frontier = frontier;
	schema.libraryKey = libKey;

	return {
		contract, frontier, libraryKey: libKey, admitted: true,
		candidate: { schema, providerName: 'Crystal::' + cryId, provider, signatureKeys, frontier, libraryKey: libKey,
			frontierFields: top.frontierFields, templatesBySig },
	};
}

module.exports = { crystallize, adopt, consolidate, rewriteAdopt, synthesizeContract, crystallizeStructural, crystallizeFromRecords,
	buildStructuralProvider, reifyFrontier, libraryKey, lintFrontier };
