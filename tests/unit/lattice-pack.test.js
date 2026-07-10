'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { packLattice, unpackLattice, loadLattice, deriveLatticeSchema, ringsOf } = require('../../lib/authoring/lattice-pack');
const { deriveRegistry, freezeRegistry, mergeRingProposals } = require('../../lib/authoring/registry');

// a small tree with a typed enum interface key + a curated ring (the registry LIVES here).
function shipTree() {
	return { childConcepts: {
		Ship: { _id: 'Ship', _name: 'Ship', require: ['$status'], ensure: ['$status=="delivered"'],
			prompt: { facts: { status: { enum: ['intransit', 'delivered'], synonyms: { delivered: ['arrived'] } } }, prose: 's' } },
		Emit: { _id: 'Emit', _name: 'Emit', applyMutations: { $_id: '_parent', status: 'intransit' } } } };
}

test('packLattice → unpackLattice round-trips the registry + derives a self-describing schema', () => {
	const reg = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	const bundle = packLattice(reg, { name: 'isa', version: 'v1', description: 'd' });
	assert.equal(bundle.format, 'sgc');
	assert.equal(bundle.kind, 'lattice');
	assert.equal(bundle.manifest.name, 'isa');
	assert.equal(bundle.manifest.version, 'v1');
	assert.equal(bundle.manifest.frozen, true);
	const u = unpackLattice(bundle, { hostVersion: 'v1' });
	assert.deepEqual(u.registry, reg, 'the registry survives the round-trip byte-for-byte');
	assert.equal(u.loadSafe, true, 'same version ⇒ load-safe');
	assert.equal(u.manifest.schema.enumKeys.includes('status'), true);
	assert.equal(u.manifest.schema.ringAliases >= 1, true, 'the curated ring is counted');
});

test('packLattice defaults the version to the registry own stamp', () => {
	const reg = freezeRegistry(deriveRegistry(shipTree()), 'v7');
	assert.equal(packLattice(reg).manifest.version, 'v7');
});

test('loadLattice ADOPTS the packaged registry wholesale when there is no host canon (version-safe)', () => {
	const reg = freezeRegistry(deriveRegistry(shipTree()), 'v1');
	const bundle = packLattice(reg, { version: 'v1' });
	const r = loadLattice(bundle, null, { version: 'v1' });
	assert.equal(r.adopted, true);
	assert.equal(r.merged, false);
	assert.deepEqual(r.registry.keys.status.synonyms, { delivered: ['arrived'] }, 'the adopted canon carries its rings');
});

test('loadLattice GROWS a host through the confluence gate — admit a clean alias, REJECT a conflicting one', () => {
	// host: status.delivered ring = ['arrived']
	const host = deriveRegistry(shipTree());
	host.version = 'v1';
	// packaged canon ships two aliases: delivered←"shipped" (clean) and intransit←"arrived" (conflicts with host's
	// arrived→delivered — a critical pair) — a hand-crafted registry to exercise both branches of the gate.
	const packed = packLattice({ version: 'v1', keys: { status: { tier: 1, enum: ['intransit', 'delivered'],
		synonyms: { delivered: ['shipped'], intransit: ['arrived'] } } } }, { name: 'isa', version: 'v1' });
	const r = loadLattice(packed, host, { version: 'v1' });
	assert.equal(r.merged, true);
	assert.equal(r.loadSafe, true);
	assert.equal(r.admitted.some(( p ) => p.member === 'delivered' && p.alias === 'shipped'), true, 'clean alias admitted');
	assert.equal(r.rejected.some(( p ) => p.member === 'intransit' && p.alias === 'arrived'), true, 'conflicting alias rejected');
	assert.match(r.rejected.find(( p ) => p.alias === 'arrived').reason, /confluence/, 'rejected for the critical-pair conflict');
	// the grown host now resolves "shipped" → delivered, and never mis-merged the conflicting "arrived"→intransit
	assert.deepEqual(r.registry.keys.status.synonyms.delivered.sort(), ['arrived', 'shipped']);
	assert.equal((r.registry.keys.status.synonyms.intransit || []).length, 0);
	// provenance tagged as loaded (auditable + retractable)
	assert.match(r.registry.ringProvenance['status::shipped'].via, /loaded:isa/);
});

test('loadLattice REFUSES on a version mismatch — grows nothing (the host re-learns)', () => {
	const packed = packLattice(freezeRegistry(deriveRegistry(shipTree()), 'v2'), { version: 'v2' });
	const host = deriveRegistry(shipTree()); host.version = 'v1';
	const r = loadLattice(packed, host, { version: 'v1' });
	assert.equal(r.loadSafe, false);
	assert.equal(r.merged, false);
	assert.equal(r.adopted, false);
	assert.equal(r.skipped >= 1, true, 'the shipped rings are skipped, not merged');
	assert.equal(r.registry, host, 'the host canon is returned untouched');
});

test('version pinning is opt-in — no versions declared ⇒ permissive load', () => {
	const packed = packLattice({ keys: { status: { enum: ['a', 'b'], synonyms: { a: ['aa'] } } } });   // no version
	const host = { keys: { status: { enum: ['a', 'b'] } } };                                            // no version
	const r = loadLattice(packed, host, {});
	assert.equal(r.loadSafe, true);
	assert.equal(r.merged, true);
	assert.equal(r.admitted.some(( p ) => p.alias === 'aa'), true);
});

test('unpackLattice / loadLattice reject a non-lattice bundle', () => {
	assert.throws(() => unpackLattice({ format: 'sgc', kind: 'methods' }), /not a \.sgc lattice bundle/);
	assert.throws(() => unpackLattice({ foo: 1 }), /not an \.sgc bundle/);
});

test('ringsOf + deriveLatticeSchema report the ring surface', () => {
	const reg = { keys: { k: { tier: 1, enum: ['x', 'y'], synonyms: { x: ['x1', 'x2'], y: ['y1'] } } } };
	assert.equal(ringsOf(reg).length, 3);
	const s = deriveLatticeSchema(reg);
	assert.equal(s.keyCount, 1); assert.equal(s.tier1Keys, 1); assert.equal(s.ringMembers, 2); assert.equal(s.ringAliases, 3);
});
