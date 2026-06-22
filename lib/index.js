'use strict';
/**
 * Package facade. `require('skynet-graph')` returns the Graph constructor, with
 * standalone-boot helpers attached as statics so a host can spin a graph up from
 * plain directories without hand-wiring the concept tree + providers:
 *
 *   const Graph = require('skynet-graph');
 *   const g = Graph.fromDirs({ concepts: './concepts', providers: './providers' });
 *
 * The engine core (lib/graph) stays filesystem-free; fromDirs composes the edge
 * loaders (lib/load.js) with the provider registry (lib/providers).
 */
const Graph     = require('./graph');
const providers = require('./providers');
const { loadConceptMap, loadProviders } = require('./load.js');

/**
 * Boot a Graph from on-disk concept sets + provider modules.
 *
 * @param {object} opts
 * @param {string|string[]}        [opts.concepts]    concept-set dir(s) (see loadConceptMap)
 * @param {string|object|Array}    [opts.providers]   provider module dir(s)/file(s) or fragment(s)
 * @param {object}                 [opts.providerCtx] ctx passed to provider factory modules
 * @param {boolean|Array}          [opts.builtins]    register packaged providers (true = geo + default llm)
 * @param {object|string}          [opts.seed]        serialized record, or a path to a JSON snapshot
 * @param {object}                 [opts.conf]        Graph cfg overrides (conceptSets defaults to all loaded)
 * @param {object}                 [opts.conceptMap]  pre-built conceptMap (skips loadConceptMap)
 * @returns {Graph}
 */
function fromDirs( opts = {} ) {
	const conceptMap = opts.conceptMap
		|| (opts.concepts ? loadConceptMap(opts.concepts) : {});

	const fragments = [];
	if ( opts.providers ) fragments.push(...loadProviders(opts.providers, opts.providerCtx || {}));
	if ( fragments.length ) providers.register(Graph, fragments);
	// builtins: true -> packaged defaults (geo + default llm client); array -> explicit fragments
	if ( opts.builtins ) providers.register(Graph, opts.builtins === true ? undefined : opts.builtins);

	let seed = opts.seed;
	if ( typeof seed === 'string' ) seed = JSON.parse(require('fs').readFileSync(require('path').resolve(seed), 'utf8'));

	const conf = { ...(opts.conf || {}) };
	if ( !conf.conceptSets ) conf.conceptSets = Object.keys(conceptMap);

	return new Graph(seed || {}, conf, conceptMap);
}

// Attach standalone helpers as statics (keeps `require('skynet-graph')` === Graph).
Graph.fromDirs        = fromDirs;
Graph.loadConceptMap  = loadConceptMap;
Graph.loadProviders   = loadProviders;
Graph.register        = function ( fragments ) { return providers.register(Graph, fragments); };
Graph.providers       = providers;

// Distributed runtime (worker_threads): spawn sub-graphs in separate workers.
const runtime         = require('./runtime');
Graph.createGraphWorker = runtime.createGraphWorker;
Graph.spawnGraph        = runtime.spawnGraph;

// Logger factory (for a host that wants to build/inject its own logger via cfg.logger).
Graph.createLogger    = require('./graph/log').createLogger;

module.exports = Graph;
