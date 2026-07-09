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
 * Authoring & R&D toolkit — packaged so the substrate tools are usable "à nu"
 * without deep-path requires.
 *
 *   const Graph = require('skynet-graph');
 *   const { contract, method, abstract } = Graph.authoring;   // exposed as a static, like Graph.providers
 *   contract.checkCompose(m1, m2);
 *
 * Unlike the providers barrel (which flattens function names), this barrel is
 * NAMESPACED — one key per module — because authoring modules legitimately share
 * export names (e.g. `validate` in both validate.js and bounded-merge.js,
 * `verify` in recall.js, `evaluate` in abstraction.js). Each module also stays
 * importable on its own (`require('skynet-graph/lib/authoring/contract')`) — the
 * barrel is a convenience, not a gate.
 */

module.exports = {
	// ── Concept authoring & validation ───────────────────────────────────────
	concepts     : require('./concepts'),       // buildConceptTree(dir) — JSONC concept tree
	validate     : require('./validate'),       // validateConceptTree — author-time structural validator (K1 barrier)
	author       : require('./author'),         // authorConcept — declarative AI-authoring + CEGIS loop
	contract     : require('./contract'),       // the defeasible separation-triple checker (checkCompose/assertPost/satisfies/reviseOnBlame)
	grammarGraph : require('./grammar-graph'),  // conceptFactGraph — the concept↔fact grammar graph

	// ── Concept-as-graph methods (build / select / mount / abstract) ──────────
	method       : require('./method'),         // applySubgraphArg/mapSubgraph/lintMethod/selectCluster
	mount        : require('./mount'),           // tiered mount controller (instance/inline/frozen)
	abstract     : require('./abstract'),       // F6 relativize/instantiate/antiUnify/methodTransform (structural transfer) + generalizeContent/fillContentHoles (LGG content-hole discovery for the adapt operator)
	abstraction  : require('./abstraction'),    // the abstraction-gate currency (applies→LLM-cost)
	mdl          : require('./mdl'),             // static bits-based MDL ranker/pre-filter in front of abstraction.evaluate (#12)
	decompose    : require('./decompose'),      // plan decomposition / forkPlan auto-tiling
	registry     : require('./registry'),       // G-1 the interface-alphabet REGISTRY (Σ_sep): curated+versioned vocab CATALOG — deriveRegistry/freezeRegistry/specForKey (rings live here)/mergeRingProposals (borderline proposals, confluence re-checked)/checkTreeAgainstRegistry (enforce the frozen canon)
	extract      : require('./extract'),        // bounded subgraph EXTRACTION for fork / multi-process ship (program slicing: segment-closed 1-hop ball + frozen frontier; mergeSlice = single-writer + assumption-recheck; the fork/ship lever, ZERO-CORE)
	boundedMerge : require('./bounded-merge'),  // bounded N→1 projection (assume-guarantee merge interface)
	reaggregate  : require('./reaggregate'),    // defeasibleAggregate (fold-back / merge)
	memoStability: require('./memo-stability'), // memoSnapshot/memoDiff — the canonicalization-stability discipline (F4 adjudicator)
	support      : require('./support'),        // support grammar (problem-solving scaffold)

	// ── Library learning / crystallization / packaging ───────────────────────
	crystallize  : require('./crystallize'),    // distil recurrent methods from traces — provider-fusion + crystallizeStructural (re-mountable defeasible method, DECLARED frontier + reified FrontierSignature + libraryKey dispatch + lintFrontier) + synthesizeContract (CLS capstone)
	mine         : require('./mine'),           // traceMiner/methodTrace — mine producer→consumer chains + recurrent STRUCTURAL methods (mineMethods: antiUnify + K1-ceiling guard; declaredCtx = DECLARED frontier; emitEquivalence)
	compress     : require('./compress'),       // the DIGRAM-grain affinity miner (2026-07-03 GO kill-gate): adjacent-pair support + dispatchable sub-expansion index (K1 rule, kind|ctx grains) + mdl.js-ΔL fold + typed-loop-parity subpath patches + the method-FOREST skeleton
	library      : require('./library'),        // the method-library index + dispatch (the structuring↔concept-DLL juncture): O(1) libraryKey bucket → refine by app-conditions → ranked candidates
	combinator   : require('./combinator'),     // the dispatch→MOUNT bridge (P2.5): a higher-order concept fills its behavioral hole with a DISPATCHED library fragment (recombination at 0 calls; durable guard, not the self-flag)
	adapt        : require('./adapt'),          // the adapt-or-forge CONTROLLER (the creative loop's drive): retrieve(hit,0-call) → forge/adapt via the model (reuse neighbours) → verifier-gate (contract) → index back (amortise). antiUnifyAdapt = the principled CONTENT-FORGE adapt (LGG auto-discovers content holes, forge only those, reuse skeleton; opts.adaptContent)
	hotspot      : require('./hotspot'),         // distill go/no-go detector (frequent ∧ cache-missing ∧ K1-sufficient slice) (#§4.2-B)
	composeHotspot: require('./compose-hotspot'),// compress.js kill-gate, STRUCTURAL half: does a data-flow composite RECUR cross-distinct-task? (interleave-robust provenance chains + RE-PAIR; G-a poly ceiling)
	costProbe    : require('./cost-probe'),      // compress.js kill-gate, COST half: does a composite-memo elide FORGE calls the leaf floor can't? (the thin canonicalization-in-context band — the axis that actually decides the build)
	recall       : require('./recall'),         // recallAndVerify index (retrieve-or-forge)
	methodPack   : require('./method-pack'),    // portable LEARNED-method package (.sgc sibling)
	corpusPack   : require('./corpus-pack'),    // .sgc corpus exchange + derived manifest
	latticePack  : require('./lattice-pack'),   // portable TYPED-LATTICE package (.sgc sibling — registry: isa vocab + grown rings)
	methodExplorer: require('./method-explorer'), // list+judge a concept-method population (title/category/description + coverage/openness)
	retention    : require('./retention'),      // usage-tracked + self-evicting store (the reuse/keep-or-evict axis; sibling of lifecycle's plasticity axis)
	store        : require('./store'),          // createFileStore (durable cross-restart library)
	stock        : require('./stock'),          // gold-gated concept-method STOCK building (goldGate + consistencyVote + packStock) — the reusable core of the dataset-stock pilot
	ground       : require('./ground'),         // gold-mined GROUNDING RINGS (mineGroundingRings + ringTouch) — surface form → vocab unit through the ring gate (the 2026-07-06 cells' core)
	datasetAdapter: require('./dataset-adapter'), // labelled query dataset → {query,context,klass,goldShape} (WikiSQL built-in; register more) — "plusieurs datasets" one registry away

	// ── Supervision / lifecycle / runtime regime ─────────────────────────────
	supervise    : require('./supervise'),      // reactive supervisor (Stuck→hypothesize→evaluate→revert)
	relearn      : require('./relearn'),         // standing autonomous un-learn loop (blame→revise→patch as reactive concepts)
	loop         : require('./loop'),           // autonomous episode loop
	typedLoop    : require('./typed-loop'),     // the fused RECURSIVE TYPED decompose operator (loop.js emergent depth × canon-snapped stepKind children, prose untracked → the decompose trace is K1-crystallizable)
	rebalance    : require('./rebalance'),       // R1 the DEFEASIBLE REBALANCING FIXPOINT (E2∘E1∘E3∘E4 under a lexicographic measure; kill-gated KG-R1b) — drives a degenerate plan to a balanced fixpoint; usable à nu
	dagDecompose : require('./dag-decompose'),   // model-driven TYPED DAG DECOMPOSE (study 2026-07-08 §6.1): decompose PROMPT + grammar-constrained decoding → a needs/produces DAG (stepKind on a closed enum = the K1 barrier); makeDagDecompose = plan-loop's decompose seam feeding the projection
	contextProject: require('./context-project'),// R1 §2 GRAPH-NATIVE CONTEXT PROJECTION (pool ref-parent + counter gate + recursive down-projection/remontée) — each node completes its BOUNDED context from structure; guardPlan (recursive deadlock guard) + createContextProjection; the real projection wired into plan-loop
	soundInvoke  : require('./sound-invoke'),    // P4 the CONSTAT operationalized: soundInvokeMerge = assertPost (G1 frame via the P1 write-footprint + post-holds + G2 oracle) → mergeSlice (assumption-recheck + single-writer) → sequenced commit; a violation REFUSES (blame for reviseOnBlame) so composé-cross-instance ≡ plat, *sainement*
	segmentProxy : require('./segment-proxy'),   // P2 the reactive SEGMENT-PROXY: makeSegmentProxy = a concept-method that casts on its contract's conditions → delegates via the P1 invoke → gates via P4 assertPost → posts summaryFacts JTMS-visible (the good C.8: an interface). Cast = the cost gradient: delegate → gate → LAST-RESORT forge fallback (reconstructStack up the parentSeg chain, bounded; forge re-enters the gate) — the §5 plasticity hook
	serveLeaf    : require('./serve-leaf'),      // P6 the UNIFICATION: makeMethodServe = a projection serve(leaf) that DISPATCHES (libraryKey) + MOUNTS a concept-method (invoked on a P3 shared instance, gated by P4) — a leaf IS a mounted method, not an opaque value; folds projection + runtime + library + method into one structure
	higherOrder  : require('./higher-order'),    // §5(a) the METHOD-SLOT / higher-order need: makeHigherOrderServe = a "loop" method whose behavioural hole (the body / stop predicate) is filled by a DISPATCHED sub-method (P2), applied (map/all/any/fold) over items — swap the dispatched body → different behaviour = the loop-in-loop (soundness across the hop = KG-PROXY-2 GO)
	forgeFallback: require('./forge-fallback'),  // §5(b) the last-resort LEARNING fallback wired for P2's forge hook: reconstructStack → stackToPrompt (the LEVER) → forge (the model) → RE-ENTER the gate (assertPost DISPOSES a bad forge) → INDEX-BACK (amortise; next matching case = a dispatch hit). `maxRounds>1` = the BOUNDED BLAME-DRIVEN RETRY (residue USE-2(d), the OPEN-regime DUAL of negotiate): on a refusal, fold the violated atoms + rejected-history into the next prompt and revise, bounded → typed refusal. LIVE-PROVEN 17/24→24/24 at 0-false. Default maxRounds 1 = one-shot, byte-identical
	forest       : require('./forest'),          // §5(c) the MULTI-PATH generalization: makeForestServe = a concept-method as a LIBRARY of alternative sub-paths; the FIRST candidate that dispatches+mounts+GATES sound is SELECTED (one stays active — the confluence guarantee that dodges G3: SELECT one path, never COMPOSE coupled retractable methods → no oscillation). Forest exhausted → the §5(b) forge
	negotiate    : require('./negotiate'),        // the bounded LLM↔GRAPH dialogue (CLOSED-domain): model PROPOSES a typed candidate → graph GATES (assertPost) → on mismatch, blame + ENUMERATED admissible options (tested through the gate, not guessed) → revision prompt → revise, bounded K. 0-false · honest refusal (empty options, never forced) · termination. The closed-domain sibling of forge-fallback's open-regime blame-retry
	masterLoop   : require('./master-loop'),    // always-on master-loop (retrieve-or-forge→switch→bounded-context)
	lifecycle    : require('./lifecycle'),      // onCast/teardown lifecycle helpers
	clock        : require('./clock'),          // makeReaper / TTL clock (live regime)
	hysteresis   : require('./hysteresis'),     // makeHysteresis — band stabilization

	// ── Experimental / shelved (probabilistic concept-nets — see studies) ─────
	conceptNet   : require('./concept-net'),    // (shelved) concept-net populations at the fixpoint
	graphNet     : require('./graph-net'),      // (shelved) graph-net variant
	equilibrium  : require('./equilibrium'),    // (shelved) implicit-equilibrium solver
	ste          : require('./ste')             // (shelved) straight-through soft-train/hard-infer
};
