/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * granularity — the STRUCTURAL granularity ARBITER (P2's 4th client, the sonde's grounded dimensions):
 * cluster grounded notions / key-points into candidate DIMENSIONS by their GROUNDING overlap (co-citation
 * of witnesses), with NO prose parsing. The sonde (WIP 2026-07-13) measured that the real dimensions of a
 * question come from CLUSTERING the KPs on their grounding, not from asking Q2 to parse them (its "moral;
 * legal" prior is a shallow cliché). Two items are in the same dimension iff their witness-sets share ≥
 * `minShared` arguments — transitively, via connected components on the co-citation graph.
 *
 * The arbiter's job is to ARBITRATE the lazy 2-régime factorization (sonde): when the grounding is dense
 * enough to form ≥2 grounded groups, it RESOLVES the dimensions for free ('mixed' = the re-plan's
 * `frame: TOO-NARROW` signal, grounded — the moral⊥legal separation, structurally); when the grounding is
 * a single connected block it is a 'coherent' frame (decide normally); when it is all singletons (sparse
 * co-citation — measured ~6% multi-matched on ArgKP) there is no grounded dimension structure and it
 * ESCALATES ('unstructured' → Q2 proposes dimensions, seeded by the groups). It never hallucinates a
 * dimension (the discriminating negative control). Deterministic, grounded, ZERO-CORE.
 *
 *   const { arbitrate } = require('skynet-graph/lib/authoring/granularity');
 *   arbitrate([{id:'n1',witnesses:['a','b']}, {id:'n2',witnesses:['b','c']}, {id:'n3',witnesses:['x','y']}]);
 *   // → { frame:'mixed', dimensions:[['n1','n2'],['n3']-dropped], ... }  (n1~n2 share b; n3 disjoint)
 */

// Union-find over the item ids, edges = share ≥ minShared witnesses (optionally never across `side`).
function clusterByGrounding( items, opts ) {
	opts = opts || {};
	const minShared = opts.minShared != null ? opts.minShared : 1;
	const bySide = !!opts.bySide;
	const parent = new Map();
	const find = ( x ) => { while ( parent.get(x) !== x ) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
	for ( const it of items ) parent.set(it.id, it.id);
	let edges = 0;
	for ( let i = 0; i < items.length; i++ ) for ( let j = i + 1; j < items.length; j++ ) {
		const A = items[i], B = items[j];
		if ( bySide && A.side && B.side && A.side !== B.side ) continue;
		const wb = new Set(B.witnesses || []);
		const shared = (A.witnesses || []).filter(( w ) => wb.has(w) ).length;
		if ( shared >= minShared ) { const ra = find(A.id), rb = find(B.id); if ( ra !== rb ) { parent.set(ra, rb); edges++; } }
	}
	const groups = new Map();
	for ( const it of items ) { const r = find(it.id); if ( !groups.has(r) ) groups.set(r, []); groups.get(r).push(it.id); }
	const clusters = [...groups.values()].map(( g ) => g.slice().sort() ).sort(( a, b ) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0 );
	return { clusters, separability: { components: clusters.length, singletons: clusters.filter(( c ) => c.length === 1 ).length,
		sizes: clusters.map(( c ) => c.length ).sort(( a, b ) => b - a ), edges } };
}

/**
 * Classify a set of grounded items into a FRAME verdict for the re-plan (the `frame: TOO-NARROW` signal):
 *   'coherent'     — one connected grounded block → a single dimension → decide normally (no re-plan).
 *   'mixed'        — ≥2 grounded groups (size ≥ minGroup) → the frame conflates dimensions → SEPARATE them
 *                    (the moral⊥legal case, detected structurally, grounded — the re-plan's re-split seed).
 *   'unstructured' — no grounded groups (all singletons; sparse co-citation) → ESCALATE to Q2 to propose
 *                    dimensions (the lazy-régime GAP), seeded by the singletons; never fabricate a split.
 * @param items [{ id, witnesses:[argId], side? }]
 * @returns { frame, dimensions:[[id..]], singletons:[[id]..], separability, reason }
 */
function arbitrate( items, opts ) {
	opts = opts || {};
	const minGroup = opts.minGroup != null ? opts.minGroup : 2;
	const { clusters, separability } = clusterByGrounding(items, opts);
	const dimensions = clusters.filter(( c ) => c.length >= minGroup );
	const singletons = clusters.filter(( c ) => c.length < minGroup );
	let frame, reason;
	if ( dimensions.length >= 2 ) { frame = 'mixed';
		reason = dimensions.length + ' grounded groups share no witnesses across groups — the frame conflates ' + dimensions.length + ' dimensions'; }
	else if ( dimensions.length === 1 && !singletons.length ) { frame = 'coherent';
		reason = 'one connected grounded block — a single dimension'; }
	else if ( dimensions.length === 1 ) { frame = 'coherent';
		reason = 'one grounded group' + (singletons.length ? ' + ' + singletons.length + ' ungrounded singleton(s)' : ''); }
	else { frame = 'unstructured';
		reason = 'no grounded group (co-citation too sparse) — escalate to Q2 to propose dimensions'; }
	return { frame, dimensions, singletons, separability, reason };
}

module.exports = { clusterByGrounding, arbitrate };
