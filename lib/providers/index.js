/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
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
