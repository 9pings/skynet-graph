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
 * importable on its own (`require('skynet-graph/lib/authoring/core/contract')`) — the
 * barrel is a convenience, not a gate. The modules are LAYERED by decomposition role
 * (2026-07-16 map): `core/` = the hubs that stay in lib (contract/validation, supervision/
 * lifecycle, concept-as-graph methods, exchange/persist) · `learning/` = the DLL/distillation
 * family (a future plugins/learning) · `forge/` = dataset→certified-stock (future plugins/forge
 * engine) · `lattice/` = the typed-vocabulary registry family (pure utilities, stays in lib).
 * Dependencies only point DOWN: learning/forge/lattice → core, forge → learning/lattice.
 */

module.exports = {
	// ── Concept authoring & validation ───────────────────────────────────────
	concepts     : require('./core/concepts'),       // buildConceptTree(dir) — JSONC concept tree
	validate     : require('./core/validate'),       // validateConceptTree — author-time structural validator (K1 barrier)
	author       : require('./core/author'),         // authorConcept — declarative AI-authoring + CEGIS loop
	contract     : require('./core/contract'),       // the defeasible separation-triple checker (checkCompose/assertPost/satisfies/reviseOnBlame)
	grammarGraph : require('./core/grammar-graph'),  // conceptFactGraph — the concept↔fact grammar graph

	// ── Concept-as-graph methods (build / select / mount / abstract) ──────────
	method       : require('./core/method'),         // applySubgraphArg/mapSubgraph/lintMethod/selectCluster
	mount        : require('./core/mount'),           // tiered mount controller (instance/inline/frozen)
	abstract     : require('./core/abstract'),       // F6 relativize/instantiate/antiUnify/methodTransform (structural transfer) + generalizeContent/fillContentHoles (LGG content-hole discovery for the adapt operator)
	abstraction  : require('./core/abstraction'),    // the abstraction-gate currency (applies→LLM-cost)
	mdl          : require('./core/mdl'),             // static bits-based MDL ranker/pre-filter in front of abstraction.evaluate (#12)
	decompose    : require('./core/decompose'),      // plan decomposition / forkPlan auto-tiling
	registry     : require('./lattice/registry'),       // G-1 the interface-alphabet REGISTRY (Σ_sep): curated+versioned vocab CATALOG — deriveRegistry/freezeRegistry/specForKey (rings live here)/mergeRingProposals (borderline proposals, confluence re-checked)/checkTreeAgainstRegistry (enforce the frozen canon)
	extract      : require('./core/extract'),        // bounded subgraph EXTRACTION for fork / multi-process ship (program slicing: segment-closed 1-hop ball + frozen frontier; mergeSlice = single-writer + assumption-recheck; the fork/ship lever, ZERO-CORE)
	boundedMerge : require('./core/bounded-merge'),  // bounded N→1 projection (assume-guarantee merge interface)
	reaggregate  : require('./core/reaggregate'),    // defeasibleAggregate (fold-back / merge)
	memoStability: require('./core/memo-stability'), // memoSnapshot/memoDiff — the canonicalization-stability discipline (F4 adjudicator)
	// (`support` — the problem-solving scaffold — moved to plugins/planner/lib/support.js with the C7 cluster)

	// ── Library learning / crystallization / packaging ───────────────────────
	// (the DLL family — crystallize/mine/adapt/library/method-pack/… — moved to plugins/learning/lib/ ;
	//  reach it via require('plugins/learning/lib/…') or Graph.combos.createLearningLibrary)
	corpusPack   : require('./core/corpus-pack'),    // .sgc corpus exchange + derived manifest
	latticePack  : require('./lattice/lattice-pack'),   // portable TYPED-LATTICE package (.sgc sibling — registry: isa vocab + grown rings)
	retention    : require('./core/retention'),      // usage-tracked + self-evicting store (the reuse/keep-or-evict axis; sibling of lifecycle's plasticity axis)
	store        : require('./core/store'),          // createFileStore (durable cross-restart library)
	stock        : require('./forge/stock'),          // gold-gated concept-method STOCK building (goldGate + consistencyVote + packStock) — the reusable core of the dataset-stock pilot
	ground       : require('./forge/ground'),         // gold-mined GROUNDING RINGS (mineGroundingRings + ringTouch) — surface form → vocab unit through the ring gate (the 2026-07-06 cells' core)
	glossary     : require('./lattice/glossary'),       // P2 the cross-round terminology REFERENCE: createGlossary = a persistent lattice-backed store of canonical GROUNDED notions (harvest = witness-overlap SELECTS the member + mergeRingProposals ADMITS the alias under confluence, audited/versioned/retractable; reconcile = JTMS entry-retract with cascade; inject = citable-vocabulary block). The managed reference the re-split needs — ZERO-CORE (assembles registry.js + canonicalize.js)
	granularity  : require('./lattice/granularity'),    // P2 the STRUCTURAL granularity ARBITER (the sonde's grounded dimensions): clusterByGrounding = connected components on the witness co-citation graph; arbitrate = the lazy 2-régime verdict (coherent | MIXED = the re-plan `frame: TOO-NARROW` grounded signal | unstructured = escalate to Q2). No prose parsing — dimensions come from grounding, never fabricated. ZERO-CORE
	datasetAdapter: require('./forge/dataset-adapter'), // labelled query dataset → {query,context,klass,goldShape} (WikiSQL built-in; register more) — "plusieurs datasets" one registry away

	// ── Supervision / lifecycle / runtime regime ─────────────────────────────
	supervise    : require('./core/supervise'),      // reactive supervisor (Stuck→hypothesize→evaluate→revert)
	relearn      : require('./core/relearn'),         // standing autonomous un-learn loop (blame→revise→patch as reactive concepts)
	loop         : require('./core/loop'),           // autonomous episode loop
	typedLoop    : require('./core/typed-loop'),     // the fused RECURSIVE TYPED decompose operator (loop.js emergent depth × canon-snapped stepKind children, prose untracked → the decompose trace is K1-crystallizable)
	// ── the C7 plan-loop / projection cluster MOVED to plugins/planner/lib/ (rebalance, dag-decompose,
	// context-project, sound-invoke, segment-proxy, serve-leaf, higher-order, forge-fallback, forest,
	// split-serve, negotiate, slot-aware-serve, givens, support, leaf-io — owner: the specific goes into
	// its plugin). Reach them via require('plugins/planner/lib/…') or Graph.combos.createPlanLoop. ──
	lifecycle    : require('./core/lifecycle'),      // onCast/teardown lifecycle helpers
	clock        : require('./core/clock'),          // makeReaper / TTL clock (live regime)
	hysteresis   : require('./core/hysteresis')      // makeHysteresis — band stabilization
	// The shelved probabilistic concept-nets (concept-net / graph-net / equilibrium / ste) moved OUT of
	// lib to `experiments/probabilistic-concepts/` (07-16 decomposition, group 5 = experiments): they were
	// test/POC-only, carried hard-coded grammar, and never sat on the shipped path.
};
