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
// ALSO returns the bag-intersection SEPARATORS: when vertex v is eliminated, its higher-neighbour set
// nb(v) is exactly B_v ∩ parent(B_v) in the resulting tree decomposition (Robertson-Seymour 1986) — the
// REAL Σ_sep family (k-aware minimal separators of the chordal completion, monotone under edge addition,
// Dirac 1961), NOT the size-1 articulation cuts. `treewidth` is a SCALAR PROJECTION that loses this.
function minFillTreewidth( adj ) {
	const G = new Map([...adj].map(([k, s]) => [k, new Set(s)]));
	const remaining = new Set(G.keys());
	const bags = [], separators = [];
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
		if ( nb.length ) separators.push(new Set(nb));   // B_best ∩ parent = the bag-intersection separator
		for ( let i = 0; i < nb.length; i++ )            // make the neighbourhood a clique (fill in)
			for ( let j = i + 1; j < nb.length; j++ ) { G.get(nb[i]).add(nb[j]); G.get(nb[j]).add(nb[i]); }
		remaining.delete(best);
	}
	return { bags, treewidth: Math.max(0, ...bags.map((b) => b.size)) - 1, separators };
}

// A bag-intersection separator `s` SPLITS the corpus iff removing it leaves ≥2 components. It is MINIMAL
// iff no single-element-smaller subset also splits (a sufficient, conservative minimality test — Robertson-
// Seymour minimal separators). The MINIMAL splitting separators are the thin cross-tile interfaces (the
// articulation points are exactly their size-1 case); their union is the cross-tile separator alphabet Σ_sep.
function isMinimalSplit( adj, s ) {
	if ( componentsWithout(adj, s).length < 2 ) return false;
	for ( const v of s ) {
		const sub = new Set([...s].filter(( x ) => x !== v));
		if ( sub.size && componentsWithout(adj, sub).length >= 2 ) return false;   // a proper subset already splits → not minimal
	}
	return true;
}

/**
 * The bounded-context HORIZON of a primal graph (E7/Σ_sep) — the OBJECT the scalar treewidth + the size-1
 * articulation `separators` both PROJECT AWAY. Reconstructs the bag-intersection separators from the min-fill
 * elimination and reports:
 *   - `sigmaSep`          the cross-tile separator alphabet = ∪ of the MINIMAL splitting separators (the thin
 *                         interface facts; generalises articulation points to size-k cuts);
 *   - `minimalInterface`  the THINNEST splitting separator `{ size, sep }` — the horizon WIDTH. A grammar refactor
 *                         that grows it (a size-1 cut → a size-2 cut) regressed the bound even when the scalar
 *                         treewidth is unchanged AND no new articulation key appeared (the killer case).
 *   - `indivisible`       true if NO bag-separator splits (one blob); then the "width" is the whole bag (treewidth+1).
 *   - `treewidth`         kept as a DIAGNOSTIC only (min-fill is an uncoupled upper bound → unsound as a scalar gate).
 */
