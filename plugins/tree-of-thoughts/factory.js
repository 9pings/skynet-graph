'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * createTreeOfThoughts — the thin BEAM DRIVER over the tot grammar (design §9.2 #12, class B:
 * state-in-graph, policy-in-driver). Per depth: expand the LIVE frontier (the host `propose`
 * generates candidate thoughts), score each child (the host `score` — an EXTERNAL judge; the
 * generator scoring itself is the refuted self-audit), let the kernel snap the bands, keep the
 * top-`beamWidth` per depth and write `pruned:1` on the rest — the grammar's recursive Live gate
 * cascades the pruned subtrees out natively. Selection is the ONLY imperative part (a cross-sibling
 * argmax the per-object expr-DSL cannot express); every decision it takes is written back as facts
 * (`pruned`, the scores), so the search state stays inspectable and replayable.
 *
 *   const tot = createTreeOfThoughts({ propose, score, beamWidth: 2, branching: 3, maxDepth: 3 });
 *   const { best, path, expanded, pruned } = await tot.run('the seed problem');
 *
 * Deterministic by construction: frontiers and rankings are sorted (band desc, id asc), the
 * injected propose/score are awaited serially, ids are positional — same inputs, same tree.
 */

const path = require('path');

function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const Graph = requireEither('skynet-graph', '../../lib/index.js');
const { nextStable } = requireEither('skynet-graph/lib/authoring/core/supervise.js', '../../lib/authoring/core/supervise.js');

const BAND_RANK = { high: 3, mid: 2, low: 1, none: 0 };

async function settle( g ) {
	for ( let i = 0; i < 120; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r) );
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('tree-of-thoughts: the search graph did not settle');
}

function createTreeOfThoughts( opts ) {
	opts = opts || {};
	if ( typeof opts.propose !== 'function' ) throw new Error('createTreeOfThoughts: opts.propose(nodeView) -> [thought texts] is required');
	if ( typeof opts.score !== 'function' ) throw new Error('createTreeOfThoughts: opts.score(nodeView) -> 0..1 is required (an EXTERNAL judge — the generator scoring itself is the refuted self-audit)');
	const beamWidth = opts.beamWidth || 2;
	const branching = opts.branching || 3;
	const maxDepth = opts.maxDepth || 3;

	async function run( seed ) {
		const plugin = require('./index.js');                                   // lazy: avoids the load-time cycle (index → loadPlugin → this file)
		const cfg = Graph.plugins.resolvePlugins([plugin]);
		const saved = Graph._providers;
		Graph._providers = Object.assign({}, saved, cfg.providers);
		let g;
		try {
			g = new Graph(
				{ lastRev: 0, segments: [], freeNodes: [], nodes: [{ _id: 'n0', isThought: true, depth: 0, text: String(seed) }] },
				{ label: 'tree-of-thoughts', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
				cfg.conceptMap);
			await settle(g);

			const etty = ( id ) => g.getEtty(id);
			const live = ( id ) => { const e = etty(id); return !!(e && e._mappedConcepts.Live); };
			const view = ( id ) => { const f = etty(id)._; return { id, text: f.text, depth: f.depth, parent: f.parent || null, score: f.score, scoreBand: f.scoreBand }; };
			const ingest = ( patch ) => new Promise(( res ) => g.ingest(patch, res) );
			const rank = ( a, b ) => (BAND_RANK[etty(b)._.scoreBand] || 0) - (BAND_RANK[etty(a)._.scoreBand] || 0) || (a < b ? -1 : 1);

			let expanded = 0, prunedCount = 0;
			let frontier = ['n0'];
			for ( let d = 0; d < maxDepth; d++ ) {
				// expand ONLY the live frontier (a pruned node never costs a propose call — the budget claim)
				const children = [];
				for ( const id of frontier.filter(live) ) {
					expanded++;
					const texts = (await opts.propose(view(id))).slice(0, branching);
					for ( let i = 0; i < texts.length; i++ ) {
						const cid = id + '.' + i;
						await ingest({ [cid]: { isThought: true, depth: d + 1, parent: id, text: String(texts[i]) } });
						children.push(cid);
					}
				}
				await settle(g);
				if ( !children.length ) break;                                       // nothing proposed — the search is over
				for ( const cid of children ) await ingest({ [cid]: { score: Number(await opts.score(view(cid))) } });
				await settle(g);                                                     // kernel Scored snaps the bands
				const ranked = children.slice().sort(rank);
				for ( const cid of ranked.slice(beamWidth) ) { await ingest({ [cid]: { pruned: 1 } }); prunedCount++; }
				await settle(g);                                                     // the Live gate cascades the pruned subtrees out
				frontier = ranked.slice(0, beamWidth);
			}

			const leaves = frontier.filter(live).sort(rank);
			if ( !leaves.length ) return { best: null, path: [], expanded, pruned: prunedCount };
			const p = [];                                                            // the winning root→leaf chain, read OFF the structure
			for ( let id = leaves[0]; id; id = etty(id)._.parent ) p.unshift(view(id));
			return { best: view(leaves[0]), path: p, expanded, pruned: prunedCount };
		} finally { Graph._providers = saved; if ( g && g.destroy ) g.destroy(); }
	}

	return { run };
}

module.exports = { createTreeOfThoughts };
