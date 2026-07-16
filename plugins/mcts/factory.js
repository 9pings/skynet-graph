'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * createMCTS — the thin UCB1 DRIVER over the mcts grammar (design §9.2 #13, class B: state-in-graph,
 * policy-in-driver). Per iteration: SELECT (descend expanded nodes by UCB1 — unvisited children
 * first in id order, then argmax wins/visits + c·√(ln N / n), tiebreak id), EXPAND (instantiate the
 * host `actions` as children — all at once, deterministic; no actions → terminal), SIMULATE (the
 * host rollout → 0|1), BACKPROP (visits/wins written up the selected path through the sequenced
 * mutation channel). No randomness in the driver — the exploration is the UCB1 term, so with a
 * deterministic rollout the whole search replays bit-identically. Every decision lands as facts:
 * the tree IS the audit trail.
 *
 *   const mcts = createMCTS({ actions, simulate, iterations: 20, c: 1.414 });
 *   const { best, root, children } = await mcts.run('the seed state');
 */

function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const Graph = requireEither('skynet-graph', '../../lib/index.js');
const { nextStable } = requireEither('skynet-graph/lib/authoring/core/supervise.js', '../../lib/authoring/core/supervise.js');

async function settle( g ) {
	for ( let i = 0; i < 120; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r) );
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('mcts: the search graph did not settle');
}

function createMCTS( opts ) {
	opts = opts || {};
	if ( typeof opts.actions !== 'function' ) throw new Error('createMCTS: opts.actions(nodeView) -> [moves] is required');
	if ( typeof opts.simulate !== 'function' ) throw new Error('createMCTS: opts.simulate(nodeView) -> 0|1 is required (a DETERMINISTIC rollout replays the whole search)');
	const iterations = opts.iterations || 20;
	const c = opts.c == null ? 1.414 : opts.c;

	async function run( seed ) {
		const plugin = require('./index.js');                                   // lazy: avoids the load-time cycle (index → loadPlugin → this file)
		const cfg = Graph.plugins.resolvePlugins([plugin]);
		const saved = Graph._providers;
		Graph._providers = Object.assign({}, saved, cfg.providers);
		let g;
		try {
			g = new Graph(
				{ lastRev: 0, segments: [], freeNodes: [], nodes: [{ _id: 'm0', isThought: true, visits: 0, wins: 0, text: String(seed) }] },
				{ label: 'mcts', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
				cfg.conceptMap);
			await settle(g);

			const f = ( id ) => g.getEtty(id)._;
			const view = ( id ) => { const x = f(id); return { id, text: x.text, move: x.move || null, parent: x.parent || null,
				visits: x.visits, wins: x.wins, expanded: !!x.expanded, terminal: !!x.terminal }; };
			const ingest = ( patch ) => new Promise(( res ) => g.ingest(patch, res) );

			// UCB1 over the children facts — unvisited first (id order), then the classic bound, tiebreak id
			const pick = ( id ) => {
				const kids = f(id).childIds;
				const fresh = kids.filter(( k ) => f(k).visits === 0 );
				if ( fresh.length ) return fresh[0];
				const N = f(id).visits;
				let best = null, bestV = -Infinity;
				for ( const k of kids ) {
					const kf = f(k);
					const v = kf.wins / kf.visits + c * Math.sqrt(Math.log(N) / kf.visits);
					if ( v > bestV ) { bestV = v; best = k; }
				}
				return best;
			};

			for ( let it = 0; it < iterations; it++ ) {
				// SELECT: descend the expanded spine
				let node = 'm0';
				const path = [node];
				while ( f(node).expanded && !f(node).terminal ) { node = pick(node); path.push(node); }
				// EXPAND: instantiate the actions as children (all at once — deterministic), or mark terminal
				if ( !f(node).terminal && !f(node).expanded ) {
					const acts = await opts.actions(view(node));
					if ( !acts.length ) await ingest({ [node]: { terminal: 1 } });
					else {
						const patch = {};
						const kids = acts.map(( a, i ) => {
							const cid = node + '.' + i;
							patch[cid] = { isThought: true, visits: 0, wins: 0, move: String(a), parent: node, text: f(node).text + ' → ' + a };
							return cid;
						});
						patch[node] = { expanded: 1, childIds: kids };
						await ingest(patch);
						node = kids[0]; path.push(node);                              // first fresh child, id order
					}
				}
				// SIMULATE (the host rollout) + BACKPROP up the selected path
				const w = Number(await opts.simulate(view(node))) ? 1 : 0;
				const up = {};
				for ( const id of path ) up[id] = { visits: f(id).visits + 1, wins: f(id).wins + w };
				await ingest(up);
			}
			await settle(g);

			const rootKids = f('m0').childIds || [];
			let best = null;                                                       // most-visited root child, tiebreak id
			for ( const k of rootKids ) if ( !best || f(k).visits > f(best).visits ) best = k;
			return { best: best ? view(best) : null, root: view('m0'), children: rootKids.map(view) };
		} finally { Graph._providers = saved; if ( g && g.destroy ) g.destroy(); }
	}

	return { run };
}

module.exports = { createMCTS };
