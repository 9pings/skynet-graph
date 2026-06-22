'use strict';
/**
 * Reactive budget cap — the K2 fix (exploration explosion). A decomposition that
 * would otherwise grow without bound is gated on an `ensure` over a shared budget:
 * each growth pushes (race-free `{__push}`) onto `budget.spent`, and the concept is
 * only applicable while `$budget:spent.length < CAP`. When the budget is spent,
 * growth stops and the graph stabilizes — exploration is bounded by construction.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('an ensure-gated budget bounds an otherwise-unbounded decomposition', async () => {
	const CAP = 5;
	// Grow spawns ONE child per segment (a chain) and charges the budget; without the
	// gate this chain never stops. Linear fan-out => no frontier overshoot => exactly CAP.
	Graph._providers = {
		AI: {
			grow(graph, concept, scope, argz, cb) {
				const id = scope._._id, child = id + '_x';
				cb(null, [
					{ $_id: '_parent', Grow: true },
					{ $$_id: 'budget', spent: { __push: id } },
					{ _id: child, Segment: true, originNode: scope._.originNode, targetNode: scope._.targetNode }
				]);
			}
		}
	};
	const conceptMap = {
		common: {
			childConcepts: {
				// assert (gate-at-evaluation), NOT ensure: a budget must not RETROACTIVELY
				// retract work already done when it runs out (that's ensure's defeasance).
				Grow: { _id: 'Grow', _name: 'Grow', require: 'Segment', assert: ['$$budget:spent.length < ' + CAP], provider: ['AI::grow'] }
			}
		}
	};
	const seed = {
		lastRev: 0,
		freeNodes: [{ _id: 'budget', spent: [] }],
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'root', originNode: 'a', targetNode: 'b' }]
	};

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('budget test timed out — growth not bounded?')), 15000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'budget', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
		}, conceptMap);
	});

	const spent = g._objById['budget']._etty._.spent;
	assert.equal(spent.length, CAP, `budget consumed exactly CAP (${CAP}) growth steps`);

	const grown = Object.keys(g._objById).filter(id => g._objById[id]._etty._.Grow).length;
	assert.equal(grown, CAP, 'exactly CAP segments grew');

	// the last spawned segment exists but did NOT grow — the budget gate stopped it
	const ungrown = Object.keys(g._objById).filter(id => {
		const e = g._objById[id]._etty._; return e.Segment && !e.Grow;
	});
	assert.ok(ungrown.length >= 1, 'at least one segment was left ungrown by the budget cap');
});
