/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * LIVE-RECORD path — the graph as a reactive belief-VIEW over external DB records (study §5 / rung 1).
 *
 * The engine binds a graph object to an external record via a bagRef (`db:<id>`). A bagRef is read ONCE
 * and cached — which is exactly right for a record's STRUCTURAL fields (the ones the decomposition keys
 * on: they must not churn mid-case). A record's DEFEASIBLE / live fields are pushed in instead as ordinary
 * GRAPH FACTS through `graph.ingest(...)` — the host's CDC feed — so the JTMS re-derives exactly the leaves
 * that depend on them. That split (structural-snapshot vs defeasible-live) is study blocking-point B9.
 *
 * Why ingest() and not a bagRef refetch: every change must be a mutation TEMPLATE applied through the
 * SEQUENCED taskflow (rev-logged, hence bisectable / replayable via pushAtomicUpdates) — never an
 * out-of-band write, which would lose determinism. This is how the original host (epikeo) flowed external
 * data: through the atomic-update / revision path.
 *
 *   node examples/poc/live-record.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { clockSeed, advanceClock } = require('../../lib/authoring/core/clock.js');

const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');
async function settle( g ) {
	for ( let i = 0; i < 50; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) { await new Promise(( r ) => setImmediate(r)); if ( !g._unstable.length && !g._triggeredCastCount ) return; }
	}
}

// ---- the external "DB": each order record carries STRUCTURAL fields only (region drives routing). ----
const DB = {
	'db:order-1': { region: 'EU', priority: 'std' },
	'db:order-2': { region: 'US', priority: 'std' }
};
const bagRefManagers = { db: { test: /^db:(.+)$/, int: { get( id, cb ) { cb(null, DB['db:' + id]); } } } };

// ---- the method (concepts) ----
//  RouteEU  — STRUCTURAL: keys on the bagRef snapshot (region). A routing decision; must be stable per case.
//  Fulfillable — DEFEASIBLE: keys on the LIVE `stockStatus` graph fact + a freshness TTL on the clock.
let routeRuns = 0, fulfilRuns = 0;
Graph._providers = { Ops: {
	route( g, c, scope, argz, cb ) { routeRuns++; cb(null, { $_id: '_parent', route: 'EU-hub', [c._name]: true }); },
	fulfil( g, c, scope, argz, cb ) { fulfilRuns++; cb(null, { $_id: '_parent', [c._name]: true }); }
} };
const tree = { common: { childConcepts: {
	RouteEU:     { _id: 'RouteEU', _name: 'RouteEU', require: ['binding'], ensure: ['$binding:region == "EU"'], provider: ['Ops::route'] },
	Fulfillable: { _id: 'Fulfillable', _name: 'Fulfillable', require: ['stockStatus', 'sensedAt'],
		ensure: ['$stockStatus == "in-stock"', '$$clock:tick - $sensedAt < 3'], provider: ['Ops::fulfil'] }
} } };

const seed = { lastRev: 0, freeNodes: [clockSeed(0)],
	bagRefs: { 'db:order-1': { count: 1 }, 'db:order-2': { count: 1 } },
	nodes: [
		{ _id: 'order-1', binding: 'db:order-1', stockStatus: 'in-stock', sensedAt: 0 },
		{ _id: 'order-2', binding: 'db:order-2', stockStatus: 'in-stock', sensedAt: 0 }
	], segments: [] };

async function main() {
	out('\nLIVE-RECORD — bagRef snapshot (structural) + ingest() CDC (defeasible), JTMS belief-view\n');
	const g = new Graph(seed, { label: 'live-record', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers, logLevel: 'error' }, tree);
	await settle(g);
	const cast = ( id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
	const show = ( h ) => out(h.padEnd(30) + ` order-1[route=${cast('order-1', 'RouteEU')} fulfil=${cast('order-1', 'Fulfillable')}]  order-2[route=${cast('order-2', 'RouteEU')} fulfil=${cast('order-2', 'Fulfillable')}]  rev=${g.getCurrentRevision()}`);
	show('boot');
	out(`   (order-1 is EU -> routed; order-2 is US -> not; both in-stock -> fulfillable.  route calls=${routeRuns})\n`);

	out('CDC tick 1 — order-1 goes out-of-stock (ONE batched, sequenced ingest):');
	await new Promise(( res ) => g.ingest({ 'order-1': { stockStatus: 'out-of-stock', sensedAt: 1 } }, res));
	show('  after ingest');
	out(`   -> order-1 Fulfillable RETRACTS (JTMS); its EU route is STRUCTURAL and stays (snapshot, route calls still ${routeRuns}).\n`);

	out('CDC tick 2 — order-1 restocked:');
	await new Promise(( res ) => g.ingest({ 'order-1': { stockStatus: 'in-stock', sensedAt: 2 } }, res));
	show('  after ingest');

	out('\nFreshness — clock advances past the TTL with no CDC (the feed went silent):');
	await new Promise(( res ) => { advanceClock(g, 5); g.stabilize(res); });
	await settle(g);
	show('  after clock +5');
	out('   -> both Fulfillable retract as STALE (a graven belief cannot outlive its freshness contract).\n');

	out('CDC resumes — re-ingest fresh stamps:');
	const now = g._objById['clock']._etty._.tick;
	await new Promise(( res ) => g.ingest({ 'order-1': { stockStatus: 'in-stock', sensedAt: now }, 'order-2': { stockStatus: 'in-stock', sensedAt: now } }, res));
	show('  after ingest');
	out(`\n   structural route derivations across the whole run: ${routeRuns} (= the 1 EU order, never re-run — B9 snapshot).`);
	out(`   defeasible fulfil derivations: ${fulfilRuns} (re-run only when the live belief actually changed).\n`);
}

module.exports = { tree, bagRefManagers, DB };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
