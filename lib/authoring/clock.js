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

/**
 * Freshness reaper (N1 follow-on) — a zero-core HOST helper over `refetch`: the host registers
 * freshness contracts and calls `reap()` (e.g. right after `advanceClock`, or on a wall-clock
 * timer) to re-run the cast-once provider for every node whose stamp has aged past its TTL.
 * Invalidation is already automatic (a `$$clock`-gated `ensure` retracts a stale fact); this
 * automates the RE-FETCH that a cast-once provider otherwise needs the host to trigger per node.
 *
 * (The fully-autonomous version — the ENGINE reaping itself by piggybacking the settle loop —
 * is an optional CORE primitive, see HANDOFF §5; this is the host-loop form on existing parts.)
 *
 *   const reaper = makeReaper(graph);
 *   reaper.watch('sensorNode', 'Sensor', { stampKey: 'sensedAt', ttl: 100 });
 *   advanceClock(graph, 200);
 *   reaper.reap((n) => { ... n stale provider-facts re-fetched ... });
 *
 * A provider under a reaped contract MUST re-stamp its `stampKey` with `clockNow(graph)` when it
 * runs, or it stays stale and re-fetches every sweep.
 */
function makeReaper( graph ) {
	var contracts = [];
	return {
		// Register a freshness contract. ttl is in clock-tick units; stampKey is the fact the
		// provider stamps with `clockNow(graph)`.
		watch: function ( objId, conceptId, opts ) {
			opts = opts || {};
			contracts.push({ objId: objId, conceptId: conceptId, stampKey: opts.stampKey || 'sensedAt', ttl: opts.ttl });
			return this;
		},
		// The contracts whose stamp is missing or older than ttl vs the current clock.
		stale: function () {
			var now = clockNow(graph) || 0, out = [];
			contracts.forEach(function ( c ) {
				var o = graph._objById[c.objId], etty = o && o._etty;
				if ( !etty ) return;                                    // node gone — nothing to reap
				var stamp = etty._[c.stampKey];
				if ( stamp == null || (now - stamp) >= c.ttl ) out.push(c);
			});
			return out;
		},
		// Re-fetch every stale contract; cb(count) fires once all re-fetches have settled.
		reap: function ( cb ) {
			var due = this.stale(), n = due.length, done = 0;
			if ( !n ) { cb && cb(0); return 0; }
			due.forEach(function ( c ) {
				refetch(graph, c.objId, c.conceptId, function () { if ( ++done === n && cb ) cb(n); });
			});
			return n;
		}
	};
}

module.exports = { CLOCK_ID: CLOCK_ID, clockSeed: clockSeed, clockNow: clockNow, advanceClock: advanceClock, refetch: refetch, makeReaper: makeReaper };
