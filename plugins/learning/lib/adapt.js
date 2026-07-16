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
 *             sound contract — the refuse-no-contract gate is HERE, not in crystallizeStructural, which admits a
 *             contractless method) → index back so the next encounter HITS
 *             (amortise). The measured master-loop retrieve-or-forge; the verifier is the born-defeasible contract.
 *
 * The contract's POST is an OUTPUT invariant (true after the method runs) — so it is NOT a pre-dispatch gate (that is
 * the app-conditions, refined in dispatch). The gate here is "the forged method comes with a sound post" + an optional
 * host `verify` hook (run it + `assertPost`); a drift that breaks the post is caught by the runtime monitor (the moat).
 */
const { dispatch, indexMethod, dispatchInterface, appConditionsHold, frontierOf } = require('./library.js');
const { generalizeContent, fillContentHoles, blendAtSegment, combineAtFork, BASE } = require('../../../lib/authoring/core/abstract.js');
const { digest } = require('../../../lib/providers/canonicalize.js');
const { checkCompose } = require('../../../lib/authoring/core/contract.js');

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
	// The graft is CONTRACT-CHECKED at the interface (H2 — `checkCompose` was dead-wired; the compose path used to
	// blindly union an UNVERIFIED contract that `hasSoundContract` then accepted). checkCompose(host, donor) discharges
	// the donor's PRE against the host's POST on the shared write→read keys. DEFEASIBLE — "a formal system is a GROUND,
	// not a ceiling": a provably-`unsound` graft (the donor requires what the host contradicts) is REFUSED; an
	// under-determined (`escalate`) one is ADMITTED and FLAGGED (`composeVerdict`) so the runtime `assertPost` monitor —
	// the moat — checks it at mount rather than the synthesis over-refusing what it cannot statically decide.
	const verdict = checkCompose(hostCand.schema, donorCand.schema).verdict;
	if ( verdict === 'unsound' ) return null;                         // donor.pre provably contradicts host.post → refuse the graft
	// the blend's contract is DERIVED (composed) from both parents, not merely inherited — the donor's body adds
	// writes/posts the host omits (closes the v0 "inherited contract" hole). Conservative union; the interface is now
	// discharged above (the composed post is still runtime-monitored by `assertPost` for the `escalate` residue).
	const composed = composeContract(hostCand.schema && hostCand.schema.contract, donorCand.schema && donorCand.schema.contract);
	const schema = Object.assign({}, hostCand.schema, composed ? { contract: composed } : {});
	return Object.assign({}, hostCand, { schema, templatesBySig, blendedFrom: [hid, did], blendSlot: slot, contractDerived: !!composed, composeVerdict: verdict });
}

/* ── BINARY COMBINATION — the SECOND composition operator (sibling to blendMethods). Where a blend NESTS a donor
 * into a host slot (series → a deeper single query, with an interface obligation the donor.pre ⊨ host.post check
 * discharges), a combine runs TWO complete methods in PARALLEL from the same origin and joins their results with a
 * SET OPERATION (∩/∪/−) → a NEW method whose result = op(left,right). This is a SQL set-op query (`A INTERSECT B`):
 * two INDEPENDENT sub-queries over the same source. Because the branches are independent (no data flows left→right),
 * there is NO interface to discharge — so no checkCompose (unlike blend); the combined contract is just the derived
 * UNION of both. Provenance in `combinedFrom`. The combined method's BODY is the LEFT's frontier (origin→target),
 * but it COVERS the set-op class, not LEFT's operand class — so `opts.outerClass` RE-KEYS it (frontier /
 * signatureKeys / libraryKey from the class the combine is invoked for) so it dispatches on the set-op signature and
 * never false-hits a plain operand task (which stays in its own bucket). Without `outerClass` it inherits LEFT's key
 * (back-compat: the direct-mount path in combine-methods-setop.test.js keys it by hand and never dispatches).
 * Returns null if either method is empty. 0 model calls (pure structural recombination of two distilled grammars). */
