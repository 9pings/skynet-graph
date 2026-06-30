/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * adapt — the adapt-or-forge CONTROLLER: the creative loop's drive (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-30-creative-loop-two-level-grammar.md, brick C).
 *
 * The structuring grammar names a target mechanism; this drives retrieve-or-forge over the concept-DLL library:
 *   RETRIEVE  dispatch (library.js) → a candidate with a template for THIS signature (K1-sound by construction) → HIT, 0 model calls.
 *   FORGE     no hit → the model builds the method, REUSING the dispatched neighbours where it can (adapt = structural
 *             reuse + content forge; forge = fresh — the host's forge labels which) → VERIFIER GATE (it must carry a
 *             sound contract, mirroring crystallizeStructural's refuse-no-post) → index back so the next encounter HITS
 *             (amortise). The measured master-loop retrieve-or-forge; the verifier is the born-defeasible contract.
 *
 * The contract's POST is an OUTPUT invariant (true after the method runs) — so it is NOT a pre-dispatch gate (that is
 * the app-conditions, refined in dispatch). The gate here is "the forged method comes with a sound post" + an optional
 * host `verify` hook (run it + `assertPost`); a drift that breaks the post is caught by the runtime monitor (the moat).
 */
const { dispatch, indexMethod, dispatchInterface, appConditionsHold, frontierOf } = require('./library.js');
const { generalizeContent, fillContentHoles, blendAtSegment, BASE } = require('./abstract.js');
const { digest } = require('../providers/canonicalize.js');

const idOf = ( o ) => o && (o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : o._id));
// the child-segment SLOTS of a parameterized method (base-derived segments — the graftable positions, never the
// outer `_parent`/frontier). The blend's snapped-separator candidates.
function segmentSlots( tpl ) {
	return (Array.isArray(tpl) ? tpl : [tpl]).filter(( o ) => o && o.originNode != null && o.targetNode != null && typeof idOf(o) === 'string' && idOf(o).indexOf(BASE + '_') === 0).map(idOf);
}

const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };

/* ── the antiUnify CONTENT-FORGE adapt operator (study §"conceptual blending"; brick C, the richer adapt). ──
 * The crude adapt re-forged the whole method (or hard-coded "swap field X"). This DISCOVERS the content holes by
 * generalizing the neighbour's own templates (Plotkin LGG over its `templatesBySig`), forges ONLY those holes for
 * the new signature, and reuses the skeleton + structural holes verbatim. Domain-agnostic: the host supplies a
 * `contentFor(contentVars, scopeFacts) -> { <holePath>: value }` (the model filling exactly the discovered holes),
 * never the template surgery. */

/** The content holes of a learned method (its `templatesBySig`): { stable, skeleton, contentVars:[{path}] }. */
function methodContentHoles( neighbour ) {
	return generalizeContent(Object.values((neighbour && neighbour.templatesBySig) || {}));
}

/** Build an adapted candidate = the neighbour + a NEW signature template (its skeleton with the forged content
 *  filled). Pure + sync (the async model call is the caller's, before this). Returns null if a hole went unforged. */
function buildAdaptedCandidate( neighbour, scopeFacts, skeleton, valuesByPath, signatureKeys ) {
	const filled = fillContentHoles(skeleton, valuesByPath);
	if ( !filled ) return null;                                       // a content hole was not forged → refuse (no undefined leaf)
	const keys = signatureKeys || neighbour.signatureKeys || [];
	const sig = digest(projectFacts(scopeFacts, keys));
	const templatesBySig = Object.assign({}, neighbour.templatesBySig, { [sig]: filled });
	return { candidate: Object.assign({}, neighbour, { templatesBySig }), template: filled, sig };
}

/** The controller's adapt operator: discover the neighbour's content holes → `contentFor` fills them (the model)
 *  → build the adapted candidate. Returns null if the holes can't be auto-discovered (need ≥2 differing templates)
 *  or a hole went unforged → the caller falls back to a fresh forge. `contentFor` is sync here (the controller is
 *  sync); an async (live) host pre-forges and calls `buildAdaptedCandidate` directly. */
