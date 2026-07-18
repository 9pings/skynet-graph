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

// R0 backends — the preset/config layer over the ask-makers (a provider NAME + key -> a chat `ask`). The
// shared foundation the serving surfaces / Studio backend panel / client routing consume; every resolved
// backend carries an `egress` flag (local=false) — the seed a no-egress policy reads.
Graph.backends        = require('./providers/backends');

// Authoring & R&D toolkit, namespaced (concepts/validate/author/contract/abstract/method/mount/crystallize/…).
// Exposed as a static so the substrate tools are usable without deep-path requires. Lazy-required (like
// createStudioServer): an engine-only / providers-only host pays no load cost. (The shelved probabilistic
// modules concept-net/graph-net/equilibrium/ste moved to experiments/probabilistic-concepts/ — 07-16.)
Object.defineProperty(Graph, 'authoring', { get: function () { return require('./authoring'); } });

// Combos — thin, delivered assemblies over the bricks (createAppliance/…). Lazy like `authoring`:
// an engine-only host pays nothing; the substrate/providers load only when a combo is touched.
Object.defineProperty(Graph, 'factories', { get: function () { return require('./factories'); } });
// @deprecated — `combos` is the retired name for the capability factories; alias kept until 2.0.
Object.defineProperty(Graph, 'combos', { get: function () { return require('./factories'); } });

// Plugins — self-contained { concepts, providers, JS, .sgc } bundles resolved into a bootable graph
// config (resolvePlugins / loadPlugin / loadPlugins). Lazy like `combos`: an engine-only host pays
// nothing until a plugin is actually loaded. See docs/plugins.md.
Object.defineProperty(Graph, 'plugins', { get: function () { return require('./plugins'); } });

// definePlugin — the auto-export helper a published plugin's index.js uses to become a requireable npm
// package: `module.exports = require('skynet-graph').definePlugin(__dirname, [require('reason-kernel')])`.
// Surfaced at the top of the facade (not only under Graph.plugins) so a plugin author's one-liner is short.
Graph.definePlugin = function ( dir, depObjects ) { return require('./plugins').definePlugin(dir, depObjects); };

// The first-class SETTLE verb (Controller-P0): a promise that resolves on the next stabilization (or
// immediately if already quiescent). Lifts the de-facto `supervise.js#nextStable` so a host can
// `await Graph.settle(g)` after a mutation instead of wiring an onStabilize callback. Lazy-required.
Graph.settle = function ( graph ) { return require('./authoring/core/supervise.js').nextStable(graph); };

// Distributed runtime: dispatch sub-graphs to a worker (worker_threads) or a cross-instance socket runtime.
const runtime         = require('./runtime');
Graph.createGraphWorker = runtime.createGraphWorker;
Graph.spawnGraph        = runtime.spawnGraph;
Graph.invokeGraph       = runtime.invokeGraph;        // P1: one-shot BOUNDED invoke (only Σ_sep crosses back)
Graph.createWorkerPool  = runtime.createWorkerPool;   // P3: warm worker-pool keyed by contract (method-dispatch infra: N cases → 1 warm worker)
Graph.serveGraphWorker  = runtime.serveGraphWorker;   // P5: stand up a socket runtime remote clients dispatch to

// Logger factory (for a host that wants to build/inject its own logger via cfg.logger).
Graph.createLogger    = require('./graph/log').createLogger;

// Durable executor — Layer A (the CheckpointStore: durable marking + content-memo + lease queue). The
// subsystem lives in plugins/durable/ now (C2 in its own plugin); the facade consumes it LAZILY (like
// Graph.combos — also avoids any require cycle with the plugin's definePlugin auto-export). The module
// loads `node:sqlite` ONLY inside the sqlite factory (engine-only hosts never touch it).
// `createCheckpointStore({file})` = the convenience default — a file → durable SQLite, none → memory.
const durableStore = () => require('../plugins/durable/lib/checkpoint-store.js');
Graph.createCheckpointStore       = function ( opts ) { opts = opts || {}; const d = durableStore(); return opts.file ? d.createSqliteCheckpointStore(opts) : d.createMemoryCheckpointStore(opts); };
Graph.createMemoryCheckpointStore = function ( opts ) { return durableStore().createMemoryCheckpointStore(opts); };
Graph.createSqliteCheckpointStore = function ( opts ) { return durableStore().createSqliteCheckpointStore(opts); };
// the full durable executor namespace: the CheckpointStore + C-xlate (compileMethod) + Layer B (runFlow) +
// the fold-back JOIN's monoid algebra (foldSiblings).
Object.defineProperty(Graph, 'durable', { get: function () {
	return Object.assign({}, durableStore(), require('../plugins/durable/lib/xlate.js'),
		require('../plugins/durable/lib/interpreter.js'), require('../plugins/durable/lib/fold.js'),
		require('../plugins/durable/lib/audit.js'));
} });

// Studio (the web inspector/console): a host can embed the server as a library instead of
// only via `bin/sg studio`. Lazy-required so the fs/ws/http deps don't load for engine-only use.
Object.defineProperty(Graph, 'createStudioServer', {
	get: function () { return require('./studio/server.js').createServer; }
});

module.exports = Graph;