function combineMethods( leftCand, rightCand, op, outerClass ) {
	const rEntries = Object.values((rightCand && rightCand.templatesBySig) || {});
	const lEntries = Object.entries((leftCand && leftCand.templatesBySig) || {});
	if ( !rEntries.length || !lEntries.length ) return null;
	const rightTpl = rEntries[0];
	const templatesBySig = {};
	for ( const [sig, ltpl] of lEntries ) { const c = combineAtFork(ltpl, rightTpl, op); if ( !c ) return null; templatesBySig[sig] = c; }
	const lid = leftCand.schema && leftCand.schema._id, rid = rightCand.schema && rightCand.schema._id;
	const composed = composeContract(leftCand.schema && leftCand.schema.contract, rightCand.schema && rightCand.schema.contract);
	const schema = Object.assign({}, leftCand.schema, composed ? { contract: composed } : {});
	const combined = Object.assign({}, leftCand, { schema, templatesBySig, combinedFrom: [lid, rid], setop: op, contractDerived: !!composed });
	// RE-KEY to the OUTER set-op class (opt-in) — so indexMethod/dispatch bucket the combined method by the set-op
	// signature, not LEFT's operand class. The stale inherited libraryKey is dropped so keyOf recomputes from the
	// new frontier+signatureKeys (unless outerClass carries an explicit libraryKey).
	if ( outerClass ) {
		if ( outerClass.frontier ) { combined.frontier = outerClass.frontier; schema.frontier = outerClass.frontier; }
		if ( outerClass.signatureKeys ) combined.signatureKeys = outerClass.signatureKeys.slice();
		if ( outerClass.libraryKey ) { combined.libraryKey = outerClass.libraryKey; schema.libraryKey = outerClass.libraryKey; }
		else { delete combined.libraryKey; delete schema.libraryKey; }
	}
	return combined;
}

/** The CANONICAL atom key — `$x==1` ≡ `x==1` ≡ `x == 1` (the Laurie-G3 atom-form fix: synthesizeContract emits
 *  bare atoms, reviseOnBlame/widenOnVerified emit `$`-prefixed ones; provenance matching must not care). Kept a
 *  READABLE atom string: leading ref-prefix stripped + whitespace removed — the same surface both the contract
 *  emitters produce, so a postFrom key stays greppable/debuggable (never an opaque serialization). */
const canonAtom = ( s ) => String(s).replace(/^\$\$?/, '').replace(/\s+/g, '');

/** Compose two born-defeasible contracts (crystallize.js#synthesizeContract shape) into the blend's contract:
 *  read/write/pre/post = the de-duplicated UNION; effect = pure iff BOTH pure. Conservative (over-approximates the
 *  write footprint, conjoins both posts). Returns null only if BOTH are absent.
 *  H3: the composed contract carries `postFrom` — which PARENT's post contributed each (canonical) post atom
 *  ('host' | 'donor' | 'both') — the graft-provenance the blame rule needs to avoid corrupting the standalone
 *  library (a=host, b=donor, matching the blendMethods call). */
function composeContract( a, b ) {
	if ( !a && !b ) return null;
	const postFrom = {};
	for ( const p of ((a && a.post) || []) ) postFrom[canonAtom(p)] = 'host';
	for ( const p of ((b && b.post) || []) ) { const k = canonAtom(p); postFrom[k] = postFrom[k] === 'host' ? 'both' : 'donor'; }
	if ( !a || !b ) return Object.assign({}, a || b, { postFrom });
	const uniq = ( xs ) => [...new Set(xs)];
	return {
		read: uniq([...(a.read || []), ...(b.read || [])]),
		write: uniq([...(a.write || []), ...(b.write || [])]),
		pre: uniq([...(a.pre || []), ...(b.pre || [])]),
		post: uniq([...(a.post || []), ...(b.post || [])]),
		effect: (a.effect === 'pure' && b.effect === 'pure') ? 'pure' : (a.effect || b.effect || 'pure'),
		postFrom,
	};
}

