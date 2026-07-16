'use strict';
/**
 * P1 — cfg.frontierComparator: an OPT-IN per-concept frontier ordering. Two trial concepts are
 * simultaneously applicable on one object; the comparator decides which the engine applies
 * FIRST (a soft-preference policy — the B finding: the frontier order was not host-controllable).
 * Default (no comparator) preserves the existing order. The ordering is a scheduling hint: it
 * never changes the fixpoint (both still cast), only the sequence.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');

console.log = console.info = console.warn = () => {};

const order = [];
Graph._providers = Object.assign({}, Graph._providers, { T: {
	a(graph, concept, scope, argz, cb) { order.push('A'); cb(null, { $_id: '_parent', TrialA: true }); },
	b(graph, concept, scope, argz, cb) { order.push('B'); cb(null, { $_id: '_parent', TrialB: true }); }
} });

// both trials require the same trigger fact -> both applicable on the same object at once
const tree = { common: { childConcepts: {
	Seg: { _id: 'Seg', _name: 'Seg', require: ['seg'], childConcepts: {
		TrialA: { _id: 'TrialA', _name: 'TrialA', require: ['seg'], provider: ['T::a'] },
		TrialB: { _id: 'TrialB', _name: 'TrialB', require: ['seg'], provider: ['T::b'] }
	} }
} } };

async function run(comparator) {
	order.length = 0;
	const conf = { label: 'p1', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
	if (comparator) conf.frontierComparator = comparator;
	const g = new Graph({ lastRev: 0, nodes: [{ _id: 'n', seg: true }], segments: [] }, conf, tree);
	await nextStable(g);
	return { order: order.slice(), bothCast: !!(g._objById['n']._etty._.TrialA && g._objById['n']._etty._.TrialB) };
}

const byName = (dir) => (a, b) => (a._name < b._name ? -1 : a._name > b._name ? 1 : 0) * dir;

test('the comparator deterministically controls per-object application order (both directions)', async () => {
	const asc = await run(byName(1));    // A before B
	assert.deepEqual(asc.order, ['A', 'B'], 'ascending-name comparator -> A first');
	const desc = await run(byName(-1));  // B before A
	assert.deepEqual(desc.order, ['B', 'A'], 'descending-name comparator -> B first');
	// same setup, opposite order -> the comparator is what controls it
	assert.notDeepEqual(asc.order, desc.order);
});

test('the ordering is a scheduling hint only — the fixpoint is unchanged (both still cast)', async () => {
	for (const dir of [1, -1]) {
		const r = await run(byName(dir));
		assert.equal(r.bothCast, true, 'both trials cast regardless of order (fixpoint preserved)');
	}
});

test('default (no comparator) preserves behaviour — both cast, no error', async () => {
	const r = await run(null);
	assert.equal(r.bothCast, true);
	assert.equal(r.order.length, 2, 'both providers ran');
});
