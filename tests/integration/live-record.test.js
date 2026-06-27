'use strict';
/**
 * LIVE-RECORD path (study §5 / rung 1, B1+B9) — `Graph.ingest()` flows live external-record fields IN as
 * GRAPH FACTS through the SEQUENCED, rev-logged mutation path, while a bagRef stays a read-once SNAPSHOT
 * for structural fields. The JTMS re-derives only the defeasible leaves; structural decisions don't churn.
 *
 *   - B9 split        : a defeasible concept (keyed on an ingested fact) retracts/re-casts on CDC; a
 *                       structural concept (keyed on the bagRef snapshot) never re-derives.
 *   - batched + seq   : a multi-record ingest is ONE rev step (sequenced, bisectable).
 *   - freshness TTL   : a `$$clock` ensure retracts a stale leaf; re-ingest restores it.
 *   - negative control: ingesting an UNCHANGED value re-derives nothing (#22).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { clockSeed, advanceClock } = require('../../lib/authoring/clock.js');
console.log = console.info = console.warn = () => {};

async function settle( g ) {
	for ( let i = 0; i < 50; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) { await new Promise(( r ) => setImmediate(r)); if ( !g._unstable.length && !g._triggeredCastCount ) return; }
	}
}

test('ingest() drives the B9 split: defeasible leaf re-derives, structural snapshot holds', async () => {
	const DB = { 'db:r1': { kind: 'X' }, 'db:r2': { kind: 'X' } };          // structural snapshot only
	const bagRefManagers = { db: { test: /^db:(.+)$/, int: { get( id, cb ) { cb(null, DB['db:' + id]); } } } };
	let structRuns = 0, liveRuns = 0;
	Graph._providers = { AI: {
		struct( g, c, scope, argz, cb ) { structRuns++; cb(null, { $_id: '_parent', [c._name]: true }); },
		live( g, c, scope, argz, cb ) { liveRuns++; cb(null, { $_id: '_parent', [c._name]: true }); }
	} };
	const tree = { common: { childConcepts: {
		Struct: { _id: 'Struct', _name: 'Struct', require: ['binding'], ensure: ['$binding:kind == "X"'], provider: ['AI::struct'] },
		Live:   { _id: 'Live',   _name: 'Live',   require: ['status', 'sensedAt'], ensure: ['$status == "open"', '$$clock:tick - $sensedAt < 3'], provider: ['AI::live'] }
	} } };
	const seed = { lastRev: 0, freeNodes: [clockSeed(0)], bagRefs: { 'db:r1': { count: 1 }, 'db:r2': { count: 1 } },
		nodes: [ { _id: 'n1', binding: 'db:r1', status: 'open', sensedAt: 0 }, { _id: 'n2', binding: 'db:r2', status: 'open', sensedAt: 0 } ], segments: [] };

	const g = new Graph(seed, { label: 'live', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers, logLevel: 'error' }, tree);
	await settle(g);
	const cast = ( id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
	assert.ok(cast('n1', 'Struct') && cast('n1', 'Live') && cast('n2', 'Live'), 'fresh: structural + defeasible cast on both');
	const structAtBoot = structRuns;

	// BATCH CDC: n1 closes, n2 stays open -> ONE sequenced rev step
	const revBefore = g.getCurrentRevision();
	await new Promise(( res ) => g.ingest({ n1: { status: 'closed', sensedAt: 1 }, n2: { status: 'open', sensedAt: 1 } }, res));
	assert.equal(g.getCurrentRevision(), revBefore + 1, 'a multi-record ingest is ONE sequenced rev step (batched, bisectable)');
	assert.ok(!cast('n1', 'Live'), 'B9: the defeasible leaf retracts on CDC');
	assert.ok(cast('n2', 'Live'), 'the other record is untouched (per-instance)');
	assert.ok(cast('n1', 'Struct'), 'B9: the structural concept stays cast (snapshot)');
	assert.equal(structRuns, structAtBoot, 'B9: the structural provider NEVER re-ran (#22 — snapshot consistency)');

	// re-ingest n1 open -> the defeasible leaf re-derives
	const liveBefore = liveRuns;
	await new Promise(( res ) => g.ingest({ n1: { status: 'open', sensedAt: 2 } }, res));
	assert.ok(cast('n1', 'Live'), 'the defeasible leaf re-casts when the live value returns');
	assert.equal(liveRuns, liveBefore + 1, 'the defeasible provider re-ran exactly once');

	// FRESHNESS: clock past TTL, no CDC -> stale retraction (both)
	await new Promise(( res ) => { advanceClock(g, 10); g.stabilize(res); });
	await settle(g);
	assert.ok(!cast('n1', 'Live') && !cast('n2', 'Live'), 'TTL: stale defeasible leaves retract without a CDC tick');

	// re-ingest fresh -> restored
	const now = g._objById['clock']._etty._.tick;
	await new Promise(( res ) => g.ingest({ n1: { status: 'open', sensedAt: now }, n2: { status: 'open', sensedAt: now } }, res));
	assert.ok(cast('n1', 'Live') && cast('n2', 'Live'), 'fresh CDC restores the defeasible leaves');

	// NEGATIVE CONTROL: ingest the SAME status -> nothing re-derives
	const liveSteady = liveRuns;
	await new Promise(( res ) => g.ingest({ n1: { status: 'open', sensedAt: now + 1 } }, res));
	assert.equal(liveRuns, liveSteady, 'negative control: an unchanged value re-derives nothing (#22)');
});