/** H3 — graft-provenance BLAME (the Laurie-G rule; the naive "carry blendedFrom into reviseOnBlame and blame
 *  the donor" OVER-PENALIZES a good donor for a bad composition and corrupts the standalone library). Given the
 *  post atoms `assertPost` reported violated on a mounted COMPOSITE, attribute each to an axis:
 *    'donor'  the atom is donor-only provenance on a `sound` graft → the donor's OWN post failed where used →
 *             the fix is revising the DONOR's pre (reviseOnBlame on the donor);
 *    'host'   symmetric;
 *    'graft'  provenance 'both' / unknown atom / `composeVerdict === 'escalate'` (the statically-undischarged
 *             interface — the prime suspect is the graft itself) → revise/retract the COMPOSITE only, parents
 *             stay intact.
 *  Overall axis = 'donor' (resp. 'host') iff EVERY failed atom reads donor (resp. host); anything mixed or
 *  uncertain → 'graft' (conservative: when in doubt, narrow the composite, never a parent).
 *  @returns { perAtom:[{atom,axis}], axis, host, donor, slot } — host/donor/slot from blendedFrom/blendSlot. */
function attributeCompositeBlame( opts ) {
	const composite = (opts && opts.composite) || {};
	const contract = (composite.schema && composite.schema.contract) || composite.contract || {};
	const postFrom = contract.postFrom || {};
	const escalate = composite.composeVerdict === 'escalate';
	const perAtom = ((opts && opts.failedAtoms) || []).map(( atom ) => {
		const prov = postFrom[canonAtom(atom)];
		const axis = escalate ? 'graft' : (prov === 'donor' ? 'donor' : (prov === 'host' ? 'host' : 'graft'));
		return { atom, axis };
	});
	const axes = new Set(perAtom.map(( x ) => x.axis));
	const axis = (axes.size === 1 && !axes.has('graft')) ? [...axes][0] : 'graft';
	const bf = composite.blendedFrom || [];
	return { perAtom, axis, host: bf[0], donor: bf[1], slot: composite.blendSlot };
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
	const pre = _retrieveOrPrepare(opts);
	if ( pre.done ) return pre.done;
	const { neighbours, donors } = pre;

	// ADAPT (antiUnify content-forge — the principled path, built INTO the controller): if a content-forger is given
	// and the top neighbour has auto-discoverable content holes, forge ONLY those holes + reuse the skeleton + the
	// structural holes verbatim (the neighbour's contract is inherited). Falls back to `opts.forge` (fresh) otherwise.
	let f = null;
	if ( opts.adaptContent && neighbours.length ) {
		const a = antiUnifyAdapt({ neighbour: neighbours[0], scopeFacts: opts.scopeFacts, signatureKeys: neighbours[0].signatureKeys, contentFor: opts.adaptContent });
		if ( a && a.candidate ) f = { candidate: a.candidate, outcome: 'adapt', calls: 1 };   // one content-forge model call
	}
	// BLEND (B.4 — compositional reuse, Boden combinational; opt-in `opts.blend`): before paying for a fresh
	// FORGE, GRAFT a donor method into the host neighbour's segment slot — a STRUCTURAL recombination of two
	// existing methods (0 model calls, contract-checked in blendMethods). If it does not graft (no slot /
	// provably unsound) it falls through to forge; the blended candidate is then verifier-gated like any forge.
	if ( !f && opts.blend && neighbours.length ) {
		const donor = donors[0] || opts.donor;
		const b = donor && blendMethods(neighbours[0], donor, typeof opts.blend === 'object' ? opts.blend : {});
		if ( b ) f = { candidate: b, outcome: 'blend', calls: 0 };
	}
	// COMBINE (the 2nd composition operator — set-op; opt-in `opts.combine`, sibling to blend): before a fresh FORGE,
	// if the host resolves this task as a set-op over two library methods, run them in PARALLEL and join with the op
	// → a NEW method at 0 model calls (combineMethods). The host callback OWNS the decomposition (which two operands +
	// which op), like target/dispatchFacts; the controller supplies the dispatched lib + facts and re-keys the result
	// to the set-op class (spec.outerClass, default opts.target) so it never false-hits a plain operand task.
	if ( !f && opts.combine ) {
		const spec = opts.combine(opts.scopeFacts, opts.lib, neighbours, donors);
		const c = spec && spec.left && spec.right && spec.op && combineMethods(spec.left, spec.right, spec.op, spec.outerClass || opts.target);
		if ( c ) f = { candidate: c, outcome: 'combine', calls: 0 };
	}
	// FORGE / ADAPT — the model builds it, reusing the neighbours (+ §6.2 donor skeletons) where it can. Verifier-gated, indexed.
	if ( !f ) f = opts.forge ? opts.forge(opts.scopeFacts, neighbours, donors) : null;
	const rej = _rejectForged(opts, f, neighbours);
	if ( rej ) return rej;
	if ( opts.verify && !opts.verify(f.candidate, opts.scopeFacts) )
		return { outcome: 'reject', reason: 'forged method failed the host verifier', calls: f.calls == null ? 1 : f.calls, neighbours };
	return _acceptForged(opts, f, neighbours);
}

