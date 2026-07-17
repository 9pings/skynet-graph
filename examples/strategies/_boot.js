/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * The shared boot for the STRATEGY examples — the three lines every Tier-0 strategy needs, once.
 *
 * A strategy here is not a class you subclass: it is a PLUGIN you deposit (a concept set = files) on top
 * of `reason-kernel`. So booting one is always the same shape, and it is worth reading once:
 *
 *   definePlugin(dir, [reason-kernel])   the plugin CARRIES its dependency as an object (the npm shape)
 *   resolvePlugins([plugin])             flatten deps → topo-sort → merge concept sets + providers
 *   new Graph(seed, { conceptSets }, conceptMap)      boot a graph on the merged grammar
 *   settle(g)                            run stabilization to fixpoint — the strategy IS the fixpoint
 *
 * After that there is no strategy API to call. The HOST writes facts (`ingest`) and READS which gates
 * cast (`cast`) — that is the whole contract. See docs/strategies.md.
 *
 * Not a public API: these helpers are the examples' plumbing, deliberately explicit rather than clever.
 * A real host does exactly this (`plugins.resolvePlugins` is on the facade: `Graph.plugins`).
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';

const path = require('node:path');
const Graph = require('../../lib/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

const PLUGINS = path.join(__dirname, '..', '..', 'plugins');
const KERNEL = path.join(PLUGINS, 'reason-kernel');

/** run stabilization until nothing more can fire — the strategy's verdict IS this fixpoint. */
async function settle( g ) {
	for ( let i = 0; i < 120; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r) );
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('the strategy graph did not settle (an oscillation — check the null-guards)');
}

/**
 * Boot ONE strategy plugin (carrying reason-kernel) over a seed.
 *   bootStrategy('socratic', { nodes: [...], freeNodes: [...] }) -> { g, settle, cast, fact, ingest, close }
 * `cast(id, 'Gate')` = did that gate open on that object · `fact(id, 'k')` = read a typed fact.
 */
function bootStrategy( pluginDir, seed ) {
	seed = seed || {};
	const plugin = definePlugin(path.join(PLUGINS, pluginDir), [loadPlugin(KERNEL)]);
	const cfg = resolvePlugins([plugin]);              // → { order, conceptSets, conceptMap, providers }
	Graph._providers = cfg.providers;                  // the kernel's Ledger / Score / Mark bricks
	const g = new Graph(
		{ lastRev: 0, segments: [], freeNodes: seed.freeNodes || [], nodes: seed.nodes || [] },
		{ label: 'example-' + pluginDir, isMaster: true, autoMount: true,
			conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap);

	return {
		g,
		order : cfg.order,                                                        // ['reason-kernel', '<the strategy>']
		settle: () => settle(g),
		cast  : ( id, k ) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]),
		fact  : ( id, k ) => g._objById[id] && g._objById[id]._etty._[k],
		ingest: ( patch ) => new Promise(( res ) => g.ingest(patch, res) ),       // the host writes a fact
		close : () => { if ( g.destroy ) g.destroy(); },
	};
}

module.exports = { bootStrategy, settle, PLUGINS, KERNEL };
