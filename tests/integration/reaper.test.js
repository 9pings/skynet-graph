'use strict';
/**
 * Freshness reaper (N1 follow-on): the host registers freshness contracts and calls reap() to
 * automatically re-fetch stale cast-once provider-facts (today that refetch is manual per node).
 * Invalidation stays automatic (the $$clock-gated ensure retracts the stale fact); the reaper
 * automates the RE-FETCH, built entirely on the existing refetch + clock primitives (zero-core).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { clockSeed, advanceClock, clockNow, makeReaper } = require('../../lib/authoring/core/clock.js');
console.log = console.info = console.warn = () => {};

test('reaper re-fetches exactly the stale contracts after the clock advances', async () => {
	let fetches = 0;
	Graph._providers = { AI: {
		mark(g, c, scope, argz, cb) { const f = { $_id: '_parent' }; f[c._name] = true; cb(null, f); },
		sense(g, c, scope, argz, cb) { fetches++; const f = { $_id: '_parent', sensedAt: clockNow(g), data: 'v' + fetches }; f[c._name] = true; cb(null, f); }
	} };
	const tree = { childConcepts: {
		Live: {
			_id: 'Live', _name: 'Live', require: ['source'], ensure: ['$$clock:tick - $sensedAt < 2'], provider: ['AI::sense'],
			childConcepts: { Derived: { _id: 'Derived', _name: 'Derived', require: ['Live'], provider: ['AI::mark'] } }
		}
	} };
	const seed = { lastRev: 0, freeNodes: [clockSeed(0)], nodes: [{ _id: 'n', source: 'db', sensedAt: 0 }], segments: [] };
	const g = new Graph(seed, { label: 'reap', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: tree });
	await nextStable(g);

	const e = () => g._objById['n']._etty;
	const cast = (k) => !!e()._mappedConcepts[k];
	const reaper = makeReaper(g).watch('n', 'Live', { stampKey: 'sensedAt', ttl: 2 });

	// phase 0 — fresh: nothing stale, reap is a no-op
	assert.ok(cast('Live') && cast('Derived'));
	assert.equal(fetches, 1);
	assert.deepEqual(reaper.stale().map((c) => c.conceptId), [], 'fresh -> nothing stale');
	assert.equal(await new Promise((res) => reaper.reap(res)), 0, 'reap re-fetches nothing');
	assert.equal(fetches, 1);

	// phase 1 — advance past the TTL: Live auto-retracts (invalidation), and is now stale
	advanceClock(g, 3);
	await nextStable(g);
	assert.ok(!cast('Live') && !cast('Derived'), 'stale fact + dependent auto-retracted');
	assert.equal(reaper.stale().length, 1, 'the contract is now stale');
	assert.equal(fetches, 1, 'invalidation alone does NOT refetch');

	// phase 2 — reap: re-fetches the stale provider, restoring it fresh + re-stamped
	const n = await new Promise((res) => reaper.reap(res));
	assert.equal(n, 1, 'reaped exactly the stale contract');
	assert.ok(cast('Live') && cast('Derived'), 'reaped -> Live + dependent re-cast');
	assert.equal(e()._.sensedAt, 3, 're-stamped at the current tick');
	assert.equal(e()._.data, 'v2');
	assert.equal(fetches, 2, 'provider re-ran exactly once');

	// phase 3 — fresh again: reap is a no-op
	assert.deepEqual(reaper.stale().map((c) => c.conceptId), [], 'fresh after reap');
	assert.equal(await new Promise((res) => reaper.reap(res)), 0);
	assert.equal(fetches, 2);
});
