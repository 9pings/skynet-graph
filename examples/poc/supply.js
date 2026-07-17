'use strict';
/**
 * Supply-chain grammar — the PAVAGE demonstrator. Three weakly-coupled sub-domains
 * (Procurement / Inventory / Transport) join through a narrow interface of separator facts
 * {leadTime, onHand, eta} consumed by a Fulfillment hub. `treeDecomposition`/`forkPlan`
 * DERIVE that tiling from the concept-dependency graph (the pavage = minimize separators,
 * not modularity). A TTL defeasance then re-plans: when the clock passes the ETA, Transport
 * flips shipStatus to 'delayed' and the Fulfillment commitment retracts.
 *
 * Roadmap: docs/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §3.2.
 *   node examples/poc/supply.js
 */
global.__SERVER__ = true;
const path = require('path');
const Graph = require('../../lib/graph/index.js');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');
const { treeDecomposition, forkPlan } = require('../../lib/authoring/core/decompose');

const SUPPLY = path.join(__dirname, '..', '..', 'concepts', 'supply');

function supplyTiling() {
	const tree = buildConceptTree(SUPPLY);
	return { decomp: treeDecomposition(tree), plan: forkPlan(tree) };
}

function supplySeed( tick ) {
	return {
		lastRev: 0,
		freeNodes: [{ _id: 'clock', tick: tick || 0 }],
		nodes: [{ _id: 'order1', orderReq: true, stockReq: true, shipReq: true, reorderPoint: 5 }],
		segments: []
	};
}

// stabilize a healthy order; optionally advance the clock past the ETA to trigger the TTL defeasance.
function runSupplyScenario( advanceTickTo ) {
	Graph._providers = {};
	const tree = buildConceptTree(SUPPLY);
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('supply scenario timed out')), 20000);
		let phase = 0; const snap = {};
		new Graph(supplySeed(0), {
			label: 'supply', isMaster: true, autoMount: true, conceptSets: ['supply'], bagRefManagers: {}, logLevel: 'error',
			onStabilize( g ) {
				try {
					const e = g._objById['order1']._etty._;
					if ( phase === 0 ) {
						phase = 1;
						snap.healthy = {
							Procurement: !!e.Procurement, SupplierConfirm: !!e.SupplierConfirm, leadTime: e.leadTime,
							Inventory: !!e.Inventory, Reorder: !!e.Reorder, onHand: e.onHand,
							Transport: !!e.Transport, eta: e.eta, shipStatus: e.shipStatus,
							Fulfillment: !!e.Fulfillment
						};
						if ( advanceTickTo == null ) { clearTimeout(timer); return resolve(snap); }
						g.pushMutation({ $$_id: 'clock', tick: advanceTickTo }, 'clock');   // clock passes the ETA
						if ( !g._running ) g._taskFlow.run();
					} else if ( phase === 1 ) {
						clearTimeout(timer);
						// the overdue shipment defeases the commitment (the re-plan trigger)
						snap.delayed = { Fulfillment: !!e.Fulfillment, tick: g._objById['clock']._etty._.tick };
						resolve(snap);
					}
				} catch ( err ) { clearTimeout(timer); reject(err); }
			}
		}, { supply: tree });
	});
}

module.exports = { supplyTiling, runSupplyScenario, SUPPLY };

if ( require.main === module ) {
	const t = supplyTiling();
	console.log('\n=== Supply-chain PAVAGE (tree-decomposition of the concept tree) ===\n');
	console.log('treeDecomposition: separators', JSON.stringify(t.decomp.separators), '| treewidth', t.decomp.treewidth, '| tiles', t.decomp.nTiles, '| partitionPays', t.decomp.partitionPays);
	console.log('forkPlan: separators', JSON.stringify(t.plan.separators), '|', t.plan.forks.length, 'forks');
	t.plan.forks.forEach(( f ) => console.log('  fork', JSON.stringify(f.concepts), '-> frontier', JSON.stringify(f.frontier)));
	runSupplyScenario(11).then(( s ) => {
		console.log('\nHEALTHY (clock=0) :', JSON.stringify(s.healthy));
		console.log('OVERDUE (clock=11):', JSON.stringify(s.delayed), '<- Fulfillment retracted = re-plan trigger');
		process.exit(0);
	}).catch(( e ) => { console.error(e); process.exit(1); });
}
