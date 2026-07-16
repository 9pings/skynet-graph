'use strict';
// (ii) — the learning-library combo ships the grown typed LATTICE alongside the methods (owner Q#2 wired
// into the combo). Thin pass-throughs to lattice-pack; the combo HOLDS a host-supplied/host-grown registry.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const { createLearningLibrary } = require('../../plugins/learning/combo.js');
const Graph = { combos: { createLearningLibrary } };

const forge = async () => ({ result: 42, cost: 1 });
const REG = () => ({ version: 'v1', keys: { status: { tier: 1, enum: ['intransit', 'delivered'], synonyms: { delivered: ['arrived'] } } } });

test('combo.registry() — null by default, returns the supplied canon', () => {
	assert.equal(Graph.combos.createLearningLibrary({ forge }).registry(), null);
	const lib = Graph.combos.createLearningLibrary({ forge, registry: REG() });
	assert.deepEqual(lib.registry().keys.status.enum, ['intransit', 'delivered']);
});

test('combo.packLattice() — packs the held canon into a .sgc kind:lattice bundle', () => {
	const lib = Graph.combos.createLearningLibrary({ forge, registry: REG() });
	const b = lib.packLattice({ name: 'isa', version: 'v1' });
	assert.equal(b.format, 'sgc');
	assert.equal(b.kind, 'lattice');
	assert.deepEqual(b.registry.keys.status.synonyms, { delivered: ['arrived'] });
});

test('combo.loadLattice() — ADOPTS into an empty combo, then the canon is held + re-packable', () => {
	const src = Graph.combos.createLearningLibrary({ forge, registry: REG() });
	const dst = Graph.combos.createLearningLibrary({ forge });   // no registry
	assert.equal(dst.registry(), null);
	const r = dst.loadLattice(src.packLattice({ version: 'v1' }), { version: 'v1' });
	assert.equal(r.adopted, true);
	assert.deepEqual(dst.registry().keys.status.synonyms, { delivered: ['arrived'] }, 'the adopted canon is now held');
});

test('combo.loadLattice() — GROWS a held canon through the gate (admit clean, reject conflicting)', () => {
	const dst = Graph.combos.createLearningLibrary({ forge, registry: REG() });
	// ship a clean alias (delivered←"shipped") and a conflicting one (intransit←"arrived", host has arrived→delivered)
	const packed = { format: 'sgc', sgcVersion: 1, kind: 'lattice', manifest: { name: 'isa', version: 'v1', schema: {} },
		registry: { version: 'v1', keys: { status: { tier: 1, enum: ['intransit', 'delivered'], synonyms: { delivered: ['shipped'], intransit: ['arrived'] } } } } };
	const r = dst.loadLattice(packed, { version: 'v1' });
	assert.equal(r.merged, true);
	assert.equal(r.admitted.some(( p ) => p.alias === 'shipped'), true);
	assert.equal(r.rejected.some(( p ) => p.alias === 'arrived'), true);
	assert.deepEqual(dst.registry().keys.status.synonyms.delivered.sort(), ['arrived', 'shipped']);
});

test('combo.loadLattice() — version mismatch grows nothing (held canon untouched)', () => {
	const dst = Graph.combos.createLearningLibrary({ forge, registry: REG() });
	const before = JSON.stringify(dst.registry());
	const packed = { format: 'sgc', sgcVersion: 1, kind: 'lattice', manifest: { name: 'isa', version: 'v9', schema: {} },
		registry: { version: 'v9', keys: { status: { enum: ['intransit', 'delivered'], synonyms: { delivered: ['shipped'] } } } } };
	const r = dst.loadLattice(packed, { version: 'v1' });
	assert.equal(r.loadSafe, false);
	assert.equal(r.merged, false);
	assert.equal(JSON.stringify(dst.registry()), before, 'the held canon is untouched on a version mismatch');
});

test('combo.packAll()/loadAll() — ship BOTH methods and lattice in one envelope', () => {
	const src = Graph.combos.createLearningLibrary({ forge, registry: REG() });
	const all = src.packAll({ name: 'lib', version: 'v1' });
	assert.equal(all.methods.kind, 'methods');
	assert.equal(all.lattice.kind, 'lattice');
	const dst = Graph.combos.createLearningLibrary({ forge });
	const r = dst.loadAll(all, { version: 'v1' });
	assert.equal(r.methods.exactReplaySafe, true);
	assert.equal(r.lattice.adopted, true);
	assert.deepEqual(dst.registry().keys.status.enum, ['intransit', 'delivered'], 'the lattice arrived via loadAll');
});

test('combo.packAll() — lattice is null when no registry is held (methods still ship)', () => {
	const all = Graph.combos.createLearningLibrary({ forge }).packAll({ version: 'v1' });
	assert.equal(all.methods.kind, 'methods');
	assert.equal(all.lattice, null);
});
