'use strict';
/**
 * Host-side clock for freshness / TTL / epochs as facts (roadmap N1).
 *
 * Time enters the graph as an ordinary fact on a `clock` free-node — the engine has no
 * internal wall-clock (and shouldn't: that keeps replay hermetic). A time-bound concept
 * gates freshness in an `ensure`, e.g. `ensure:["$$clock:tick - $sensedAt < $ttl"]`.
 *
 * IMPORTANT: reference the global clock with a DOUBLE-`$` — `$$clock:tick`. A single
 * `$clock` is a key on the *current* scope (almost always undefined); the ref regex
 * consumes one `$`, so the global free-node ref needs two (HANDOFF §3). A provider reads
 * it via `clockNow(graph)`.
 *
 * Advancing the clock (a one-line mutation) re-tests EXACTLY the concepts whose `ensure`
 * follows `$$clock:tick` — the existing ensure/defeasance re-fire path. A fact that has
 * gone stale (and its dependents) retracts in cascade; this is the cache-poisoning fix
 * (a graven LLM/API fact otherwise lives forever). Near-zero new evaluation code.
 *
 * BOUNDARY (honest): invalidation is automatic + reliable. Automatic RE-FETCH is not —
 * a provider is cast-once, so a stale provider-fact re-derives only on uncast→recast.
 * Re-trigger it from the host (`refetch` below = uncast/recast, which re-runs the
 * provider with the now-current clock) or bump its input. A fully-autonomous reaper that
 * destabilizes+recasts stale nodes itself is an optional core primitive (see HANDOFF §5).
 */

const CLOCK_ID = 'clock';

// A clock seed entry — spread into `seed.freeNodes`.
function clockSeed( tick ) { return { _id: CLOCK_ID, tick: tick || 0 }; }

// The current tick (for a provider to stamp `<x>At: clockNow(graph)`).
function clockNow( graph ) {
	var c = graph._objById[CLOCK_ID];
	return c ? c._etty._.tick : undefined;
}

// Advance the clock by `delta` (default 1). Returns the new tick. Re-tests every
// `$$clock:tick`-following concept → stale facts (and dependents) retract.
function advanceClock( graph, delta ) {
	var tick = (clockNow(graph) || 0) + (delta == null ? 1 : delta);
	graph.pushMutation({ $$_id: CLOCK_ID, tick: tick }, CLOCK_ID);
	return tick;
}

// Host-triggered refetch of a cast-once provider concept: re-run it against the current
// clock. If still cast (forced early refresh) uncast first; if already stale-retracted,
// a direct re-cast re-runs the provider. The reliable refresh path (zero-core).
function refetch( graph, objId, conceptId, cb ) {
	var etty = graph._objById[objId] && graph._objById[objId]._etty,
	    isCast = etty && etty._mappedConcepts && etty._mappedConcepts[conceptId];
	if ( isCast ) graph.unCastConcept(objId, conceptId, function () { graph.castConcept(objId, conceptId, cb); });
	else graph.castConcept(objId, conceptId, cb);
}

module.exports = { CLOCK_ID: CLOCK_ID, clockSeed: clockSeed, clockNow: clockNow, advanceClock: advanceClock, refetch: refetch };
