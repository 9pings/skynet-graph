'use strict';
/**
 * refine-delegate (roadmap P5) — AFFINER sans casser le contrat. The shared instance's BODY is refined behind the
 * fixed key (a different implementation / an added internal step / a swapped regime), while the caller's cast-conditions
 * + Σ_sep — the INTERFACE — stay fixed. "Le délégué évolue, l'interface reste." Proven two ways: (1) a pool-backed
 * proxy is byte-invariant across a body swap; (2) reviseOnBlame narrows the delegate's applicability without changing
 * what the caller keys on (the write-footprint / Σ_sep). ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { makeSegmentProxy } = require('../../lib/authoring/segment-proxy.js');
const { reviseOnBlame, satisfies } = require('../../lib/authoring/contract.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

// delegate v1 — Hot straight from temp (rule: temp >= 100).
const V1 = { common: { childConcepts: {
	Hot: { _id: 'Hot', _name: 'Hot', require: ['Segment'], ensure: ['$originNode:temp >= 100'] },
} } };
// delegate v2 — a DIFFERENT rule (temp > 99), SAME Σ_sep output {Hot} and the same write-footprint [Hot]: a
// within-contract refinement the caller cannot observe.
const V2 = { common: { childConcepts: {
	Hot: { _id: 'Hot', _name: 'Hot', require: ['Segment'], ensure: ['$originNode:temp > 99'] },
} } };
// delegate v_over — a refinement that OVER-WRITES the boundedFrom object (internal Warmup/Scratch land on `s`): the
// write-footprint gains undeclared keys → the P4 G1 gate must REFUSE it (the interface is protected from a bad refine).
const V_OVER = { common: { childConcepts: {
	Warmup:  { _id: 'Warmup',  _name: 'Warmup',  require: ['Segment'], ensure: ['$originNode:temp >= 100'] },
	Hot:     { _id: 'Hot',     _name: 'Hot',     require: ['Segment', 'Warmup'] },
	Scratch: { _id: 'Scratch', _name: 'Scratch', require: ['Segment'], ensure: ['$originNode:temp >= 0'] },
} } };
const CONF = ( l ) => ({ label: l, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' });
const factsOf = ( g, id ) => { const o = g._objById[id]; return (o && o._etty && o._etty._) || {}; };

const castHelper = ( proxy ) => async ( temp ) => {                    // provider set ONCE by the caller (avoids a per-cast global race)
	const tree = { common: { childConcepts: Object.assign({ Alert: { _id: 'Alert', _name: 'Alert', require: ['Segment'], ensure: ['$Hot == true'] } }, proxy.conceptFragment) } };
	const g = new Graph({ lastRev: 0, nodes: [{ _id: 'a', Node: true }, { _id: 'b', Node: true }],
		segments: [{ _id: 'task', Segment: true, Task: true, temp: temp, originNode: 'a', targetNode: 'b' }] }, CONF('c'), tree);
	await nextStable(g);
	return factsOf(g, 'task');
};

test('BODY SWAP — a pool-backed proxy is byte-invariant across a delegate refine (interface stays)', async () => {
	const pool = Graph.createInvokePool();
	const proxy = makeSegmentProxy({ name: 'HotProxy', libraryKey: 'k', pool, castWhen: ['Task'],
		contract: { write: ['Hot'], post: ['$Hot == true'] }, methodMap: V1,
		buildSeed: ( scope ) => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, temp: scope._.temp }, { _id: 'OUT', Node: true }],
			segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] }), boundedFrom: 's', boundedKeys: ['Hot'] });
	const cast = castHelper(proxy);
	const saved = Graph._providers; Graph._providers = Object.assign({}, saved, proxy.provider);
	try {
		const before = await cast(120);
		assert.equal(before.HotProxy, true); assert.equal(before.Hot, true); assert.equal(before.Alert, true);

		await pool.refine('k', { conceptMap: V2 });                     // the shared instance's BODY is swapped v1 → v2
		const after = await cast(120);

		assert.equal(after.Hot, true); assert.equal(after.Alert, true);
		assert.deepEqual({ HotProxy: after.HotProxy, Hot: after.Hot, Alert: after.Alert },
			{ HotProxy: before.HotProxy, Hot: before.Hot, Alert: before.Alert }, 'caller-visible result is byte-identical across the refine (rule v1→v2)');
		assert.equal(pool.size(), 1, 'still ONE instance behind the key — refined in place, not a new interface');
	} finally { Graph._providers = saved; await pool.close(); }
});

test('INTERFACE PROTECTED — an OVER-WRITING refinement is refused by the P4 G1 gate (bad body cannot corrupt the caller)', async () => {
	const pool = Graph.createInvokePool();
	const proxy = makeSegmentProxy({ name: 'HotProxy', libraryKey: 'k', pool, castWhen: ['Task'],
		contract: { write: ['Hot'], post: ['$Hot == true'] }, methodMap: V1,
		buildSeed: ( scope ) => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, temp: scope._.temp }, { _id: 'OUT', Node: true }],
			segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] }), boundedFrom: 's', boundedKeys: ['Hot', 'Warmup', 'Scratch'] });
	const cast = castHelper(proxy);
	const saved = Graph._providers; Graph._providers = Object.assign({}, saved, proxy.provider);
	try {
		assert.equal((await cast(120)).Hot, true, 'v1 admits');
		await pool.refine('k', { conceptMap: V_OVER });                 // swap to a body that writes undeclared keys onto s
		const after = await cast(120);
		assert.equal(after.proxyRefused, 'undeclared-write', 'the G1 gate refuses the over-writing refinement');
		assert.ok(!('Warmup' in after) && !('Scratch' in after) && after.Hot !== true, 'none of the bad body\'s writes crossed — the interface is protected');
	} finally { Graph._providers = saved; await pool.close(); }
});

test('reviseOnBlame — the delegate NARROWS on blame while the interface (write / Σ_sep) is preserved', () => {
	const contract = { read: ['region'], write: ['approved'], pre: ['$region in [EU, US]'], post: ['$approved == true'], effect: 'internal' };
	// P4 blamed a US case (the induced post over-generalized) → specialize the pre with the discriminator.
	const refined = reviseOnBlame(contract, { key: 'region', value: 'US' });

	assert.deepEqual(refined.write, contract.write, 'the WRITE (Σ_sep — what the caller keys on) is UNCHANGED — the interface holds');
	assert.equal(satisfies(refined.pre, { region: 'US' }), false, 'the refined delegate no longer claims the failing case');
	assert.equal(satisfies(refined.pre, { region: 'EU' }), true, 'but still covers the case it was right about');
	assert.notDeepEqual(refined.pre, contract.pre, 'the BODY/applicability narrowed (the pre gained the nogood) — the delegate evolved');
});
