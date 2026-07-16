'use strict';
/**
 * Semiring reducer on the real engine (experiment E1). Contributions are {__push}ed into a
 * pool; a Semiring::reduce concept folds them after the cardinality gate. logodds reproduces
 * E1's κ=σ(Σw); the SAME machine with the boolean semiring is the D-socle "any holds".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createSemiring, semiringConceptTree } = require('../../lib/providers');

console.log = console.info = console.warn = () => {};

// each source pushes its weight into the shared pool array (race-free {__push})
const pushProv = { Src: { push(graph, concept, scope, argz, cb) {
	cb(null, [{ $_id: '_parent', Contrib: true }, { $$_id: 'pool', contribs: { __push: scope._.w } }]);
} } };
Graph._providers = Object.assign({}, Graph._providers, createSemiring(), pushProv);

const cfg = { label: 'semiring', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

function tree(semiring) {
	return { common: { childConcepts: {
		Contrib: { _id: 'Contrib', _name: 'Contrib', require: ['src'], provider: ['Src::push'] },
		PoolRoot: { _id: 'PoolRoot', _name: 'PoolRoot', require: ['PoolRoot'],
			childConcepts: semiringConceptTree({ semiring, require: ['PoolRoot'] }).childConcepts }
	} } };
}

async function run(semiring, weights) {
	const seed = { lastRev: 0, nodes: [{ _id: 'pool', PoolRoot: true, expected: weights.length, contribs: [] }]
		.concat(weights.map((w, i) => ({ _id: 's' + i, src: true, w }))), segments: [] };
	const g = new Graph(seed, cfg, tree(semiring));
	await nextStable(g);
	return g._objById['pool']._etty._;
}

test('logodds (P): folds {__push}ed contributions to κ=σ(Σw) — reproduces E1', async () => {
	const pool = await run('logodds', [0.5, 0.3]);
	assert.equal(pool.Reduce, true, 'Reduce cast after the cardinality gate');
	assert.equal(pool.acc, 0.8, 'Σ⊕ in log-odds');
	assert.ok(Math.abs(pool.value - 1 / (1 + Math.exp(-0.8))) < 1e-9, 'readout σ(0.8)=0.6899…');
	assert.equal(pool.n, 2);
});

test('boolean (D socle): the SAME machine folds to "any holds"', async () => {
	const anyTrue = await run('boolean', [false, true, false]);
	assert.equal(anyTrue.value, true);
	const noneTrue = await run('boolean', [false, false]);
	assert.equal(noneTrue.value, false);
});