function bagInterface( cliques ) {
	const adj = primalAdj(cliques);
	const { treewidth, separators } = minFillTreewidth(adj);
	const sigma = new Set();
	let min = null;
	for ( const s of separators ) {
		if ( !isMinimalSplit(adj, s) ) continue;
		for ( const f of s ) sigma.add(f);
		if ( !min || s.size < min.size ) min = { size: s.size, sep: [...s].sort() };
	}
	return {
		treewidth,
		bagSeparators: separators.map(( s ) => [...s].sort()),
		sigmaSep: [...sigma].sort(),
		minimalInterface: min || { size: Math.max(1, treewidth + 1), sep: [...adj.keys()].sort() },
		indivisible: !min,
	};
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

// Walk the tree collecting { name, facts:Set } per concept (the named form of conceptCliques).
function conceptsWithFacts( tree ) {
	const out = [];
	const walk = ( node, isChild ) => {
		if ( !node || typeof node !== 'object' ) return;
		if ( isChild || node._name ) {
			const f = conceptFacts(node);
			if ( f.length && node._name ) out.push({ name: node._name, facts: new Set(f) });
		}
		const kids = node.childConcepts;
		if ( kids ) for ( const k of Object.keys(kids) ) walk(kids[k], true);
	};
	walk(tree, false);
	return out;
}

/**
 * Derive a FORK PLAN from the tree-decomposition — the "interface derivation" the SOTA synthesis
 * flagged as the killer deliverable: assign each concept to a tile/fork (by where its non-separator
 * facts fall) and derive each fork's FRONTIER ALPHABET (the separator facts its concepts touch =
 * what crosses that fork boundary). Feeds `Graph.fork`/`merge` AND the `validateMergeProjection`
 * frontier alphabet. Hub concepts (only separator facts) are reported as `interface` glue, not tiled.
 * @returns { treewidth, separators, partitionPays, forks:[{ facts, concepts, frontier }], interface:[names] }
 */
function forkPlan( tree ) {
	const concepts = conceptsWithFacts(tree);
	const decomp = decomposeCliques(concepts.map((c) => [...c.facts]));
	const sepSet = new Set(decomp.separators);

	// fact -> tile index (non-separator facts only; tiles are the post-cut components)
	const tileOf = new Map();
	decomp.tiles.forEach((t, i) => t.forEach((f) => tileOf.set(f, i)));

	const forks = decomp.tiles.map((tile) => ({ facts: tile, concepts: [], frontier: new Set() }));
	const iface = [];
	for ( const c of concepts ) {
		const votes = {};
		const seps = [];
		for ( const f of c.facts ) {
			if ( sepSet.has(f) ) seps.push(f);
			else if ( tileOf.has(f) ) votes[tileOf.get(f)] = (votes[tileOf.get(f)] || 0) + 1;
		}
		const best = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
		if ( best == null ) { iface.push(c.name); continue; }       // only separator facts -> interface glue
		forks[best].concepts.push(c.name);
		seps.forEach((s) => forks[best].frontier.add(s));
	}

	return {
		treewidth: decomp.treewidth,
		separators: decomp.separators,
		partitionPays: decomp.partitionPays,
		forks: forks.map((p) => ({ facts: p.facts, concepts: p.concepts.sort(), frontier: [...p.frontier].sort() })),
		interface: iface.sort()
	};
}

/**
 * §6.3 separatorGate — the SEPARATOR HORIZON check (the §3.3 obligation `params ∪ appConditions ∪ requiredFacts
 * ⊆ Σ_sep`). A proposed ancestry projection (the facts the ancestry oracle would promote to runtime params / fold
 * into the memo digest KEY) is sound iff every projected fact is a CROSS-TILE SEPARATOR fact (on the horizon) —
 * never a fact above the separator (in another tile's interior), which a runtime read would reach past the horizon.
 *   • Σ_sep = the bag-intersection minimal splitting separators (NOT the global articulation points: those are the
 *     size-1 cut family only, and a global cut-vertex elsewhere is NOT on THIS projection's horizon — `bagInterface`).
 *   • a projected fact ∉ Σ_sep is "above-separator" → REFUSED (the spec compiles it to a baked constant / forged hole).
 * Pairs with the memo-key MONOTONICITY (a finer key never false-hits): key-enlargement is safe for memo correctness,
 * but ONLY this gate makes it bound-safe (the digest read at dispatch is itself a `requiredFact`).
 * @returns { ok, above:[facts ∉ Σ_sep], sigmaSep }
 */
function separatorGate( tree, projectionFacts ) {
	const iface = bagInterface(conceptCliques(tree));
	const sigma = new Set(iface.sigmaSep);
	const above = (projectionFacts || []).filter(( f ) => !sigma.has(f));
	return { ok: above.length === 0, above, sigmaSep: iface.sigmaSep };
}

module.exports = {
	treeDecomposition,
	forkPlan,
	decomposeCliques,
	conceptCliques,
	conceptFacts,
	// §6.3 — the bag-intersection separator horizon (the real Σ_sep) + the gate
	bagInterface,
	separatorGate,
	isMinimalSplit,
	// lower-level graph primitives (exported for reuse / testing)
	primalAdj,
	minFillTreewidth,
	articulationPoints,
	componentsWithout
};
