/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * ancestry — §6.3(b) the ANCESTRY ORACLE: content→param PROMOTION (host-side, ZERO-CORE; spec §3.2, refined by the
 * 2026-06-30 Laurie confront). Relative LGG / bounded ij-determinacy (Plotkin 1971; GOLEM, Muggleton-Feng 1990).
 *
 * A crystallized method's VARYING content leaf is one of three bins (NEVER dropped — "ignorable" is unsound):
 *   • BAKE  (baked+keyed) — constant across ALL instances AND digests (`signatureDetermined` is within-digest only;
 *           `generalizeContent` folds across digests → a within-digest constant could bake a premise-dependent value
 *           above the memo key). The mount stays gated on a digest hit.
 *   • PROMOTE (rebound+verified) — the identity FD `value(f)=N(s).g` (or a deterministic field-projection `g.field`)
 *           holds, g is BELOW the separator horizon (g ∈ Σ_sep), and it SURVIVES a held-out strict-=== check. The leaf
 *           becomes a frontier ref bound from the ancestor at the call site, with an EXACT relational post `$leaf==$g`.
 *   • FORGE (forged+verified) — everything else (the always-sound catch-all: the model re-derives, assertPost verifies).
 *
 * THE SOUNDNESS SPINE (Laurie confront — the SAME §6.4 hazard): the promote bin is BY CONSTRUCTION the varying-leaf
 * case, so `crystallize.js#invariantAtom` would give it an over-approximating BAND → a spurious g whose wrong value
 * lands in the band passes `assertPost` silently. PAC (Džeroski-Muggleton-Russell 1992) does NOT save it (workload
 * firings are non-iid; the engine deploys under drift). The fix:
 *   (1) minK floor ≥ 3 (the union-bound over |Σ_sep| is advisory — `opts.minK` raises it; k bounds the in-sample
 *       false-discovery rate, NOT soundness);
 *   (2) a MANDATORY held-out (≥1 withheld instance) verified by strict `===` — the negative-based reduction; the only
 *       in-sample test that kills an in-distribution spurious g;
 *   (3) the promoted post is the EXACT relation `$leaf==$g`, NOT the band → a future divergence is caught at mount.
 * Ambiguity (≥2 survivors) → FORGE (the version-space join ⊤ = a fresh variable = forge IS the Plotkin/Mitchell answer).
 */
const { REF } = require('../../../lib/authoring/core/abstract.js');

