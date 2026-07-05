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
 * Base providers, packaged for host opt-in.
 *
 * The engine deliberately does NOT auto-wire providers (Graph._providers is left
 * to the host — see Graph.js). This package gives a host a one-liner instead of
 * hand-rolling the glue:
 *
 *   const Graph = require('skynet-graph');
 *   const { register, CommonGeo, createLLMProvider } = require('skynet-graph/providers');
 *   register(Graph, [ { CommonGeo }, createLLMProvider({ ask: myBackend }) ]);
 *
 * register(Graph) with no selection wires the defaults (Geo + a default LLM client).
 */
var geo = require('./geo');
var llm = require('./llm');
var intake = require('./intake');
var reasonLoop = require('./reason-loop');
var canonicalize = require('./canonicalize');
var verify = require('./verify');
var mergeConsistency = require('./merge-consistency');
var solverFork = require('./solver-fork');
var stats = require('./stats');
var nogood = require('./nogood');
var semiring = require('./semiring');
var constat = require('./constat');
var cache = require('./cache');

/**
 * Merge provider-map fragments onto Graph._providers (preserving any already set).
 * @param Graph      the engine constructor (providers live on graph.static._providers)
 * @param fragments  array of `{ NamespaceName: { fn, ... } }` maps;
 *                   omitted -> defaults: [ { CommonGeo }, createLLMProvider() ]
 * @returns the Graph (for chaining)
 */
function register( Graph, fragments ) {
	if ( !fragments ) fragments = [{ CommonGeo: geo.CommonGeo }, llm.createLLMProvider()];
	Graph._providers = Object.assign.apply(Object, [{}, Graph._providers || {}].concat(fragments));
	return Graph;
}

module.exports = {
	CommonGeo        : geo.CommonGeo,
	haversineKm      : geo.haversineKm,
	createLLMProvider: llm.createLLMProvider,
	createIntake     : intake.createIntake,
	createReasonLoop : reasonLoop.createReasonLoop,   // the packaged AI:: answer-loop set that drives concepts/_substrate end-to-end (+ the Intake→Task bridge AI::seedTask)
	makeAsk          : llm.makeAsk,
	makeLocalAsk     : require('./llm-local').makeLocalAsk,   // in-process GGUF `ask` (node-llama-cpp; native dep loaded lazily, opt-in)
	createLocalModelHost : require('./local-host').createLocalModelHost,   // centralized embedded-inference host (load-once + prompt cache + VRAM/LRU)
	sharedLocalModelHost : require('./local-host').sharedLocalModelHost,   // the process-wide shared host makeLocalAsk delegates to
	parseJSON        : llm.parseJSON,
	canonFacts       : canonicalize.canonFacts,
	canonValue       : canonicalize.canonValue,
	compileEnumMap   : canonicalize.compileEnumMap,   // G-1: the confluent enum+synonym-ring map (curated-thesaurus core)
	digest           : canonicalize.digest,
	makeBorderlineSnap: require('./borderline').makeBorderlineSnap,   // G-1: the borderline-only LLM gate (LAST resort, re-canonicalized, propose-only)
	borderlineFacts  : require('./borderline').borderlineFacts,
	enumGbnf         : require('./borderline').enumGbnf,
	createVerifier   : verify.createVerifier,
	checks           : verify.checks,
	majority         : verify.majority,
	mergeConsistency : mergeConsistency.mergeConsistency,
	consistencyBandOf: mergeConsistency.bandOf,
	createConsistency: mergeConsistency.createConsistency,
	consistencyConceptTree: mergeConsistency.consistencyConceptTree,
	createSolver     : solverFork.createSolver,
	snappedFrontier  : solverFork.snappedFrontier,
	solverConceptTree: solverFork.solverConceptTree,
	backtrackColoring: solverFork.backtrackColoring,
	createStats      : stats.createStats,
	shrink           : stats.shrink,
	empiricalBayesKappa: stats.empiricalBayesKappa,
	reliabilityBandOf: stats.bandOf,
	shrinkageConceptTree: stats.shrinkageConceptTree,
	createNogood     : nogood.createNogood,
	recordNogood     : nogood.recordNogood,
	guardTrial       : nogood.guardTrial,
	nogoodGuardConcept: nogood.nogoodGuardConcept,
	reduceSemiring   : semiring.reduceSemiring,
	createSemiring   : semiring.createSemiring,
	semiringConceptTree: semiring.semiringConceptTree,
	SEMIRINGS        : semiring.SEMIRINGS,
	selectConceptTree: semiring.selectConceptTree,
	paretoFront      : semiring.paretoFront,
	paretoSelect     : semiring.paretoSelect,
	makePareto       : semiring.makePareto,
	dominates        : semiring.dominates,
	createConstat    : constat.createConstat,
	recordConstat    : constat.recordConstat,
	buildConstat     : constat.buildConstat,
	CONSTAT_FIELDS   : constat.CONSTAT_FIELDS,
	createProviderCache: cache.createProviderCache,
	keyFromScope     : cache.keyFromScope,
	register         : register
};
