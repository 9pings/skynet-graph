'use strict';
/**
 * §6.4 — the STANDING / autonomous WIDEN loop on the real engine (no LLM). The reactive SIBLING of the narrow
 * un-learn loop (contract-relearn.test.js): the ENGINE drives ≥k verified positives → widen as reactive concepts.
 * A `Widen` meta-concept (`require:['widenReady']`) fires on the accumulated signal and `Lib::widen` widens BOTH the
 * library contract (`widenOnVerified`, additive enum-union) AND the engine gate (queued `patchConcept`, #11.a), with
 * `recordWiden` demoting FROZEN→INSTANCE BEFORE the gate-relax (the G2 ordering) — autonomously, NO host widen call.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { makeWidenProviders, widenTree } = require('../../lib/authoring/widen.js');
const { createMountController } = require('../../lib/authoring/mount.js');
const { satisfies } = require('../../lib/authoring/contract.js');
console.log = console.info = console.warn = () => {};

const App = { serve: function ( g, c, scope, argz, cb ) { cb(null, { $_id: '_parent', Serve: true, Served: true }); } };
const seg = ( id, region ) => ({ _id: id, originNode: id + 'o', targetNode: id + 't', region });
const nodesFor = ( ids ) => ids.reduce(( a, id ) => a.concat([{ _id: id + 'o' }, { _id: id + 't' }]), []);

// run the stream: an over-specific Serve (region==EU) + a US segment that initially does NOT cast; lib:Serve carries
// ≥k verified US positives + the `widenReady` trigger. With the loop ON, the engine widens the gate → US casts.
async function runWiden( opts ) {
	opts = opts || {};
	const registry = { Serve: { read: ['region'], pre: ["$region=='EU'"], effect: 'pure' } };
	const mount = opts.mount;
	const childConcepts = Object.assign({
		Serve: { _id: 'Serve', _name: 'Serve', require: ['Segment', 'region'], ensure: ["$region=='EU'"], provider: ['App::serve'] },
	}, opts.loopOn ? widenTree().childConcepts : {});
	Graph._providers = Object.assign({ App }, opts.loopOn ? makeWidenProviders({ registry, mount }) : {});

	const libNode = { _id: 'lib:Serve', method: 'Serve', discriminator: 'region',
		positives: [{ value: 'US', methodId: 'Serve' }, { value: 'US', methodId: 'Serve' }, { value: 'US', methodId: 'Serve' }] };
	if ( opts.loopOn ) libNode.widenReady = true;          // the upstream ≥k-positives signal (deposited like `blamed`)
	const seed = { lastRev: 0, nodes: nodesFor(['E_eu', 'E_us']).concat([libNode]), segments: [seg('E_eu', 'EU'), seg('E_us', 'US')] };
	const g = new Graph(seed, { label: 'widen', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: { childConcepts } });
	await nextStable(g);
	return { g, registry, after: {
		euServed: !!(g._objById['E_eu'] && g._objById['E_eu']._etty._.Served),
		usServed: !!(g._objById['E_us'] && g._objById['E_us']._etty._.Served),
		widened: !!(g._objById['lib:Serve'] && g._objById['lib:Serve']._etty._.widened),
		ensure: (g.getConceptByName('Serve')._schema.ensure || []).slice(),
		divergent: (g._objById['lib:Serve'] && g._objById['lib:Serve']._etty._.divergent) || null,
	} };
}

test('§6.4 autonomy: the engine ALONE widens the gate on ≥k positives (no host widen call); US now casts, EU preserved', async () => {
	const r = await runWiden({ loopOn: true });
	assert.equal(r.after.euServed, true, 'EU still casts (no regression)');
	assert.equal(r.after.usServed, true, 'US now casts — the engine autonomously WIDENED the gate to admit it');
	assert.equal(r.after.widened, true, 'the Widen meta-concept cast (widened guard set)');
	assert.ok(satisfies(r.after.ensure, { region: 'US' }) && satisfies(r.after.ensure, { region: 'EU' }), 'the widened gate admits EU∪US');
	assert.equal(r.after.divergent, null, 'no divergence (the `widened` guard stops the loop — converged, not apply-capped)');
	assert.deepEqual(r.registry.Serve.pre.filter(( a ) => /region/.test(a)).length > 0, true, 'the library contract pre was widened (widenOnVerified)');
});

test('§6.4 neg control: WITHOUT the reactive loop the over-specific gate STAYS narrow — US never casts', async () => {
	const off = await runWiden({ loopOn: false });
	assert.equal(off.after.euServed, true, 'OFF: EU still casts');
	assert.equal(off.after.usServed, false, 'OFF: the un-widened gate REJECTS US (the §6.4 gap — no autonomous widen)');
	assert.deepEqual(off.after.ensure, ["$region=='EU'"], 'OFF: the gate was never widened');
});

test('§6.4 G2 ordering: recordWiden DEMOTES a FROZEN method to INSTANCE before the gate-relax (assertPost re-guards)', async () => {
	const mount = createMountController();
	mount.decide('Serve', { reliability: 0.9, hitRate: 0.95, depth: 1, readOnlyFrontier: true });   // → frozen
	assert.equal(mount.regimeOf('Serve'), 'frozen', 'precondition: Serve is FROZEN (assertPost elided)');
	const muBefore = mount.deoptBudget('Serve');
	await runWiden({ loopOn: true, mount });
	assert.equal(mount.regimeOf('Serve'), 'instance', 'the widen demoted FROZEN→INSTANCE (the newly-admitted US case re-hits assertPost)');
	assert.equal(mount.deoptBudget('Serve'), muBefore, 'and it did NOT consume the deopt budget μ (a widen is a success, not a deopt)');
});