function antiUnifyAdapt( opts ) {
	const gen = methodContentHoles(opts.neighbour);
	if ( !gen.stable || !gen.contentVars.length ) return null;        // no auto-discoverable content holes
	const vals = opts.contentFor(gen.contentVars, opts.scopeFacts);
	const built = buildAdaptedCandidate(opts.neighbour, opts.scopeFacts, gen.skeleton, vals, opts.signatureKeys);
	return built && Object.assign(built, { outcome: 'adapt', contentVars: gen.contentVars });
}

/* ── CONCEPTUAL BLENDING at the candidate level (Boden COMBINATIONAL creativity; study §"conceptual blending"). ──
 * Graft a DONOR method's body into a HOST method's segment SLOT → a NEW method candidate that is neither (e.g. a
 * 1-level decompose host + a decompose donor → a 2-level decompose). The blend's OUTER interface (frontier +
 * signature) is the HOST's, unchanged — so the blended method dispatches + mounts exactly like the host, but with a
 * deeper, recombined body. v0 INHERITS the host contract (the donor's writes are a superset; the runtime monitor
 * `assertPost` catches drift — a COMPOSED contract over both write-sets is the follow-up). Returns null if the slot
 * is absent / does not blend in every signature class. */
function blendMethods( hostCand, donorCand, opts ) {
	opts = opts || {};
	const donorTpl = Object.values((donorCand && donorCand.templatesBySig) || {})[0];
	const entries = Object.entries((hostCand && hostCand.templatesBySig) || {});
	if ( !donorTpl || !entries.length ) return null;
	const slot = opts.atSegment || segmentSlots(entries[0][1])[0];    // default = the host's first child-segment slot
	if ( !slot ) return null;                                         // no graftable segment slot
	const templatesBySig = {};
	for ( const [sig, tpl] of entries ) { const b = blendAtSegment(tpl, slot, donorTpl); if ( !b ) return null; templatesBySig[sig] = b; }
	const hid = hostCand.schema && hostCand.schema._id, did = donorCand.schema && donorCand.schema._id;
	// the blend's contract is DERIVED (composed) from both parents, not merely inherited from the host — the donor's
	// body adds writes/posts that the host contract omits (closes the v0 "inherited contract" hole). Conservative
	// union; a fuller compose would also discharge the donor's PRE against the host's POST at the graft point.
	const composed = composeContract(hostCand.schema && hostCand.schema.contract, donorCand.schema && donorCand.schema.contract);
	const schema = Object.assign({}, hostCand.schema, composed ? { contract: composed } : {});
	return Object.assign({}, hostCand, { schema, templatesBySig, blendedFrom: [hid, did], blendSlot: slot, contractDerived: !!composed });
}

/** Compose two born-defeasible contracts (crystallize.js#synthesizeContract shape) into the blend's contract:
 *  read/write/pre/post = the de-duplicated UNION; effect = pure iff BOTH pure. Conservative (over-approximates the
 *  write footprint, conjoins both posts). Returns null only if BOTH are absent. */
function composeContract( a, b ) {
	if ( !a && !b ) return null;
	if ( !a || !b ) return Object.assign({}, a || b);
	const uniq = ( xs ) => [...new Set(xs)];
	return {
		read: uniq([...(a.read || []), ...(b.read || [])]),
		write: uniq([...(a.write || []), ...(b.write || [])]),
		pre: uniq([...(a.pre || []), ...(b.pre || [])]),
		post: uniq([...(a.post || []), ...(b.post || [])]),
		effect: (a.effect === 'pure' && b.effect === 'pure') ? 'pure' : (a.effect || b.effect || 'pure'),
	};
}

/** the signature digest a candidate would key its replay on at this site (null if it has no template for it = a miss). */
function hitTemplate( cand, scopeFacts ) {
	const sig = digest(projectFacts(scopeFacts, cand.signatureKeys || []));
	return (cand.templatesBySig || {})[sig] ? sig : null;
}

const hasSoundContract = ( cand ) => !!(cand && cand.schema && cand.schema.contract);

