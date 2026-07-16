/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * extract — BOUNDED SUBGRAPH EXTRACTION for fork / multi-process ship (host-side, ZERO-CORE; the 2026-07-01 fork-perf
 * measure + Laurie confront, verdict SOUND-WITH-CORRECTION).
 *
 * WHY. `fork()` with no seed deep-copies the WHOLE working graph (`JSON.parse(serialize().graph)`) then re-mounts it.
 * Measured (`doc/WIP/experiments/2026-07-01-fork-perf/`): the deep-copy is O(working-graph) and a bounded-seed fork is
 * 27–245× cheaper (growing with N). The lever for the MULTI-PROCESS/worker case (`lib/runtime` ships a seed to a
 * separate process — no shared memory) is shipping a bounded SLICE, not the whole graph. COW can't help cross-process.
 *
 * WHAT. This is PROGRAM SLICING (Weiser 1984) on the reference-dependence graph: `focus` is the slicing criterion; a
 * ship-able slice is a CLOSED backward slice with its free variables FROZEN as inputs. A segment-closed **k-hop ball**
 * (`opts.hops`, default 1): the interior grows by (hops-1) BFS rings from the focus + all their incident segments; the
 * segments' non-interior endpoints are the FROZEN frontier (their current facts copied as constants). Sound iff the
 * frozen frontier is FRAME-COMPLETE — `contract.js` G1 applied at the fork boundary: every
 * cross-cut reference reads a frozen value, none is WRITTEN by the slice. Merge-back = SINGLE-WRITER (separation-logic
 * `*`-disjointness; Reynolds 2002) + an ASSUMPTION-RECHECK (the frozen frontier still holds at merge time — the
 * drift-defeasance moved to the fork frontier; de Kleer ATMS 1986: the frozen frontier is the assumption environment).
 *
 * The seed is a `serialize()`-shaped record (`{ lastRev, conceptMaps:[{...facts}], bagRefs }`) → `graph.fork(seed)`
 * locally OR `spawnGraph({ seed })` to a worker. `lib/graph` is UNTOUCHED.
 *
 * DEFERRED / refused (Laurie): a cyclic cross-cut ref (contract G3 footprint-cycle — refuse), a bagRef spanning the cut
 * (needs manager replication), a not-yet-materialized cross-cut producer (the frame-problem impossible case — refuse),
 * multi-writer frontier (the ATMS multi-context, FILED §6.1); the horizon gate on the precise cross-cut-REF facts (v0
 * gates all frontier facts).
 */
const factsOf = ( graph, id ) => { const o = graph._objById[id]; return o && o._etty && o._etty._; };
const idOf = ( o ) => o && (o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : o._id));

/**
 * Extract a bounded, ship-able subgraph around `focus`.
 * @param graph  the parent graph.
 * @param focus  a node id / segment id / array of ids (the slicing criterion). A focus segment contributes its
 *               endpoints as focus nodes.
 * @param opts.tree   optional concept tree → run `separatorGate` on the frozen-frontier facts (horizon check).
 * @param opts.refuseAboveHorizon  throw if a frozen frontier fact is above Σ_sep (default false → reported only).
 * @returns { seed, interior, segments, frontier, frozen, focusNodes, horizonOk?, aboveHorizon? }
 */
function extractSubgraph( graph, focus, opts ) {
	opts = opts || {};
	const focusIds = Array.isArray(focus) ? focus.slice() : [focus];
	const focusNodes = new Set(), focusSegs = new Set();
	for ( const id of focusIds ) {
		const f = factsOf(graph, id);
		if ( !f ) throw new Error('extractSubgraph: unknown focus id "' + id + '"');
		if ( f.Segment ) { focusSegs.add(id); if ( f.originNode ) focusNodes.add(f.originNode); if ( f.targetNode ) focusNodes.add(f.targetNode); }
		else focusNodes.add(id);
	}
	// segment-closed k-hop ball. `hops` (default 1) = the INTERIOR radius: grow the interior by (hops-1) rings of nodes
	// (BFS over incident segments), then include every segment incident to an interior node; a segment's endpoint NOT in
	// the interior is a FROZEN frontier node (the boundary, pinned). hops=1 → interior={focus}, frontier=1-hop neighbours
	// (byte-identical to v0); hops=2 → interior=focus+1-hop, frontier=2-hop; etc.
	const hops = opts.hops == null ? 1 : Math.max(1, opts.hops | 0);
	const incidentOf = ( n ) => { const node = graph._objById[n]; return [].concat((node && node._outgoing) || [], (node && node._incoming) || []); };
	const interiorNodes = new Set(focusNodes);
	let ring = new Set(focusNodes);
	for ( let d = 0; d < hops - 1; d++ ) {                       // grow the interior by (hops-1) BFS rings
		const next = new Set();
		for ( const n of ring ) for ( const sid of incidentOf(n) ) {
			const sf = factsOf(graph, sid) || {};
			for ( const end of [sf.originNode, sf.targetNode] ) if ( end && !interiorNodes.has(end) ) { interiorNodes.add(end); next.add(end); }
		}
		ring = next;
		if ( !ring.size ) break;                                // the component is fully inside the ball
	}
	// include every segment incident to an interior node; non-interior endpoints become the frozen frontier.
	const segs = new Set(focusSegs), frontierNodes = new Set();
	for ( const n of interiorNodes ) for ( const sid of incidentOf(n) ) {
		segs.add(sid);
		const sf = factsOf(graph, sid) || {};
		for ( const end of [sf.originNode, sf.targetNode] ) if ( end && !interiorNodes.has(end) ) frontierNodes.add(end);
	}
	// freeze = copy the raw facts of every slice object (interior nodes + incident segments + frozen frontier nodes).
	const sliceIds = [...interiorNodes, ...segs, ...frontierNodes];
	const conceptMaps = sliceIds.map(( id ) => ({ ...factsOf(graph, id) }));
	const frozen = {}; for ( const n of frontierNodes ) frozen[n] = { ...factsOf(graph, n) };

	const extraction = {
		seed: { lastRev: graph.getCurrentRevision ? graph.getCurrentRevision() : 0, conceptMaps, bagRefs: {} },
		interior: [...interiorNodes], segments: [...segs], frontier: [...frontierNodes], frozen, focusNodes: [...focusNodes], focusSegs: [...focusSegs],
	};
	// horizon gate (optional): every frozen frontier FACT must be on the separator horizon (Σ_sep) or the bound regresses.
	if ( opts.tree ) {
		const { separatorGate } = require('../core/decompose.js');
		const facts = {};
		for ( const n of frontierNodes ) for ( const k of Object.keys(frozen[n]) ) if ( k !== '_id' && k !== '_rev' ) facts[k] = true;
		const gate = separatorGate(opts.tree, Object.keys(facts));
		extraction.horizonOk = gate.ok; extraction.aboveHorizon = gate.above;
		if ( !gate.ok && opts.refuseAboveHorizon ) throw new Error('extractSubgraph: frozen frontier facts above Σ_sep: ' + gate.above.join(','));
	}
	return extraction;
}

