'use strict';
/**
 * METHOD / INSTANCE fork-per-case driver (study §5, rung 2). One warm METHOD (concept tree + shared, versioned
 * derivation cache); external records flow through as INSTANCES, each a `method.fork(seed=record)` in its own
 * world (B7). Asserts the study's claims with negative controls:
 *   - cost decay : the 1st case warms the method; same-CLASS cases replay at ZERO provider calls (even with
 *                  different INCIDENTAL fields — the cache keys on the CANONICAL structural snapshot, K1/C1/B2).
 *   - no false replay : a structurally-NOVEL record pays in full and gets the correct (different) result.
 *   - B8 version pin  : a method version bump re-pays (a v1 template is never served under v2).
 *   - B7 isolation    : each instance lives + dies in its own fork; the method world stays empty.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scenario } = require('../../examples/poc/method-instance.js');

test('one warm method, N fork-per-case instances: cost decays to 0, no false replay, B8 re-pays, B7 isolated', async () => {
	const r = await scenario();
	const costs = r.costs.map(( c ) => c.cost);

	assert.equal(costs[0], 2, 'case 1 is COLD — pays both provider steps');
	assert.deepEqual(costs.slice(1, 5), [0, 0, 0, 0], 'cases 2-5 (same class, varied incidental size) replay at ZERO calls');
	assert.equal(r.costs[1].result, 'plan<A:small>', 'a warm replay still yields the correct result');

	assert.equal(costs[5], 2, 'the structurally-NOVEL case pays in full (no false replay — keys on the justification)');
	assert.equal(r.costs[5].result, 'plan<B:big>', 'the novel case gets its OWN correct result, not the replayed one');

	assert.equal(r.afterPatch.cost, 2, 'B8: after a method version bump, a same-class case re-pays (no stale v1 template)');

	assert.equal(r.methodObjs, 0, 'B7: every instance lived + died in its own fork; the method world stays empty');
	assert.ok(r.stats.hits >= 8 && r.stats.bypass === 0, 'cache replayed the warm cases (hits) with no bypass');
});
