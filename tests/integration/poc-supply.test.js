'use strict';
/**
 * Supply-chain grammar — the PAVAGE demonstrator. Three weakly-coupled sub-domains
 * (Procurement / Inventory / Transport) join through a narrow separator interface
 * {leadTime, onHand} consumed by a Fulfillment hub. treeDecomposition/forkPlan DERIVE that
 * tiling from the concept-dependency graph (the pavage = minimize separators). A TTL
 * defeasance re-plans: when the clock passes the ETA the Fulfillment commitment retracts
 * (the engine-faithful N1 polarity — committed WHILE valid, retract WHEN stale). Setup:
 * examples/poc/supply.js. Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §3.2.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { supplyTiling, runSupplyScenario, SUPPLY } = require('../../examples/poc/supply.js');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');
const { validateConceptTree } = require('../../lib/authoring/core/validate');
console.log = console.info = console.warn = () => {};

test('the supply grammar tiles into 3 sub-domains with a narrow separator interface (pavage)', () => {
	const { decomp, plan } = supplyTiling();
	assert.deepEqual(decomp.separators, ['leadTime', 'onHand'], 'derived separator interface (the narrow waist)');
	assert.equal(decomp.nTiles, 3, 'three tiles');
	assert.equal(decomp.partitionPays, true, 'thin cut + multiple tiles -> partitioning pays');
	assert.equal(plan.forks.length, 3, 'one fork per tile');
	const forkWith = ( n ) => plan.forks.find(( f ) => f.concepts.includes(n));
	assert.deepEqual(forkWith('Procurement').frontier, ['leadTime'], 'procurement tile crosses only leadTime');
	assert.deepEqual(forkWith('Inventory').frontier, ['onHand'], 'inventory tile crosses only onHand');
	assert.notEqual(forkWith('Procurement'), forkWith('Inventory'), 'distinct tiles');
	// every fork's frontier is a subset of the derived separators (the contract closes)
	for ( const f of plan.forks ) for ( const s of f.frontier ) assert.ok(plan.separators.includes(s), 'frontier ⊆ separators');
});

test('the supply grammar stabilizes a healthy order, then defeases on an overdue shipment (TTL)', async () => {
	const s = await runSupplyScenario(11);
	// healthy: each of the three tiles produced its separator fact; the hub committed
	assert.ok(s.healthy.SupplierConfirm && s.healthy.leadTime === 5, 'procurement -> leadTime');
	assert.ok(s.healthy.Reorder && s.healthy.onHand === 3, 'inventory -> onHand (reorder triggered by the R2-safe range check)');
	assert.ok(s.healthy.Transport && s.healthy.eta === 10, 'transport -> eta');
	assert.equal(s.healthy.Fulfillment, true, 'the hub committed while on-time (consumes the 3 separators)');
	// overdue: the clock passed the ETA -> the commitment RETRACTS (the re-plan trigger)
	assert.equal(s.delayed.Fulfillment, false, 'Fulfillment defeased when the shipment went overdue (TTL retraction)');
	assert.equal(s.delayed.tick, 11, 'the clock advanced past the ETA');
});

test('the supply grammar validates clean', () => {
	const { errors } = validateConceptTree(buildConceptTree(SUPPLY), { flagContinuousGates: true });
	assert.equal(errors.length, 0, 'no errors: ' + JSON.stringify(errors));
});