/**
 * The interior-only footprint of a merge template: the ids it writes. SOUND merge writes ONLY interior/focus ids —
 * NEVER a frozen frontier id (that is a write across the cut → the ATMS multi-context contradiction). `$$_id` / `$_id`
 * targets an existing object; a bare `_id` creates a new one (also fine — not a frontier write).
 */
function templateWrites( tpl ) {
	return (Array.isArray(tpl) ? tpl : [tpl]).map(( o ) => o && (o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : null))).filter(( x ) => x != null);
}

/**
 * Merge a bounded-slice worker/child result back into the parent — SOUNDLY.
 *   1. ASSUMPTION-RECHECK: every frozen frontier fact must still equal the parent's current value (else the slice
 *      stabilized on a dead premise → REJECT and re-run; the drift-defeasance at the fork frontier).
 *   2. SINGLE-WRITER: the project template must write ONLY interior ids, never a frozen frontier id (separation-logic
 *      disjointness) → else REJECT (the multi-writer/ATMS hazard).
 *   3. apply via the sequenced taskflow (`pushMutation`) — never out-of-band.
 * @param parent  the parent graph.
 * @param child   the settled fork/worker child (or, cross-process, a plain object with `_objById`-like access via `factsGetter`).
 * @param extraction  the object returned by `extractSubgraph`.
 * @param opts.project  (child) -> mutationTemplate; default = write back the focus objects' produced facts onto their ids.
 * @param opts.factsGetter  (child, id) -> facts; default reads `child._objById[id]._etty._` (override for a cross-process JSON child).
 * @returns { merged:true, template } | { merged:false, reason }
 */
function mergeSlice( parent, child, extraction, opts ) {
	opts = opts || {};
	const getFacts = opts.factsGetter || (( c, id ) => factsOf(c, id));
	// (1) assumption-recheck — frozen frontier unchanged in the parent.
	for ( const n of extraction.frontier ) {
		const now = factsOf(parent, n) || {}, was = extraction.frozen[n] || {};
		for ( const k of Object.keys(was) ) {
			if ( k === '_id' || k === '_rev' ) continue;
			if ( JSON.stringify(now[k]) !== JSON.stringify(was[k]) ) return { merged: false, reason: 'frontier drift: ' + n + '.' + k + ' changed since extraction' };
		}
	}
	// build the write-back template (default = focus objects' current child facts, minus volatile markers).
	const project = opts.project || function ( c ) {
		return extraction.focusNodes.concat(extraction.focusSegs).map(function ( id ) {
			const f = getFacts(c, id) || {}; const o = { $$_id: id };
			for ( const k of Object.keys(f) ) if ( k !== '_id' && k !== '_rev' && k !== '_origin' ) o[k] = f[k];
			return o;
		});
	};
	const tpl = project(child);
	// (2) single-writer — the template must not write a frozen frontier id.
	const frontierSet = new Set(extraction.frontier);
	const badWrite = templateWrites(tpl).find(( id ) => frontierSet.has(id) );
	if ( badWrite ) return { merged: false, reason: 'single-writer violation: template writes frontier object "' + badWrite + '"' };
	// (3) apply through the sequenced taskflow.
	parent.pushMutation(tpl);
	return { merged: true, template: tpl };
}

module.exports = { extractSubgraph, mergeSlice, templateWrites };