/**
 * The ASYNC twin of `adaptOrForge` — the SAME retrieve/adapt/forge ladder and the SAME gates (shared
 * helpers below, single source), for a LIVE host whose `forge` / `adaptContent` / `verify` are model
 * calls (async). This is the brick a thin assembly (lib/combos/learning-library.js P3) wires as the
 * master-loop's FORGE arm — without it, an async forge's Promise would fail `f.candidate` and every
 * forge would silently `reject` (the sync controller cannot await).
 * Same params as `adaptOrForge`; `forge`/`adaptContent`/`verify` may return promises.
 * @returns Promise<{ outcome:'hit'|'adapt'|'forge'|'reject', candidate?, sig?, calls, neighbours, reason? }>
 */
async function adaptOrForgeAsync( opts ) {
	const pre = _retrieveOrPrepare(opts);
	if ( pre.done ) return pre.done;
	const { neighbours, donors } = pre;

	// ADAPT — the awaited variant of `antiUnifyAdapt` (its docstring's "an async host pre-forges" path,
	// packaged): discover the holes, AWAIT the content-forge, rebuild via the same pure builder.
	let f = null;
	if ( opts.adaptContent && neighbours.length ) {
		const gen = methodContentHoles(neighbours[0]);
		if ( gen.stable && gen.contentVars.length ) {
			const vals = await opts.adaptContent(gen.contentVars, opts.scopeFacts);
			const built = vals && buildAdaptedCandidate(neighbours[0], opts.scopeFacts, gen.skeleton, vals, neighbours[0].signatureKeys);
			if ( built && built.candidate ) f = { candidate: built.candidate, outcome: 'adapt', calls: 1 };
		}
	}
	// BLEND (B.4) — the async twin's compositional-reuse rung (opt-in `opts.blend`): graft a donor into the host
	// neighbour before a fresh FORGE (0 model calls, contract-checked); the async verifier below gates it.
	if ( !f && opts.blend && neighbours.length ) {
		const donor = donors[0] || opts.donor;
		const b = donor && blendMethods(neighbours[0], donor, typeof opts.blend === 'object' ? opts.blend : {});
		if ( b ) f = { candidate: b, outcome: 'blend', calls: 0 };
	}
	// COMBINE (opt-in `opts.combine`) — the async twin's set-op composition rung (may resolve operands async).
	if ( !f && opts.combine ) {
		const spec = await opts.combine(opts.scopeFacts, opts.lib, neighbours, donors);
		const c = spec && spec.left && spec.right && spec.op && combineMethods(spec.left, spec.right, spec.op, spec.outerClass || opts.target);
		if ( c ) f = { candidate: c, outcome: 'combine', calls: 0 };
	}
	if ( !f ) f = opts.forge ? await opts.forge(opts.scopeFacts, neighbours, donors) : null;
	const rej = _rejectForged(opts, f, neighbours);
	if ( rej ) return rej;
	if ( opts.verify && !(await opts.verify(f.candidate, opts.scopeFacts)) )
		return { outcome: 'reject', reason: 'forged method failed the host verifier', calls: f.calls == null ? 1 : f.calls, neighbours };
	return _acceptForged(opts, f, neighbours);
}

