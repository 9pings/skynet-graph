'use strict';
/**
 * analogical — a Tier-0 strategy plugin on reason-kernel (the jasperan catalog, design §9.2 #9),
 * THE client that grew the kernel's generic `Relation` brick (§9.5: a brick lands only when a real
 * client demands it). Structural, 0-model: maps-to admission, the grounded transfer license, and —
 * the selling point — the DEFEASIBLE cascade (retract the source → the license uncasts, the
 * retraction APPENDED to the ledger: the C9 JTMS, reused verbatim).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

const AN_DIR = path.join(__dirname, '..', '..', 'plugins', 'analogical');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('analogical graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

function boot(nodes) {
	const an = definePlugin(AN_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([an]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [{ _id: 'ledger', grounded: [], groundedRetracted: [] }], nodes, segments: [] },
		{ label: 'analogical-test', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	return g;
}
const src = ( o ) => Object.assign({ _id: 'src', isThought: true, live: true, resolved: true, text: 's' }, o);
const mapping = ( relKind ) => ({ _id: 'm1', isRelation: true, relKind: relKind || 'maps-to', from: 'src', to: 'tgt' });

test('resolves reason-kernel first; the kernel Relation brick is load-bearing (this client grew it)', () => {
	const cfg = resolvePlugins([definePlugin(AN_DIR, [loadPlugin(RK_DIR)])]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'analogical']);
	assert.ok(cfg.conceptMap.kernel.childConcepts.Relation, 'Relation lives in the kernel set');
});

test('a maps-to Relation over a live+resolved source GROUNDS: the transfer license casts + tallies', async () => {
	const g = boot([src(), { _id: 'tgt', isThought: true, text: 't' }, mapping()]);
	await settle(g);
	assert.equal(cast(g, 'm1', 'Mapping'), true, 'maps-to routed into Mapping');
	assert.equal(cast(g, 'm1', 'Grounded'), true, 'live + resolved source → the transfer license');
	assert.deepEqual(fact(g, 'ledger', 'grounded'), ['m1'], 'audited on the kernel ledger');
});

test('THE DEFEASIBLE CASCADE — retracting the source uncasts the license and APPENDS the retraction', async () => {
	const g = boot([src(), { _id: 'tgt', isThought: true, text: 't' }, mapping()]);
	await settle(g);
	assert.equal(cast(g, 'm1', 'Grounded'), true, 'precondition: grounded');
	// the source case is retracted (an erratum / a drifted fact) — the analogy must fall WITH it
	await new Promise((res) => g.ingest({ src: { live: false } }, res));
	await settle(g);
	assert.equal(cast(g, 'm1', 'Grounded'), false, 'the transfer license uncast in cascade (hop-watcher)');
	assert.deepEqual(fact(g, 'ledger', 'groundedRetracted'), ['m1'], 'the retraction APPENDED — the audit keeps the history');
	const active = fact(g, 'ledger', 'grounded').length - fact(g, 'ledger', 'groundedRetracted').length;
	assert.equal(active, 0, 'active analogies fell to 0 — defeasance, not deletion');
});

test('NEG — an unresolved source never licenses a transfer; a non-maps-to relation never maps', async () => {
	const g = boot([src({ resolved: null }), { _id: 'tgt', isThought: true, text: 't' }, mapping(),
		{ _id: 'm2', isRelation: true, relKind: 'attack', from: 'src', to: 'tgt' }]);
	await settle(g);
	assert.equal(cast(g, 'm1', 'Grounded'), false, 'source not resolved → no license (never faked)');
	assert.equal(cast(g, 'm2', 'Mapping'), false, 'relKind attack → not an analogy (the enum routes)');
	assert.deepEqual(fact(g, 'ledger', 'grounded'), [], 'nothing tallied');
});

test('re-run determinism (ground → retract → audit)', async () => {
	const run = async () => {
		const g = boot([src(), { _id: 'tgt', isThought: true, text: 't' }, mapping()]);
		await settle(g);
		await new Promise((res) => g.ingest({ src: { live: false } }, res));
		await settle(g);
		return JSON.stringify([fact(g, 'ledger', 'grounded'), fact(g, 'ledger', 'groundedRetracted')]);
	};
	assert.equal(await run(), await run());
});