/**
 * Drive retrieve-or-forge for a target mechanism at a site.
 * @param opts.lib/target/scopeFacts  the library + the abstract target FrontierSignature + the call-site facts.
 * @param opts.forge   (scopeFacts, neighbours) → { candidate, outcome?:'adapt'|'forge', calls?:number } | null
 *                     the model: builds a new method (may REUSE the dispatched `neighbours` = adapt). Returns null = give up.
 * @param opts.verify  optional (candidate, scopeFacts) → boolean   a stronger gate than "has a contract" (e.g. run + assertPost).
 * @param opts.onForge optional (candidate) → void   index the forged method (default: indexMethod into opts.lib).
 * @param opts.requireContract  default true — refuse a forged method with no sound post (the verifier gate).
 * @returns { outcome:'hit'|'adapt'|'forge'|'reject', candidate?, sig?, calls, neighbours, reason? }
 */
function adaptOrForge( opts ) {
	const r = dispatch(opts.lib, opts.target, opts.scopeFacts);
	const neighbours = r.candidates.map(( e ) => e.candidate );

	// RETRIEVE — a dispatched candidate with a template for this signature: K1-sound by construction, 0 model calls.
	for ( const cand of neighbours ) {
		const sig = hitTemplate(cand, opts.scopeFacts);
		if ( sig ) return { outcome: 'hit', candidate: cand, sig, calls: 0, neighbours };
	}

	// ADAPT (antiUnify content-forge — the principled path, built INTO the controller): if a content-forger is given
	// and the top neighbour has auto-discoverable content holes, forge ONLY those holes + reuse the skeleton + the
	// structural holes verbatim (the neighbour's contract is inherited). Falls back to `opts.forge` (fresh) otherwise.
	let f = null;
	if ( opts.adaptContent && neighbours.length ) {
		const a = antiUnifyAdapt({ neighbour: neighbours[0], scopeFacts: opts.scopeFacts, signatureKeys: neighbours[0].signatureKeys, contentFor: opts.adaptContent });
		if ( a && a.candidate ) f = { candidate: a.candidate, outcome: 'adapt', calls: 1 };   // one content-forge model call
	}
	// §6.2 INTERFACE-RECALL — also offer the NAC-failing in-bucket DONORS as ADAPT SKELETONS (the methods exact dispatch
	// dropped). The forge re-forges the differing content into a NEW method with SITE-derived appConditions; the donor is
	// a skeleton source ONLY, never replayed (the gate below re-asserts the FORGED method's OWN appConditions). Loosened
	// recall, exact verify — recall.js's `partial` discipline lifted into the dispatch/appConditions space (Laurie confront).
	const donors = opts.interfaceRecall
		? dispatchInterface(opts.lib, opts.target, opts.scopeFacts, { k: opts.recallK || 3 }).proposals.map(( p ) => p.candidate)
		: [];

	// FORGE / ADAPT — the model builds it, reusing the neighbours (+ §6.2 donor skeletons) where it can. Verifier-gated, indexed.
	if ( !f ) f = opts.forge ? opts.forge(opts.scopeFacts, neighbours, donors) : null;
	if ( !f || !f.candidate ) return { outcome: 'reject', reason: 'no forge / forge failed', calls: f && f.calls || 0, neighbours };
	if ( opts.requireContract !== false && !hasSoundContract(f.candidate) )
		return { outcome: 'reject', reason: 'forged method has no sound contract (verifier gate)', calls: f.calls == null ? 1 : f.calls, neighbours };
	// §6.2 SOUNDNESS GATE (Laurie pt1, load-bearing): under interface-recall the forged/adapted method's OWN appConditions
	// must HOLD at the site — a donor replayed verbatim (its dropped NAC still failing here) is REJECTED, never mounted
	// (the #29 false-hit). `appConditionsHold` = PRESENCE for require (never `satisfies` truthiness, pt2). As sound as a fresh forge.
	if ( opts.interfaceRecall && !appConditionsHold(frontierOf(f.candidate), opts.scopeFacts || {}) )
		return { outcome: 'reject', reason: 'forged method appConditions fail at the site (donor not replayed)', calls: f.calls == null ? 1 : f.calls, neighbours };
	if ( opts.verify && !opts.verify(f.candidate, opts.scopeFacts) )
		return { outcome: 'reject', reason: 'forged method failed the host verifier', calls: f.calls == null ? 1 : f.calls, neighbours };
	(opts.onForge || (( c ) => indexMethod(opts.lib, c)))(f.candidate);
	return { outcome: f.outcome === 'adapt' ? 'adapt' : 'forge', candidate: f.candidate, calls: f.calls == null ? 1 : f.calls, neighbours };
}

