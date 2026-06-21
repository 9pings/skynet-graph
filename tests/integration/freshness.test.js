'use strict';
/**
 * Freshness / TTL as facts (roadmap N1): time is an ordinary fact on a `clock` free-node;
 * a concept gates freshness with `ensure:["$$clock:tick - $sensedAt < ttl"]` (DOUBLE-$ —
 * a global free-node ref). Advancing the clock re-tests exactly the time-bound concepts:
 *
 *   1. INVALIDATION (automatic, reliable): a fact that has gone stale auto-retracts, and
 *      its dependents cascade-retract — the cache-poisoning fix (a graven fact otherwise
 *      lives forever).
 *   2. REFETCH (host-triggered): a cast-once provider re-derives only on uncast→recast;
 *      `refetch()` re-runs it against the now-current clock. (A fully-autonomous reaper is
 *      an optional core primitive — see HANDOFF §5.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
const { clockSeed, clockNow, advanceClock, refetch } = require('../../_lab/clock.js');
console.log = console.info = console.warn = () => {};

test('clock advance invalidates a stale fact + cascades; host refetch restores it fresh', async () => {
	let fetches = 0;
	Graph._providers = { AI: {
		mark(g, c, scope, argz, cb) { const f = { $_id: '_parent' }; f[c._name] = true; cb(null, f); },
		// "sense" an external source: stamp the fetch tick + a versioned value
		sense(g, c, scope, argz, cb) { fetches++; const f = { $_id: '_parent', sensedAt: clockNow(g), data: 'v' + fetches }; f[c._name] = true; cb(null, f); }
	} };
	const tree = { childConcepts: {
		Live: {
			_id: 'Live', _name: 'Live', require: ['source'], ensure: ['$$clock:tick - $sensedAt < 2'], provider: ['AI::sense'],
			childConcepts: { Derived: { _id: 'Derived', _name: 'Derived', require: ['Live'], provider: ['AI::mark'] } }
		}
	} };
	const seed = { lastRev: 0, freeNodes: [clockSeed(0)], nodes: [{ _id: 'n', source: 'db', sensedAt: 0 }], segments: [] };

	// a re-armable "next settle" so we can drive phases deterministically
	let resolveSettle = null;
	const arm = () => new Promise((res) => { resolveSettle = res; });
	const e = () => g._objById['n']._etty;
	const cast = (k) => !!e()._mappedConcepts[k];

	const first = arm();
	const g = new Graph(seed, {
		label: 'fresh', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
		onStabilize() { const r = resolveSettle; resolveSettle = null; if (r) r(); }
	}, { common: tree });

	// phase 0 — fresh: Live sensed at tick 0, dependent derived
	await first;
	assert.ok(cast('Live') && cast('Derived'), 'fresh: Live + dependent cast');
	assert.equal(e()._.data, 'v1');
	assert.equal(fetches, 1);

	// phase 1 — advance the clock past the TTL: Live goes stale -> retract + cascade
	const s1 = arm();
	advanceClock(g, 3);                                   // tick 0 -> 3, ttl is 2
	await s1;
	assert.ok(!cast('Live'), 'stale: Live auto-retracted (cache-poisoning fix)');
	assert.ok(!cast('Derived'), 'stale: dependent cascade-retracted');
	assert.equal(fetches, 1, 'no automatic refetch (cast-once provider)');

	// phase 2 — host-triggered refetch against the current clock (drive off its callback)
	await new Promise((res) => refetch(g, 'n', 'Live', res));
	assert.ok(cast('Live') && cast('Derived'), 'refetched: Live + dependent re-cast');
	assert.equal(e()._.sensedAt, 3, 're-stamped at the current tick');
	assert.equal(e()._.data, 'v2', 'fresh value fetched');
	assert.equal(fetches, 2, 'provider re-ran exactly once');
});