function canon( x ) {
	if ( x === undefined ) return 'u';
	if ( x === null || typeof x !== 'object' ) return JSON.stringify(x);
	if ( Array.isArray(x) ) return '[' + x.map(canon).join(',') + ']';
	return '{' + Object.keys(x).sort().map(( k ) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
const eq = ( a, b ) => canon(a) === canon(b);

// the ancestor value a hypothesis reads: identity `N(s).g` or field-projection `N(s).g.field` (the ONLY two φ — a
// lookup-table φ is a memo, affine/multi-arg fit a free parameter → spurious-rate explosion, deferred).
function ancestorVal( ancestry, cand ) {
	const g = (ancestry || {})[cand.g];
	if ( cand.field == null ) return g;
	return (g && typeof g === 'object') ? g[cand.field] : undefined;
}

/**
 * Decide the bin for ONE content leaf from its per-instance observations `[{ value, ancestry:{factName:value}, digest? }]`.
 * @param opts.sigmaSep      the separator horizon (decompose.js#separatorGate / bagInterface) — g must be ∈ this.
 * @param opts.minK          the determinacy floor (≥3; the union-bound over |Σ_sep| is the host's to raise).
 * @param opts.fieldProjection  allow the `g.field` φ (default false).
 * @param opts.leafKey       the fact key the leaf writes (for the exact post `$<leafKey>==$<ref>`; default 'leaf').
 * @returns { bin:'bake'|'promote'|'forge', promotion?, post?, value?, reason, fitCandidates, survivors }
 */
function decideLeaf( opts ) {
	opts = opts || {};
	const obs = (opts.observations || []).filter(Boolean);
	const sigma = new Set(opts.sigmaSep || []);
	const minFit = Math.max(3, opts.minK || 3);
	const leafKey = opts.leafKey || 'leaf';

	// need ≥ minFit instances to FIT + ≥1 HELD-OUT (the negative-based reduction). Else FORGE (the safe catch-all).
	if ( obs.length < minFit + 1 ) return { bin: 'forge', reason: 'insufficient-instances (need minK+1; got ' + obs.length + ')', fitCandidates: [], survivors: [] };
	const fit = obs.slice(0, obs.length - 1), held = obs[obs.length - 1];
	const vals = fit.map(( o ) => o.value );

	// (4) BAKE — constant across ALL observations (incl. held-out). Cross-digest constancy is the soundness condition.
	if ( obs.every(( o ) => eq(o.value, obs[0].value)) ) {
		const digests = new Set(obs.map(( o ) => o.digest).filter(( d ) => d != null));
		return { bin: 'bake', reason: digests.size > 1 ? 'constant-cross-digest' : 'constant', value: obs[0].value, crossDigest: digests.size > 1, fitCandidates: [], survivors: [] };
	}

	// the hypothesis space H = { identity g } ∪ { field-projection g.field }, g ∈ Σ_sep (the horizon).
	const anc0 = fit[0].ancestry || {};
	const H = [];
	for ( const g of Object.keys(anc0) ) {
		if ( !sigma.has(g) ) continue;
		H.push({ g });
		if ( opts.fieldProjection && anc0[g] && typeof anc0[g] === 'object' )
			for ( const field of Object.keys(anc0[g]) ) H.push({ g, field });
	}

	// fit candidates: the FD holds on EVERY fit instance.
	const fitCandidates = H.filter(( c ) => fit.every(( o, k ) => o.ancestry && eq(vals[k], ancestorVal(o.ancestry, c))));
	// survivors: ALSO predict the held-out leaf by strict === (eliminate an in-distribution spurious g).
	const survivors = [];
	const seen = new Set();
	for ( const c of fitCandidates ) {
		if ( !eq(held.value, ancestorVal(held.ancestry, c)) ) continue;
		const k = c.g + '|' + (c.field || '');
		if ( !seen.has(k) ) { seen.add(k); survivors.push(c); }
	}

	if ( survivors.length === 1 ) {
		// a colon-free ref name (a colon is the cross-walk syntax → would mis-resolve in `expr.js`/`assertPost`).
		const c = survivors[0], refName = 'anc_' + c.g + (c.field ? '_' + c.field : '');
		return { bin: 'promote', promotion: { ref: REF(refName), refName, ancestorFact: c.g, field: c.field || null, leafKey },
			post: '$' + leafKey + '==$' + refName, fitCandidates, survivors };
	}
	return { bin: 'forge', fitCandidates, survivors,
		reason: survivors.length ? 'ambiguous-version-space-join (' + survivors.length + ' survivors)' : 'no-determinate-ancestor' };
}

// the leaf's fact key from a generalizeContent path (`[1].state` → `state`; `state` → `state`).
function leafKeyOf( path ) { const parts = String(path).split('.'); return parts[parts.length - 1].replace(/\[\d+\]/g, '') || 'leaf'; }

// rewrite a generalizeContent skeleton: a promoted `{'§var':p}` hole → its frontier REF; a baked hole → its literal;
// a forged hole → left as the content hole (the model fills it).
function rewriteSkeleton( skel, byPath ) {
	if ( Array.isArray(skel) ) return skel.map(( x ) => rewriteSkeleton(x, byPath));
	if ( skel && typeof skel === 'object' ) {
		if ( '§var' in skel && Object.keys(skel).length === 1 ) { const p = skel['§var']; return (p in byPath) ? byPath[p] : skel; }
		const o = {}; for ( const k in skel ) o[k] = rewriteSkeleton(skel[k], byPath); return o;
	}
	return skel;
}

/**
 * Batch the promotion over a method's content vars + rewrite the skeleton.
 * @param opts.skeleton  the `generalizeContent` skeleton (with `{'§var':path}` holes).
 * @param opts.leaves    [{ path, observations:[{value,ancestry,digest?}] }] — one per content var.
 * @returns { promoted:[{path,ancestorFact,field,refName}], baked:[path], forged:[path], posts:[atom], bins:{path:bin}, skeleton }
 */
function promoteContentVars( opts ) {
	opts = opts || {};
	const out = { promoted: [], baked: [], forged: [], posts: [], bins: {} };
	const byPath = {};
	for ( const leaf of (opts.leaves || []) ) {
		const d = decideLeaf({ observations: leaf.observations, sigmaSep: opts.sigmaSep, minK: opts.minK, fieldProjection: opts.fieldProjection, leafKey: leafKeyOf(leaf.path) });
		out.bins[leaf.path] = d.bin;
		if ( d.bin === 'promote' ) { out.promoted.push(Object.assign({ path: leaf.path }, d.promotion)); out.posts.push(d.post); byPath[leaf.path] = d.promotion.ref; }
		else if ( d.bin === 'bake' ) { out.baked.push(leaf.path); byPath[leaf.path] = d.value; }
		else out.forged.push(leaf.path);
	}
	out.skeleton = rewriteSkeleton(opts.skeleton, byPath);
	return out;
}

// parse a generalizeContent path (`[1].state`) into navigation tokens; set the value at it (immutably).
function parsePath( path ) {
	const toks = [], re = /\[(\d+)\]|\.?([A-Za-z_]\w*)/g; let m;
	while ( (m = re.exec(path)) ) { if ( m[1] != null ) toks.push({ i: +m[1] }); else if ( m[2] != null ) toks.push({ k: m[2] }); }
	return toks;
}
function setAtPath( tpl, path, value ) {
	const toks = parsePath(path), clone = JSON.parse(JSON.stringify(tpl));
	let cur = clone;
	for ( let i = 0; i < toks.length - 1; i++ ) { const t = toks[i]; cur = t.i != null ? cur[t.i] : cur[t.k]; if ( cur == null ) return clone; }
	const last = toks[toks.length - 1];
	if ( last.i != null ) cur[last.i] = value; else cur[last.k] = value;
	return clone;
}
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };

/**
 * §6.3(b) WIRING — enhance a crystallized candidate with ancestry promotions. A content leaf the ancestry oracle
 * promotes (`decideLeaf` → promote) becomes a frontier REF bound from the ancestor at the call site; the EXACT post
 * `$leaf==$g` is added; and (opt-in `dropKeys`) the now-redundant signature key is DROPPED — so when promotion removes
 * the SOLE differentiator the templates collapse to one and the method GENERALIZES to UNSEEN signature classes (it
 * rebinds the leaf from the ancestor) instead of bypassing. Sound by the held-out FD + the exact post (the runtime monitor).
 * @param candidate  a crystallizeStructural candidate `{ schema, providerName, signatureKeys, frontierFields, templatesBySig }`.
 * @param opts.leaves         [{ path, observations }] — the content leaves + their per-instance (value, ancestry).
 * @param opts.sigmaSep/minK/fieldProjection  forwarded to `decideLeaf` (the horizon + the determinacy discipline).
 * @param opts.ancestorField  (g) => the scope field the ancestor fact lives on (default `g` — the cast object's own fact;
 *                            pass e.g. (g)=>'originNode:'+g for a predecessor cross-walk, which `ctxFromScope` resolves).
 * @param opts.dropKeys       drop a promoted ancestor from `signatureKeys` (+ collapse templates) when it leaves an
 *                            empty reduced signature and all rewritten templates coincide (the generalization). Default false.
 * @returns the ENHANCED candidate (templates rewritten, frontier params + posts added, provider rebuilt) + `promotions`.
 */
function enhanceCandidateWithAncestry( candidate, opts ) {
	opts = opts || {};
	const { buildStructuralProvider } = require('./crystallize.js');   // lazy (avoid any load-order coupling)
	const ancestorField = opts.ancestorField || (( g ) => g);
	const cand = JSON.parse(JSON.stringify({ schema: candidate.schema, signatureKeys: candidate.signatureKeys || [], frontierFields: candidate.frontierFields || {}, templatesBySig: candidate.templatesBySig || {} }));

	const promotions = [];
	for ( const leaf of (opts.leaves || []) ) {
		const d = decideLeaf({ observations: leaf.observations, sigmaSep: opts.sigmaSep, minK: opts.minK, fieldProjection: opts.fieldProjection, leafKey: leafKeyOf(leaf.path) });
		if ( d.bin === 'promote' ) promotions.push({ path: leaf.path, refName: d.promotion.refName, ancestorFact: d.promotion.ancestorFact, field: d.promotion.field, post: d.post });
	}
	if ( !promotions.length ) return Object.assign({}, candidate, { promotions: [] });

	// rewrite every template: the promoted leaf → its frontier REF.
	for ( const sig of Object.keys(cand.templatesBySig) )
		for ( const pr of promotions ) cand.templatesBySig[sig] = setAtPath(cand.templatesBySig[sig], pr.path, REF(pr.refName));

	// add the frontier params + frontierFields + the EXACT posts; (opt-in) drop the redundant signature key.
	cand.schema.frontier = cand.schema.frontier || { params: [], appConditions: { require: [], assert: [] } };
	cand.schema.contract = cand.schema.contract || { read: [], write: [], pre: [], post: [], effect: 'pure' };
	for ( const pr of promotions ) {
		const fieldPath = ancestorField(pr.ancestorFact) + (pr.field ? '.' + pr.field : '');
		cand.schema.frontier.params.push({ name: pr.refName, sort: 'node-ref', role: 'endpoint', field: fieldPath, requiredFacts: [] });
		cand.frontierFields[pr.refName] = fieldPath;
		if ( cand.schema.contract.post.indexOf(pr.post) < 0 ) cand.schema.contract.post.push(pr.post);
		if ( opts.dropKeys ) cand.signatureKeys = cand.signatureKeys.filter(( k ) => k !== pr.ancestorFact);
	}

	// COLLAPSE: if dropping left an empty reduced signature and all rewritten templates now coincide (the promoted
	// leaf was the SOLE differentiator), re-key to ONE template under the reduced-signature digest → generalizes.
	if ( opts.dropKeys && !cand.signatureKeys.length ) {
		const tpls = Object.values(cand.templatesBySig);
		const allSame = tpls.every(( t ) => canon(t) === canon(tpls[0]));
		if ( allSame && tpls.length ) cand.templatesBySig = { [digestOf(projectFacts({}, cand.signatureKeys))]: tpls[0] };
	}

	const provider = buildStructuralProvider({ cryId: cand.schema._name, frontier: cand.schema.frontier, frontierFields: cand.frontierFields, templatesBySig: cand.templatesBySig, signatureKeys: cand.signatureKeys });
	return { schema: cand.schema, providerName: candidate.providerName, provider, signatureKeys: cand.signatureKeys, frontierFields: cand.frontierFields, templatesBySig: cand.templatesBySig, promotions };
}

// the digest the structural provider keys on (must match buildStructuralProvider's `digest(projectFacts(...))`).
const digestOf = require('../../../lib/providers/canonicalize.js').digest;

module.exports = { decideLeaf, promoteContentVars, rewriteSkeleton, leafKeyOf, enhanceCandidateWithAncestry, setAtPath };
