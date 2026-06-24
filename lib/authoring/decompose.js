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
 * Tree-decomposition pass on the concept-dependency graph (host-side authoring tool,
 * zero core change) — the Mixture-of-Reasoners "tiling" brick (doc/WIP/HANDOFF.md §7
 * Tier 1; SOTA subgraph-grammars brick iii; experiment E7).
 *
 * From a concept tree it DERIVES — does not guess — (a) the interface alphabet (the
 * SEPARATOR facts a fork frontier should cross) and (b) the hierarchical tiling (the
 * candidate forks), and reports the TREEWIDTH as the inference cost bound: a low
 * treewidth with thin separators means partitioning pays (cheap merge traffic, the
 * #P-avoidance made operational); a dense corpus with high treewidth and no thin cut
 * means it does not. It feeds fork creation (`Graph.fork`/`merge` with a snapped
 * frontier — see lib/providers/merge-consistency.js for the C1 cross-boundary contract).
 *
 *   const { treeDecomposition } = require('./decompose');
 *   const { treewidth, separators, tiles, partitionPays } = treeDecomposition(tree);
 *
 * Model (static analysis — no engine runtime):
 *   - PRIMAL graph: facts = vertices; each concept's referenced fact-set is a clique
 *     (a factor over those facts). `conceptCliques(tree)` extracts the fact-sets.
 *   - MIN-FILL elimination -> treewidth (exact treewidth is NP-hard, Bodlaender 1996,
 *     so this is the standard min-fill heuristic — an upper bound).
 *   - ARTICULATION points (Tarjan) -> candidate separator facts = the interface alphabet.
 *   - COMPONENTS after removing the separators -> the tiles (forks).
 *
 * Fact extraction note: this keys a cross-object walk ref (`a:b`) on its WALK BASE
 * (the fact named first), which is the vertex the dependency hangs off in the primal
 * graph — deliberately the same heuristic that recovered the planted structure in E7
 * (synthetic -> {cost,risk}; real `common` -> [Distance,Stay]). validate.js keys the
 * walk TARGET instead (it judges the resolved fact, a different question); the two are
 * intentionally not unified.
 */

// ---- fact extraction: the cliques (one fact-set per concept) ----

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
// $ref / $$ref token in an assert/ensure expression (no ':' in the class -> a cross-walk
// ref is captured at its base, e.g. `$$clock:tick` -> `clock`).
const EXPR_REF_RE = /\$\$?[A-Za-z_][\w.]*/g;

// The fact keys one concept node references — its self-flag, its require LHS facts, the
// refs inside its assert/ensure, and the keys its applyMutations template writes.
function conceptFacts( node ) {
	const schema = (node && node._schema) || node || {};
	const f = new Set();
	if ( node && node._name ) f.add(node._name);
	for ( const r of asArray(schema.require) )
		if ( typeof r === 'string' ) f.add(r.split(':').pop());           // walk base of a require LHS
	for ( const e of asArray(schema.assert).concat(asArray(schema.ensure)) ) {
		if ( typeof e !== 'string' ) continue;
		for ( const t of (e.match(EXPR_REF_RE) || []) )
			f.add(t.replace(/^\$+/, '').split('.')[0].split(':').pop());   // strip $, drop .member, walk base
	}
	for ( const mu of asArray(schema.applyMutations) )
		if ( mu && typeof mu === 'object' )
			for ( const k of Object.keys(mu) ) if ( !k.startsWith('$') && k !== '_id' ) f.add(k);
	return [...f];
}

// Walk the concept tree (same node semantics as validate.js#eachConcept: a node is a
// concept iff it is a child entry or carries a `_name`; the synthetic root container is
// not) and collect one non-empty clique per concept.
function conceptCliques( tree ) {
	const cliques = [];
	const walk = ( node, isChild ) => {
		if ( !node || typeof node !== 'object' ) return;
		if ( isChild || node._name ) {
			const c = conceptFacts(node);
			if ( c.length ) cliques.push(c);
		}
		const kids = node.childConcepts;
		if ( kids ) for ( const k of Object.keys(kids) ) walk(kids[k], true);
	};
	walk(tree, false);
	return cliques;
}

// ---- graph algorithms ----

function primalAdj( cliques ) {
	const adj = new Map();
	const add = (a, b) => { if ( !adj.has(a) ) adj.set(a, new Set()); if ( a !== b ) adj.get(a).add(b); };
	for ( const cl of cliques ) for ( const a of cl ) { add(a, a); for ( const b of cl ) add(a, b); }
	return adj;
}

// Min-fill elimination ordering -> a tree decomposition; bag sizes give the treewidth
// (max bag - 1). Heuristic: pick the vertex whose elimination adds the fewest fill edges.
function minFillTreewidth( adj ) {
	const G = new Map([...adj].map(([k, s]) => [k, new Set(s)]));
	const remaining = new Set(G.keys());
	const bags = [];
	while ( remaining.size ) {
		let best = null, bestFill = Infinity;
		for ( const v of remaining ) {
			const nb = [...G.get(v)].filter((x) => remaining.has(x));
			let fill = 0;
			for ( let i = 0; i < nb.length; i++ )
				for ( let j = i + 1; j < nb.length; j++ )
					if ( !G.get(nb[i]).has(nb[j]) ) fill++;
			if ( fill < bestFill ) { bestFill = fill; best = v; }
		}
		const nb = [...G.get(best)].filter((x) => remaining.has(x));
		bags.push(new Set([best, ...nb]));
		for ( let i = 0; i < nb.length; i++ )            // make the neighbourhood a clique (fill in)
			for ( let j = i + 1; j < nb.length; j++ ) { G.get(nb[i]).add(nb[j]); G.get(nb[j]).add(nb[i]); }
		remaining.delete(best);
	}
	return { bags, treewidth: Math.max(0, ...bags.map((b) => b.size)) - 1 };
}

// Tarjan articulation points — the cut vertices whose removal disconnects the primal
// graph = the candidate separator facts (the interface alphabet between tiles).
function articulationPoints( adj ) {
	const disc = new Map(), low = new Map(), ap = new Set();
	let timer = 0;
	const dfs = (u, parent) => {
		disc.set(u, ++timer); low.set(u, timer);
		let children = 0;
		for ( const v of adj.get(u) ) {
			if ( !disc.has(v) ) {
				children++; dfs(v, u);
				low.set(u, Math.min(low.get(u), low.get(v)));
				if ( parent !== null && low.get(v) >= disc.get(u) ) ap.add(u);
			} else if ( v !== parent ) {
				low.set(u, Math.min(low.get(u), disc.get(v)));
			}
		}
		if ( parent === null && children > 1 ) ap.add(u);
	};
	for ( const v of adj.keys() ) if ( !disc.has(v) ) dfs(v, null);
	return ap;
}

// Connected components of the primal graph with the `removed` vertices (separators) cut out.
function componentsWithout( adj, removed ) {
	const seen = new Set(), comps = [];
	for ( const s of adj.keys() ) {
		if ( seen.has(s) || removed.has(s) ) continue;
		const comp = [], stack = [s]; seen.add(s);
		while ( stack.length ) {
			const u = stack.pop(); comp.push(u);
			for ( const v of adj.get(u) ) if ( !seen.has(v) && !removed.has(v) ) { seen.add(v); stack.push(v); }
		}
		comps.push(comp);
	}
	return comps;
}

/**
 * Decompose a primal graph given directly as cliques (fact-name arrays). Use this when
 * you already have the fact-sets; `treeDecomposition` extracts them from a concept tree.
 * @returns { nFacts, nConcepts, treewidth, separators, tiles, nTiles, bags, partitionPays }
 */
function decomposeCliques( cliques ) {
	const adj = primalAdj(cliques);
	const { bags, treewidth } = minFillTreewidth(adj);
	const sepSet = articulationPoints(adj);
	const separators = [...sepSet].sort();
	const tiles = componentsWithout(adj, sepSet)
		.filter((c) => c.length)
		.map((c) => c.sort())
		.sort((a, b) => b.length - a.length);
	return {
		nFacts: adj.size,
		nConcepts: cliques.length,
		treewidth,
		separators,
		tiles,
		nTiles: tiles.length,
		bags: bags.map((b) => [...b].sort()),
		// partition pays when there is a thin cut AND it actually splits the corpus
		partitionPays: separators.length > 0 && tiles.length > 1
	};
}

/**
 * Run the tree-decomposition pass over a concept tree.
 * @param tree the nested concept tree (root container or a concept node)
 * @returns the `decomposeCliques` result for the derived cliques.
 */
function treeDecomposition( tree ) {
	return decomposeCliques(conceptCliques(tree));
}

module.exports = {
	treeDecomposition,
	decomposeCliques,
	conceptCliques,
	conceptFacts,
	// lower-level graph primitives (exported for reuse / testing)
	primalAdj,
	minFillTreewidth,
	articulationPoints,
	componentsWithout
};
