'use strict';
/**
 * memo-stability — the safety instrument for structure-learning (study 2026-06-26,
 * promotes experiment F4). A structural change (addConcept/patchConcept) is SAFE iff
 * it preserves the canonical memo keys (<name>FactsDigest surface) that incumbent
 * concepts depend on. memoSnapshot captures those keys; memoDiff flags any drift.
 *
 *   Mode A (memo-surface-preserving): a new concept produces an isolated key nobody
 *     gates on -> incumbents' memo keys unchanged -> stable.
 *   Mode B (memo-surface-perturbing): a new concept overwrites a key an incumbent
 *     reads -> the incumbent's memo key changes -> flagged (the silent-K1-collapse).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { memoSnapshot, memoDiff, assertMemoStable } = require('../../lib/authoring/memo-stability.js');
const canon = require('../../lib/providers/canonicalize.js');
console.log = console.info = console.warn = () => {};

const conf = (label) => ({ label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' });
const providers = {
	Cn: {
		extract: (g, c, s, a, cb) => {
			const raw = s._.raw, cat = raw >= 150 ? 'high' : 'low', lvl = Math.round(raw / 100) * 100;
			cb(null, { $_id: '_parent', Canon: true, cat, lvl, canonDigest: canon.digest({ cat, lvl }) });
		},
		// a newly-authored finer re-canonicalizer that OVERWRITES the incumbent's memo key
		refine: (g, c, s, a, cb) => {
			const lvl = Math.round(s._.raw / 10) * 10;
			cb(null, { $_id: '_parent', Recanon: true, canonDigest: canon.digest({ cat: s._.cat, lvl }) });
		},
		aux: (g, c, s, a, cb) => cb(null, { $_id: '_parent', Aux: true, auxNote: 'n-' + s._.cat }),
	},
};
const TREE = {
	childConcepts: {
		Canon: { _id: 'Canon', _name: 'Canon', require: ['raw'], provider: ['Cn::extract'] },
		// the incumbent whose memo surface is {canonDigest}
		Consume: { _id: 'Consume', _name: 'Consume', require: ['canonDigest'], applyMutations: [{ $_id: '_parent', Consume: true }] },
	},
};
const SEED = { lastRev: 0, nodes: [{ _id: 'O1', raw: 173 }, { _id: 'O2', raw: 173 }], segments: [] };

async function boot(tree, label) {
	Graph._providers = Object.assign({}, Graph._providers, providers);
	const g = new Graph(SEED, conf(label), { common: JSON.parse(JSON.stringify(tree)) });
	await nextStable(g);
	return g;
}
const addConceptP = (g, schema) => new Promise((res) => g.addConcept(null, schema, () => res()));

test('memoDiff of an unchanged snapshot is stable (not vacuous)', async () => {
	const g = await boot(TREE, 'memo-noop');
	const s = memoSnapshot(g, ['Consume']);
	assert.ok(Object.keys(s).length >= 2, 'snapshot should cover both objects');
	assert.equal(memoDiff(s, memoSnapshot(g, ['Consume'])).stable, true);
});

test('Mode A: a new isolated concept preserves incumbents memo keys (stable)', async () => {
	const g = await boot(TREE, 'memo-A');
	const before = memoSnapshot(g, ['Consume']);
	await addConceptP(g, { _id: 'Aux', _name: 'Aux', require: ['cat'], provider: ['Cn::aux'] });
	const d = memoDiff(before, memoSnapshot(g, ['Consume']));
	assert.equal(d.stable, true);
	assert.equal(d.changed.length, 0);
});

test('Mode B: a new concept overwriting an incumbent memo key is flagged (unstable)', async () => {
	const g = await boot(TREE, 'memo-B');
	const before = memoSnapshot(g, ['Consume']);
	await addConceptP(g, { _id: 'Recanon', _name: 'Recanon', require: ['Canon'], provider: ['Cn::refine'] });
	const d = memoDiff(before, memoSnapshot(g, ['Consume']));
	assert.equal(d.stable, false);
	assert.ok(d.changed.some((c) => /Consume/.test(c.key)), 'the perturbed incumbent must be named');
});

test('assertMemoStable passes a memo-surface-preserving change (the CI gate)', async () => {
	const g = await boot(TREE, 'guard-A');
	const d = await assertMemoStable(g, ['Consume'], () => addConceptP(g, { _id: 'Aux', _name: 'Aux', require: ['cat'], provider: ['Cn::aux'] }));
	assert.equal(d.stable, true);
});

test('assertMemoStable throws on a memo-surface-perturbing change (fail-closed)', async () => {
	const g = await boot(TREE, 'guard-B');
	await assert.rejects(
		() => assertMemoStable(g, ['Consume'], () => addConceptP(g, { _id: 'Recanon', _name: 'Recanon', require: ['Canon'], provider: ['Cn::refine'] })),
		/memo-stability violation/
	);
});
