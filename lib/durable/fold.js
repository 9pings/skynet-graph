/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * fold — the PURE half of the durable executor's fan-in JOIN (the JTMS-at-merge point, study §9.3). When a
 * `map` fan-out's children rejoin (`checkpoint-store.js#joinArrive` spawns ONE collector carrying the sibling
 * payloads), Layer B reduces them to a single value. Two reduce kinds:
 *   · a declared MONOID (this module) — a pure, content-memoizable tree-reduce: `{ monoid, key?, into? }`;
 *   · a micro-TASK (handled in `interpreter.js`) — a small-LLM reconciliation when the join is not pure logic
 *     (§0.1: "some joins may be small-LLM micro-tasks rather than pure logic").
 *
 * "DECLARE THE ACC ALGEBRA" (study §9.3 / §12): the fold loop is delegated to `semiring.js#reduceSemiring`, which
 * is the coherence-theorem-validated commutative-monoid REDUCE (E1: monoid variance ≈ 0). So a fold over a
 * COMMUTATIVE monoid is ORDER-INDEPENDENT — the durable executor's cross-record interleaving is non-deterministic
 * THROUGHPUT, yet the folded BELIEF is deterministic. For the two NON-commutative monoids here (concat / merge)
 * we sort the siblings by their element index `_i` first, so the result is deterministic regardless of the
 * (non-semantic) arrival order. Either way: non-deterministic schedule, deterministic value.
 */

const { reduceSemiring } = require('../providers/semiring.js');

// Each monoid: prep (per-value normaliser) + plus (⊕) + zero (a THUNK — a fresh identity per fold, never a
// shared mutable) + commutative (does arrival order matter?). All are associative; commutative ones inherit
// reduceSemiring's order-independence, the rest are made deterministic by the `_i` sort in foldSiblings.
const MONOIDS = {
	sum:     { prep: Number,                                  plus: ( a, b ) => a + b,                   zero: () => 0,         commutative: true },
	product: { prep: Number,                                  plus: ( a, b ) => a * b,                   zero: () => 1,         commutative: true },
	min:     { prep: Number,                                  plus: ( a, b ) => Math.min(a, b),          zero: () => Infinity,  commutative: true },
	max:     { prep: Number,                                  plus: ( a, b ) => Math.max(a, b),          zero: () => -Infinity, commutative: true },
	count:   { prep: () => 1,                                 plus: ( a, b ) => a + b,                   zero: () => 0,         commutative: true },
	and:     { prep: ( v ) => !!v,                            plus: ( a, b ) => !!(a && b),              zero: () => true,      commutative: true },
	or:      { prep: ( v ) => !!v,                            plus: ( a, b ) => !!(a || b),              zero: () => false,     commutative: true },
	concat:  { prep: ( v ) => (Array.isArray(v) ? v : [v]),   plus: ( a, b ) => a.concat(b),             zero: () => [],        commutative: false },
	merge:   { prep: ( v ) => (v && typeof v === 'object' ? v : {}), plus: ( a, b ) => Object.assign({}, a, b), zero: () => ({}), commutative: false },
};

function monoids() { return Object.keys(MONOIDS); }
function isCommutative( name ) { return !!(MONOIDS[name] && MONOIDS[name].commutative); }

/**
 * Reduce the collected sibling payloads to one output object via a declared monoid.
 * @param siblings  the fan-out children's payloads (the collector token's `_siblings`)
 * @param reduce    { monoid:'<name>', key?:'<factKey to fold; default the whole payload>', into?:'<output key>' }
 * @returns { [into]: <folded value>, _n }   — the bounded projection (N inputs → 1 value)
 */
function foldSiblings( siblings, reduce ) {
	const m = MONOIDS[reduce && reduce.monoid];
	if ( !m ) throw new Error('foldSiblings: unknown monoid "' + (reduce && reduce.monoid) + '" (have: ' + monoids().join(',') + ')');
	const key = reduce.key, into = reduce.into || reduce.key || 'result';
	// sort by element index for a deterministic fold even under a NON-commutative ⊕ (arrival order is non-semantic)
	const ordered = (siblings || []).slice().sort(( a, b ) => ((a && a._i) || 0) - ((b && b._i) || 0));
	const values = ordered.map(( p ) => m.prep(key == null ? p : (p == null ? undefined : p[key])));
	const r = reduceSemiring(values, { plus: m.plus, zero: m.zero() });   // the declared acc algebra (semiring.js)
	const out = {}; out[into] = r.acc; out._n = ordered.length;
	return out;
}

module.exports = { foldSiblings, monoids, isCommutative, MONOIDS };
