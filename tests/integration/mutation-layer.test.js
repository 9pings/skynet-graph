'use strict';
/**
 * mutation-layer study (2026-06-26): substantiate the verdict that the template engine +
 * {__push} + fold-after-quiescence + the rev-log is sufficient, and that an in-stream
 * value-dependent operator is an unnecessary non-goal.
 *
 *  (a) push+fold is ORDER-INDEPENDENT (a commutative monoid after quiescence); a pure
 *      control shows WHY only commutative ops are order-safe (non-commutative differs).
 *  (b) a matrix is a valid fact VALUE, but GATING on the raw matrix fragments the memo
 *      under any change while gating on a snapped scalar stays stable (the K1 boundary).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { memoSnapshot, memoDiff } = require('../../lib/authoring/memo-stability.js');
console.log = console.info = console.warn = () => {};

const conf = (label) => ({ label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' });
async function boot(tree, seed, providers, label) {
	if (providers) Graph._providers = Object.assign({}, Graph._providers, providers);
	const g = new Graph(JSON.parse(JSON.stringify(seed)), conf(label), { common: JSON.parse(JSON.stringify(tree)) });
	await nextStable(g);
	return g;
}
const push = async (g, tpl, id) => { g.pushMutation(tpl, id, true); await nextStable(g); return g; };
const fact = (g, id, k) => { const o = g._objById[id]; return o && o._etty ? o._etty._[k] : undefined; };

// (a) push + fold-after-quiescence is order-independent ------------------------------------
const Red = { sum: (g, c, s, a, cb) => { let t = 0; for (const o of (s._.obs || [])) t += o.v; cb(null, { $_id: '_parent', Sum: true, total: t }); } };
const sumTree = { childConcepts: { Sum: { _id: 'Sum', _name: 'Sum', require: ['obs'], ensure: ['$obs.length>=2'], provider: ['Red::sum'] } } };
const sumSeed = { lastRev: 0, nodes: [{ _id: 'hub', obs: [] }], segments: [] };

test('push + fold (a commutative monoid after quiescence) is order-independent', async () => {
	const g1 = await boot(sumTree, sumSeed, { Red }, 'order-AB');
	await push(g1, { $$_id: 'hub', obs: { __push: { v: 3 } } }, 'hub');
	await push(g1, { $$_id: 'hub', obs: { __push: { v: 5 } } }, 'hub');
	const g2 = await boot(sumTree, sumSeed, { Red }, 'order-BA');
	await push(g2, { $$_id: 'hub', obs: { __push: { v: 5 } } }, 'hub');
	await push(g2, { $$_id: 'hub', obs: { __push: { v: 3 } } }, 'hub');
	assert.equal(fact(g1, 'hub', 'total'), 8);
	assert.equal(fact(g2, 'hub', 'total'), 8); // same fixpoint regardless of push order
});

test('WHY: a commutative fold is order-free; a value-dependent (non-associative) op is not', () => {
	const sum = (a, b) => a + b;            // commutative monoid -> order-free
	const acc = (a, b) => 2 * a + b;        // reads the running value (read-modify-write) -> order-DEPENDENT
	assert.equal([3, 5].reduce(sum, 0), [5, 3].reduce(sum, 0));        // 8 == 8
	assert.notEqual([3, 5].reduce(acc, 0), [5, 3].reduce(acc, 0));     // 11 != 13 -> why in-stream value-dependent ops break order-independence
});

// (b) matrix as value works; raw-matrix gate fragments the memo, snapped scalar is stable ----
const mtxTree = { childConcepts: {
	RawGate: { _id: 'RawGate', _name: 'RawGate', require: ['mtx'], applyMutations: [{ $_id: '_parent', RawGate: true }] },
	SnapGate: { _id: 'SnapGate', _name: 'SnapGate', require: ['mtxBand'], applyMutations: [{ $_id: '_parent', SnapGate: true }] },
} };
const mtxSeed = { lastRev: 0, nodes: [{ _id: 'm', mtx: [[1, 2], [3, 4]], mtxBand: 'low' }], segments: [] };

test('a matrix is a valid fact value; gating on it raw fragments the memo, snapped is stable (K1)', async () => {
	const g = await boot(mtxTree, mtxSeed, null, 'mtx');
	assert.deepEqual(fact(g, 'm', 'mtx'), [[1, 2], [3, 4]]); // matrix stored & readable as a value
	const before = memoSnapshot(g, ['RawGate', 'SnapGate']);
	// a sub-threshold change to the matrix that does NOT move the snapped band
	await push(g, { $$_id: 'm', mtx: [[1, 2], [3, 5]] }, 'm');
	const d = memoDiff(before, memoSnapshot(g, ['RawGate', 'SnapGate']));
	assert.ok(d.changed.some((c) => /RawGate/.test(c.key)), 'the raw-matrix gate must fragment');
	assert.ok(!d.changed.some((c) => /SnapGate/.test(c.key)), 'the snapped-band gate must stay stable');
});
