'use strict';
/**
 * §6.4 WIDEN on the REAL ENGINE — the S-boundary climb patched into a live `ensure` gate. A method gated on an
 * OVER-SPECIFIC region allow (+ a `!=` blame nogood) rejects a US segment; ≥k verified positives → `widenOnVerified`
 * → `patchConcept` the engine gate → US now casts NATIVELY (the amortisation, no re-forge), while the MX blame nogood
 * stays excluded (never crosses G). The widen's membership is a parenthesized `==` DISJUNCTION (the engine's `expr.js`
 * does NOT support `in [..]`; `||`/`==` compile) — so the same operator output drives both `satisfies` and the live gate.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { widenOnVerified, satisfies } = require('../../lib/authoring/contract.js');
console.log = console.info = console.warn = () => {};

const App = { serve: function ( g, c, scope, argz, cb ) { cb(null, { $_id: '_parent', Serve: true, Served: true }); } };
const TREE = { common: { childConcepts: {
	// gated on an OVER-SPECIFIC allow (region==EU) + a `!=` blame nogood (MX was retracted earlier).
	Serve: { _id: 'Serve', _name: 'Serve', require: ['Segment', 'region'], ensure: ["$region=='EU'", "$region!='MX'"], provider: ['App::serve'] },
} } };
const seg = ( id, region ) => ({ _id: id, originNode: id + 'o', targetNode: id + 't', region });
const nodesFor = ( ids ) => ids.reduce(( acc, id ) => acc.concat([{ _id: id + 'o' }, { _id: id + 't' }]), []);

test('§6.4 widen on the engine — a widened gate lets a previously-rejected region cast natively; the blame nogood stays excluded', async () => {
	Graph._providers = { App };
	const ids = ['E_eu', 'E_us', 'E_mx'];
	const seed = { lastRev: 0, nodes: nodesFor(ids), segments: [seg('E_eu', 'EU'), seg('E_us', 'US'), seg('E_mx', 'MX')] };
	const g = new Graph(seed, { label: 'widen', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, TREE);
	await nextStable(g);

	// baseline: ONLY EU casts — US rejected by the over-specific gate (the §6.4 gap), MX by both.
	assert.equal(g._objById['E_eu']._etty._.Served, true, 'EU casts (inside the over-specific allow)');
	assert.ok(!g._objById['E_us']._etty._.Served, 'US does NOT cast (the over-specific gate rejects it — the gap widen closes)');
	assert.ok(!g._objById['E_mx']._etty._.Served, 'MX does NOT cast');

	// WIDEN — ≥k verified positives for US (the SAME method) → widenOnVerified → patch the live gate.
	const base = g.getConceptByName('Serve');
	const contract = { read: ['region'], pre: base._schema.ensure.slice(), effect: 'pure' };
	const out = widenOnVerified(contract, [{ value: 'US', methodId: 'Serve' }, { value: 'US', methodId: 'Serve' }], { discriminator: 'region', target: 'Serve' });
	assert.ok(!satisfies(out.ensure, { region: 'MX' }), 'the widened gate STILL excludes MX (never crosses G) — before we even patch');
	g.patchConcept('Serve', { ensure: out.ensure });
	await nextStable(g);

	// US now casts NATIVELY (the S-climb amortises — no re-forge); MX still never; EU unchanged.
	assert.equal(g._objById['E_us']._etty._.Served, true, 'US now casts natively after the widen (the gate admits it — amortisation)');
	assert.ok(!g._objById['E_mx']._etty._.Served, 'MX STILL does not cast — the blame nogood is preserved through the widen (never crosses G)');
	assert.equal(g._objById['E_eu']._etty._.Served, true, 'EU still casts (no regression)');
	assert.ok(g.getRevisions().length < 50, 'bounded (no apply-cap runaway)');
});

test('§6.4 NEG (engine) — a cross-method positive does NOT widen the gate (no borrowing evidence across a contract)', async () => {
	Graph._providers = { App };
	const seed = { lastRev: 0, nodes: nodesFor(['E_us']), segments: [seg('E_us', 'US')] };
	const g = new Graph(seed, { label: 'widen2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, TREE);
	await nextStable(g);
	const base = g.getConceptByName('Serve');
	const contract = { read: ['region'], pre: base._schema.ensure.slice(), effect: 'pure' };
	// a positive recorded against a DIFFERENT method (a §6.2 M_new) — must be rejected, gate unchanged.
	const out = widenOnVerified(contract, [{ value: 'US', methodId: 'M_new' }], { discriminator: 'region', target: 'Serve' });
	assert.ok(!satisfies(out.ensure, { region: 'US' }), 'a cross-method positive does not widen Serve to admit US');
	g.patchConcept('Serve', { ensure: out.ensure });
	await nextStable(g);
	assert.ok(!g._objById['E_us']._etty._.Served, 'US still does NOT cast — no borrowing evidence across a contract boundary');
});
