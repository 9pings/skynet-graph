/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * rebalance — the DEFEASIBLE REBALANCING FIXPOINT (ZERO-CORE, host-side). The R1 "réorganise les feuilles
 * jusqu'à ce que l'ensemble soit équilibré" operator: a degenerate plan (redundant / over-budget / disordered
 * leaves) is driven to a BALANCED fixpoint by four rules under a LEXICOGRAPHIC termination measure. Kill-gated
 * GO on the real bricks (`WIP/experiments/2026-07-07-kg-r1b-fixpoint` — 4 degeneracies recover, measure
 * monotone, negative-control severed refuses, checkCompose/footprintCycles with teeth).
 *
 * THE FOUR RULES (applied E2→E1→E3→E4 each round — see FINDING below):
 *   E2 scission   — split any over-budget node into within-budget atoms (the typed-loop's job downstream)
 *   E1 fusion     — collapse leaves with an IDENTICAL fusion key (redundant); distinct keys stay PARALLEL
 *   E3 reorder    — topo by data-flow (a consumer reads its producers' writes → consumer last);
 *                   `footprintCycles` rejects an illegal RETRACTABLE cycle → typed refusal, never oscillation
 *   E4 rewrite    — re-fold a consumer from its LIVE producers (defeasibleAggregate semantics)
 *
 * FINDING (kill-gate KG-R1b): apply **E2 BEFORE E1**. E1-before-E2 is UNSOUND — when a bundle splits into
 * atoms that duplicate existing leaves, E2 re-creates the redundancy E1 just removed, so the lexicographic
 * measure GROWS mid-round (measured `[1]→[2,0,0,0]→[0]`). Split-then-dedupe restores monotonicity: E1 dedupes
 * ALL atoms after scission, and fusing identical leaves never creates over-budget. ZERO-CORE (rule ordering).
 *
 * TERMINATION: measure = (redundancy, overBudget, inversions, staleness), lexicographic. Each round the tuple
 * is monotone NON-INCREASING; a `cap` of rounds bounds it and non-convergence → a TYPED refusal (never a
 * silent wedge). def-of-done: done is decided on the LEDGER (the measure), not a cast (#27/#44); the fusion
 * key is a recursive stableStringify (#35); a severed/uncovered node is REFUSED, never silently folded.
 *
 * The brick is domain-agnostic: the caller supplies a `spec` adapting its plan nodes. `plan-loop.js` wires the
 * spec to a decomposed report (typed requests, boundedProject digests, the C6 leaf ladder, checkCompose
 * reassembly). Usable à nu with any plan whose nodes carry a fusion key, an over-budget test, a split, and a
 * producer/consumer footprint.
 *
 *   const { rebalancePlan } = require('skynet-graph/lib/authoring/rebalance');
 *   const out = rebalancePlan({ order: nodes }, spec);   // → { plan, rounds, converged, monotone, refusal, trace }
 */
const { checkCompose, footprintCycles } = require('../../../lib/authoring/contract.js');
const { stableStringify } = require('../../../lib/providers/cache.js');

// ── the spec the caller adapts (all optional bar isLeaf/fusionKey/overBudget/split/writes/reads/refold) ──
// spec.isLeaf(n)      → is this node a produced leaf (vs a consumer/root)?
// spec.fusionKey(n)   → stable identity for E1 (default: recursive stableStringify of n.request ?? n.contract)
// spec.overBudget(n)  → does this node exceed the node budget (an E2 target: a bundle or an oversized digest)?
// spec.split(n)       → [subnode…] within budget (E2). Must return ≥2 atoms with DISTINCT ids.
// spec.writes(n)      → [key…] this node writes (its figure ids / results)
// spec.reads(n)       → [key…] this node reads (a consumer reads its producers' writes)
// spec.refold(root, leaves) → the fresh consumer value from the live producers (E4). MUST be pure (no side
//                             effects) — the staleness check calls it too. E4 stores the result on `root.value`.
// spec.contractOf(n)  → { name, contract:{read,write,pre,post,effect} } for checkCompose/footprintCycles
const CAP_DEFAULT = 8;

function defaultFusionKey( n ) { return stableStringify(n.request !== undefined ? n.request : (n.contract || n.id)); }

// E2 scission — split over-budget nodes into within-budget atoms (before E1, per the finding).
function E2( plan, spec ) {
	let fired = false; const out = [];
	for ( const n of plan.order ) {
		if ( spec.isLeaf(n) && spec.overBudget(n) ) { const parts = spec.split(n); if ( parts && parts.length ) { fired = true; out.push(...parts); continue; } }
		out.push(n);
	}
	plan.order = out; return fired;
}
// E1 fusion — collapse IDENTICAL leaves (redundant). checkCompose guard: identical key ⇒ unifiable; a distinct
// key is a DIFFERENT method → kept PARALLEL (never over-merged). Severed/refused leaves are never fused.
function E1( plan, spec ) {
	const seen = new Set(); let fired = false; const kept = [];
	for ( const n of plan.order ) {
		if ( !spec.isLeaf(n) || n.severed || n.refused || spec.overBudget(n) ) { kept.push(n); continue; }
		const k = spec.fusionKey(n);
		if ( seen.has(k) ) { fired = true; continue; }
		seen.add(k); kept.push(n);
	}
	plan.order = kept; return fired;
}
// E3 reorder — data-flow topo: a consumer reads its producers' writes, so it comes AFTER them. footprintCycles
// rejects an illegal retractable back-edge (a producer reading a consumer's write) BEFORE reordering.
function E3( plan, spec ) {
	if ( spec.contractOf ) {
		const cyc = footprintCycles(plan.order.map(spec.contractOf).filter(Boolean));
		if ( cyc.length ) { plan._cycleRejected = cyc; return false; }
	}
	const producers = plan.order.filter(( n ) => spec.isLeaf(n) );
	const consumers = plan.order.filter(( n ) => !spec.isLeaf(n) );
	const want = producers.concat(consumers);                         // producers before consumers
	const fired = plan.order.some(( n, i ) => n !== want[i] );
	plan.order = want; return fired;
}
// E4 rewrite — re-fold each consumer from the LIVE producers (defeasibleAggregate semantics). Fires if stale.
function E4( plan, spec ) {
	let fired = false;
	const leaves = plan.order.filter(( n ) => spec.isLeaf(n) );
	for ( const c of plan.order ) if ( !spec.isLeaf(c) ) {
		const fresh = spec.refold(c, leaves);
		if ( c.value !== fresh ) { c.value = fresh; fired = true; }   // c.value is the ledger (NOT spec.valueOf — that inherits Object.prototype.valueOf)
	}
	return fired;
}

// ── the lexicographic termination measure (redundancy, overBudget, inversions, staleness) ──
function measure( plan, spec ) {
	const singles = plan.order.filter(( n ) => spec.isLeaf(n) && !n.severed && !n.refused && !spec.overBudget(n) );
	const keys = singles.map(spec.fusionKey);
	const redundancy = keys.length - new Set(keys).size;
	const over = plan.order.filter(( n ) => spec.isLeaf(n) && spec.overBudget(n) ).length;
	const cIdx = plan.order.findIndex(( n ) => !spec.isLeaf(n) );
	const inversions = cIdx === -1 ? 0 : plan.order.slice(cIdx + 1).filter(( n ) => spec.isLeaf(n) ).length;
	let staleness = 0;
	if ( cIdx !== -1 ) {
		const leaves = plan.order.filter(( n ) => spec.isLeaf(n) );
		for ( const c of plan.order ) if ( !spec.isLeaf(c) ) {
			if ( c.value !== spec.refold(c, leaves) ) { staleness = 1; break; }
		}
	}
	return [redundancy, over, inversions, staleness];
}
const lexLE = ( a, b ) => { for ( let i = 0; i < a.length; i++ ) { if ( a[i] < b[i] ) return true; if ( a[i] > b[i] ) return false; } return true; };

/**
 * rebalancePlan(plan, spec, opts) — drive `plan` to a balanced fixpoint. Returns:
 *   { plan, rounds, converged, monotone, refusal:null|'CYCLE'|'NONCONVERGENCE', trace:[measure…] }
 * `refusal` is a TYPED non-null outcome the caller surfaces (never a silent wedge). `monotone:false` flags a
 * termination-measure violation (a rule grew an earlier measure — a bug to fix, not to accept).
 */
function rebalancePlan( plan, spec, opts ) {
	opts = opts || {};
	spec = Object.assign({ fusionKey: defaultFusionKey }, spec);
	const cap = opts.cap || CAP_DEFAULT;
	const trace = [measure(plan, spec)];
	let round = 0, monotone = true;
	for ( ; round < cap; round++ ) {
		const f2 = E2(plan, spec), f1 = E1(plan, spec), f3 = E3(plan, spec), f4 = E4(plan, spec);
		if ( plan._cycleRejected ) { round++; break; }               // illegal structure → typed refusal
		const m = measure(plan, spec), prev = trace[trace.length - 1];
		if ( !lexLE(m, prev) ) monotone = false;
		trace.push(m);
		if ( !f1 && !f2 && !f3 && !f4 ) { round++; break; }          // FIXPOINT
	}
	const balanced = !plan._cycleRejected && measure(plan, spec).every(( x ) => x === 0 );
	const converged = balanced && round <= cap;
	return { plan, rounds: round, converged, monotone,
		refusal: plan._cycleRejected ? 'CYCLE' : (!converged ? 'NONCONVERGENCE' : null), trace };
}

// checkReassembly(consumer, producers, opts) — is folding the producers into the consumer SOUND, and does the
// consumer read anything NO producer writes (an uncovered claim-of-absence)? Uses the real checkCompose. ──
function checkReassembly( consumer, producers, spec ) {
	const cc = producers.map(( p ) => checkCompose(spec.contractOf(p), spec.contractOf(consumer)) );
	const anyUnsound = cc.some(( r ) => r.verdict === 'unsound' );
	const written = new Set(producers.flatMap(spec.writes));
	const uncovered = spec.reads(consumer).filter(( k ) => !written.has(k) );
	return { sound: !anyUnsound && uncovered.length === 0, anyUnsound, uncovered, perProducer: cc };
}

module.exports = { rebalancePlan, checkReassembly, measure, E1, E2, E3, E4, defaultFusionKey };