/** The structural DEPTH of a method = the deepest nesting of its created mid nodes (`⟦@base⟧_m0` = 1,
 *  `⟦@base⟧_a0_m0` = 2, …). The μ-measure the blend search descends on. */
function methodDepth( cand ) {
	let max = 0;
	for ( const tpl of Object.values((cand && cand.templatesBySig) || {}) ) {
		for ( const o of (Array.isArray(tpl) ? tpl : [tpl]) ) {
			const id = o && (o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : o._id));
			if ( typeof id === 'string' && id.indexOf(BASE + '_') === 0 && /_m0$/.test(id) ) {
				const d = (id.slice(BASE.length).match(/_/g) || []).length;   // underscores in the suffix = nesting level
				if ( d > max ) max = d;
			}
		}
	}
	return max;
}

/* ── the BLEND STRATEGY (the creativity AUTOMATION; study §"well-foundedness"): when no single dispatched method
 * SATISFIES the goal, BLEND neighbours to DEEPEN — bounded compositional search with a TERMINATION guarantee.
 * Greedy + μ-descent: host = top neighbour, donor = `opts.donor` (default the top neighbour, i.e. self-deepen);
 * each blend strictly INCREASES `methodDepth` (the μ-measure), so the loop terminates at `maxDepth` (no `divergent`
 * runaway — the AO* admissible-heuristic discipline the study demanded). 0 model calls: the deeper method is
 * SYNTHESIZED from library parts, not forged. A cache cannot (it replays); crystallize cannot without ≥2 traces.
 * @param opts.lib/target/scopeFacts  as adaptOrForge (the dispatch inputs).
 * @param opts.satisfies  (candidate, scopeFacts) → bool   the goal test (host runs/mounts, or a template predicate).
 * @param opts.donor      optional candidate to graft (default = the top dispatched neighbour).
 * @param opts.maxDepth   the blend-depth cap (default 3) — the well-foundedness bound.
 * @returns { outcome:'retrieve'|'blend'|'reject', candidate, depth, calls, reason? }
 */
function synthesizeByBlend( opts ) {
	const r = dispatch(opts.lib, opts.target, opts.scopeFacts);
	const neighbours = r.candidates.map(( e ) => e.candidate );
	if ( !neighbours.length ) return { outcome: 'reject', reason: 'no neighbour to compose', candidate: null, calls: 0 };
	let cand = neighbours[0];
	if ( opts.satisfies(cand, opts.scopeFacts) ) return { outcome: 'retrieve', candidate: cand, depth: methodDepth(cand), calls: 0 };
	const donor = opts.donor || neighbours[0];
	const maxDepth = opts.maxDepth || 3;
	const underscores = ( s ) => (s.match(/_/g) || []).length;
	let last = methodDepth(cand);
	for ( let i = 0; i < maxDepth; i++ ) {
		// graft at the DEEPEST current slot so iterated blends DESCEND (each step deepens that branch by one level).
		const deepest = segmentSlots(Object.values(cand.templatesBySig)[0]).sort(( a, b ) => underscores(b) - underscores(a))[0];
		if ( !deepest ) break;
		const blended = blendMethods(cand, donor, { atSegment: deepest });
		if ( !blended ) break;                                          // no graftable slot → cannot deepen further
		const d = methodDepth(blended);
		if ( d <= last ) break;                                         // μ-descent guard: no strict progress → stop (no spin)
		last = d; cand = blended;
		if ( opts.satisfies(cand, opts.scopeFacts) ) return { outcome: 'blend', candidate: cand, depth: d, calls: 0 };
	}
	return { outcome: 'reject', reason: 'bounded blend (maxDepth/μ-descent) did not satisfy the goal', candidate: null, depth: last, calls: 0 };
}

module.exports = { adaptOrForge, hitTemplate, hasSoundContract, antiUnifyAdapt, methodContentHoles, buildAdaptedCandidate, blendMethods, segmentSlots, composeContract, synthesizeByBlend, methodDepth };
