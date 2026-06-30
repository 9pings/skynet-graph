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
	abstract     : require('./abstract'),       // F6 relativize/instantiate/antiUnify/methodTransform (structural transfer)
	abstraction  : require('./abstraction'),    // the abstraction-gate currency (applies→LLM-cost)
	mdl          : require('./mdl'),             // static bits-based MDL ranker/pre-filter in front of abstraction.evaluate (#12)
	decompose    : require('./decompose'),      // plan decomposition / forkPlan auto-tiling
	boundedMerge : require('./bounded-merge'),  // bounded N→1 projection (assume-guarantee merge interface)
	reaggregate  : require('./reaggregate'),    // defeasibleAggregate (fold-back / merge)
	memoStability: require('./memo-stability'), // memoSnapshot/memoDiff — the canonicalization-stability discipline (F4 adjudicator)
	support      : require('./support'),        // support grammar (problem-solving scaffold)

	// ── Library learning / crystallization / packaging ───────────────────────
	crystallize  : require('./crystallize'),    // distil recurrent methods from traces — provider-fusion + crystallizeStructural (re-mountable defeasible method, DECLARED frontier + reified FrontierSignature + libraryKey dispatch + lintFrontier) + synthesizeContract (CLS capstone)
	mine         : require('./mine'),           // traceMiner/methodTrace — mine producer→consumer chains + recurrent STRUCTURAL methods (mineMethods: antiUnify + K1-ceiling guard; declaredCtx = DECLARED frontier; emitEquivalence)
	hotspot      : require('./hotspot'),         // distill go/no-go detector (frequent ∧ cache-missing ∧ K1-sufficient slice) (#§4.2-B)
	recall       : require('./recall'),         // recallAndVerify index (retrieve-or-forge)
	methodPack   : require('./method-pack'),    // portable LEARNED-method package (.sgc sibling)
	corpusPack   : require('./corpus-pack'),    // .sgc corpus exchange + derived manifest
	store        : require('./store'),          // createFileStore (durable cross-restart library)

	// ── Supervision / lifecycle / runtime regime ─────────────────────────────
	supervise    : require('./supervise'),      // reactive supervisor (Stuck→hypothesize→evaluate→revert)
	relearn      : require('./relearn'),         // standing autonomous un-learn loop (blame→revise→patch as reactive concepts)
	loop         : require('./loop'),           // autonomous episode loop
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
