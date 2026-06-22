'use strict';
/**
 * Array-append primitive: a mutation template value `{__push: x}` APPENDS x to the
 * existing array at apply-time (instead of replacing). Because mutations are
 * serialized, concurrent fan-in (many children appending to one parent) is
 * race-free — fixing the read-modify-write race that blocks reactive
 * completion-gating, k-of-n voting, and budget-spent tracking.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('{__push} appends race-free when multiple concepts fan in to one array', async () => {
	// each segment's Push concept appends its own id to the shared `acc.items` array
	Graph._providers = {
		AI: { push(graph, concept, scope, argz, cb) { cb(null, [{ $_id: '_parent', Push: true }, { $$_id: 'acc', items: { __push: scope._._id } }]); } }
	};
	const conceptMap = {
		common: { childConcepts: { Push: { _id: 'Push', _name: 'Push', require: 'Segment', provider: ['AI::push'] } } }
	};
	const seed = {
		lastRev: 0,
		freeNodes: [{ _id: 'acc', items: [] }],
		nodes: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
		segments: [
			{ _id: 's1', originNode: 'a', targetNode: 'b' },
			{ _id: 's2', originNode: 'b', targetNode: 'c' },
			{ _id: 's3', originNode: 'a', targetNode: 'c' }
		]
	};

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('array-append timed out')), 15000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'push', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
		}, conceptMap);
	});

	const items = g._objById['acc']._etty._.items;
	assert.ok(Array.isArray(items), 'acc.items is an array');
	assert.deepEqual(items.slice().sort(), ['s1', 's2', 's3'], 'ALL three appends survived (race-free), not just the last');
});

test('{__push} onto an absent/non-array key creates the array', async () => {
	Graph._providers = { AI: { push(graph, concept, scope, argz, cb) { cb(null, [{ $_id: '_parent', Push: true }, { $$_id: 'acc', seen: { __push: 'x' } }]); } } };
	const conceptMap = { common: { childConcepts: { Push: { _id: 'Push', _name: 'Push', require: 'Segment', provider: ['AI::push'] } } } };
	const seed = { lastRev: 0, freeNodes: [{ _id: 'acc' }], nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b' }] };
	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out')), 10000);
		let done = false;
		const graph = new Graph(seed, { label: 'p2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); } }, conceptMap);
	});
	assert.deepEqual(g._objById['acc']._etty._.seen, ['x'], 'created array from absent key');
});
