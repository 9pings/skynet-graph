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
 * export names (e.g. `validate` in validate.js, `evaluate` in abstraction.js).
 * Each module also stays importable on its own
 * (`require('skynet-graph/lib/authoring/contract')`) — the barrel is a
 * convenience, not a gate.
 */

module.exports = {
	// ── Concept authoring & validation ───────────────────────────────────────
	concepts     : require('./concepts'),       // buildConceptTree(dir) — JSONC concept tree
	validate     : require('./validate'),       // validateConceptTree — author-time structural validator (K1 barrier)
	contract     : require('./contract'),       // the defeasible separation-triple checker (checkCompose/assertPost/satisfies/reviseOnBlame)
	grammarGraph : require('./grammar-graph'),  // conceptFactGraph — the concept↔fact grammar graph

	// ── Concept-as-graph methods (build / select / abstract) ──────────────────
	method       : require('./method'),         // applySubgraphArg/mapSubgraph/lintMethod/selectCluster
	abstract     : require('./abstract'),       // F6 relativize/instantiate/antiUnify/methodTransform (structural transfer) + generalizeContent/fillContentHoles (LGG content-hole discovery for the adapt operator)
	abstraction  : require('./abstraction'),    // the abstraction-gate currency (applies→LLM-cost)
	mdl          : require('./mdl'),             // static bits-based MDL ranker/pre-filter in front of abstraction.evaluate (#12)
	decompose    : require('./decompose'),      // plan decomposition / forkPlan auto-tiling
	registry     : require('./registry'),       // G-1 the interface-alphabet REGISTRY (Σ_sep): curated+versioned vocab CATALOG — deriveRegistry/freezeRegistry/specForKey (rings live here)/mergeRingProposals (borderline proposals, confluence re-checked)/checkTreeAgainstRegistry (enforce the frozen canon)
	memoStability: require('./memo-stability'), // memoSnapshot/memoDiff — the canonicalization-stability discipline (F4 adjudicator)
	support      : require('./support'),        // support grammar (problem-solving scaffold)

	// ── Library learning / crystallization / packaging ───────────────────────
	crystallize  : require('./crystallize'),    // distil recurrent methods from traces — provider-fusion + crystallizeStructural (re-mountable defeasible method, DECLARED frontier + reified FrontierSignature + libraryKey dispatch + lintFrontier) + synthesizeContract (CLS capstone)
	mine         : require('./mine'),           // traceMiner/methodTrace — mine producer→consumer chains + recurrent STRUCTURAL methods (mineMethods: antiUnify + K1-ceiling guard; declaredCtx = DECLARED frontier; emitEquivalence)
	compress     : require('./compress'),       // the DIGRAM-grain affinity miner: adjacent-pair support + dispatchable sub-expansion index (K1 rule, kind|ctx grains) + mdl.js-ΔL fold + typed-loop-parity subpath patches + the method-FOREST skeleton
	library      : require('./library'),        // the method-library index + dispatch: O(1) libraryKey bucket → refine by app-conditions → ranked candidates
	adapt        : require('./adapt'),          // the adapt-or-forge CONTROLLER: retrieve(hit,0-call) → forge/adapt via the model (reuse neighbours) → verifier-gate (contract) → index back (amortise). antiUnifyAdapt = the principled CONTENT-FORGE adapt (LGG auto-discovers content holes, forge only those, reuse skeleton; opts.adaptContent)
	corpusPack   : require('./corpus-pack'),    // .sgc corpus exchange + derived manifest

	// ── Supervision / lifecycle ───────────────────────────────────────────────
	supervise    : require('./supervise'),      // reactive supervisor (Stuck→hypothesize→evaluate→revert)
	loop         : require('./loop'),           // autonomous episode loop
	typedLoop    : require('./typed-loop'),     // the fused RECURSIVE TYPED decompose operator (loop.js emergent depth × canon-snapped stepKind children, prose untracked → the decompose trace is K1-crystallizable)
	lifecycle    : require('./lifecycle'),      // onCast/teardown lifecycle helpers

	// ── Experimental / shelved (probabilistic concept-nets — see studies) ─────
	conceptNet   : require('./concept-net'),    // (shelved) concept-net populations at the fixpoint
	equilibrium  : require('./equilibrium'),    // (shelved) implicit-equilibrium solver
	ste          : require('./ste')             // (shelved) straight-through soft-train/hard-infer
};