/** RETRIEVE phase, shared by both controllers: dispatch → a template hit is K1-sound by construction
 *  (0 model calls, `done`); else the neighbours + the §6.2 interface-recall DONOR skeletons (the
 *  NAC-failing in-bucket methods exact dispatch dropped — skeleton sources ONLY, never replayed:
 *  `_rejectForged` re-asserts the FORGED method's OWN appConditions; Laurie confront). */
function _retrieveOrPrepare( opts ) {
	const r = dispatch(opts.lib, opts.target, opts.scopeFacts);
	const neighbours = r.candidates.map(( e ) => e.candidate );
	for ( const cand of neighbours ) {
		const sig = hitTemplate(cand, opts.scopeFacts);
		if ( sig ) return { done: { outcome: 'hit', candidate: cand, sig, calls: 0, neighbours } };
	}
	const donors = opts.interfaceRecall
		? dispatchInterface(opts.lib, opts.target, opts.scopeFacts, { k: opts.recallK || 3 }).proposals.map(( p ) => p.candidate)
		: [];
	return { neighbours, donors };
}

/** The forged-method REJECT gates, shared by both controllers (single source — the two paths must never
 *  disagree): no candidate → reject; no sound contract (unless `requireContract:false`) → reject; under
 *  interface-recall, the forged method's OWN appConditions must HOLD at the site — a donor replayed
 *  verbatim (its dropped NAC still failing here) is REJECTED, never mounted (the #29 false-hit;
 *  `appConditionsHold` = PRESENCE for require, never `satisfies` truthiness). Returns null = pass. */
function _rejectForged( opts, f, neighbours ) {
	if ( !f || !f.candidate ) return { outcome: 'reject', reason: 'no forge / forge failed', calls: f && f.calls || 0, neighbours };
	if ( opts.requireContract !== false && !hasSoundContract(f.candidate) )
		return { outcome: 'reject', reason: 'forged method has no sound contract (verifier gate)', calls: f.calls == null ? 1 : f.calls, neighbours };
	if ( opts.interfaceRecall && !appConditionsHold(frontierOf(f.candidate), opts.scopeFacts || {}) )
		return { outcome: 'reject', reason: 'forged method appConditions fail at the site (donor not replayed)', calls: f.calls == null ? 1 : f.calls, neighbours };
	return null;
}

/** Accept a gated forged/adapted method: index it (default into `opts.lib`) + the outcome record. */
function _acceptForged( opts, f, neighbours ) {
	(opts.onForge || (( c ) => indexMethod(opts.lib, c)))(f.candidate);
	const outcome = f.outcome === 'adapt' ? 'adapt' : f.outcome === 'blend' ? 'blend' : f.outcome === 'combine' ? 'combine' : 'forge';
	return { outcome, candidate: f.candidate, calls: f.calls == null ? 1 : f.calls, neighbours, blendedFrom: f.candidate && f.candidate.blendedFrom, combinedFrom: f.candidate && f.candidate.combinedFrom };
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

module.exports = { adaptOrForge, adaptOrForgeAsync, hitTemplate, hasSoundContract, antiUnifyAdapt, methodContentHoles, buildAdaptedCandidate, blendMethods, combineMethods, segmentSlots, composeContract, attributeCompositeBlame, synthesizeByBlend, methodDepth, canonAtom };
