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
var canonicalize = require('./canonicalize');
var verify = require('./verify');

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
	makeAsk          : llm.makeAsk,
	parseJSON        : llm.parseJSON,
	canonFacts       : canonicalize.canonFacts,
	canonValue       : canonicalize.canonValue,
	digest           : canonicalize.digest,
	createVerifier   : verify.createVerifier,
	checks           : verify.checks,
	majority         : verify.majority,
	register         : register
};
