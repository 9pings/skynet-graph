'use strict';
/**
 * Plugin resolver (`lib/plugins/resolve.js`) — the one genuinely-new piece of the plugin architecture
 * (design: `WIP/2026-07-16-design-plugin-architecture.md`). Everything else (conceptSets+dmerge,
 * loadConceptMap, register, deriveManifest, grammar-graph collisions, .sgc pack) already exists; the
 * resolver is the thin layer that topo-orders dependencies, checks semver + namespace claims, and merges
 * the resolved plugins into a bootable graph config (conceptMap + conceptSets + providers).
 *
 * A plugin object: { name, version, concepts:{setName:tree}, providers:{ns:fragment},
 *   providerNamespaces:[ns], deps:[{name,range}], combos:{name:factory} }.
 * Concept trees are pre-built (buildConceptTree) so the resolver stays fs-free / pure.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolvePlugins } = require('../../lib/plugins/resolve.js');
const Graph = require('../../lib/graph/index.js');
const { buildConceptTree } = require('../../lib/authoring/concepts');
const { nextStable } = require('../../lib/authoring/supervise.js');

const P = (name, over) => Object.assign(
	{ name, version: '1.0.0', concepts: {}, providers: {}, providerNamespaces: [], deps: [] }, over);

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

test('topo-orders dependencies before dependents and merges concept-sets + providers', () => {
	const kernel = P('reason-kernel', {
		concepts: { rk: { childConcepts: { Thought: { _name: 'Thought' } } } },
	});
	const client = P('critical-mind', {
		version: '0.1.0',
		concepts: { dialectic: { childConcepts: { Statement: { _name: 'Statement', require: 'Thought' } } } },
		providers: { Dialectic: { tally() {}, untally() {} } },
		providerNamespaces: ['Dialectic'],
		deps: [{ name: 'reason-kernel', range: '^1.0.0' }],
	});
	const r = resolvePlugins([client, kernel]);          // input order deliberately reversed
	assert.deepEqual(r.order, ['reason-kernel', 'critical-mind'], 'the dependency resolves before its dependent');
	assert.deepEqual(Object.keys(r.conceptMap).sort(), ['dialectic', 'rk'], 'both concept-sets merged');
	assert.deepEqual(r.conceptSets, ['rk', 'dialectic'], 'conceptSets in topo order (kernel first)');
	assert.ok(r.providers.Dialectic && typeof r.providers.Dialectic.tally === 'function', 'Dialectic providers merged');
});

test('rejects two plugins claiming the same provider namespace (no extends)', () => {
	const a = P('a', { providerNamespaces: ['Vote'], providers: { Vote: { f() {} } } });
	const b = P('b', { providerNamespaces: ['Vote'], providers: { Vote: { g() {} } } });
	assert.throws(() => resolvePlugins([a, b]), /namespace/i, 'a double Vote claim is refused');
});

test('rejects a dependency whose version does not satisfy the declared range', () => {
	const kernel = P('reason-kernel', { version: '2.0.0' });
	const client = P('c', { version: '0.1.0', deps: [{ name: 'reason-kernel', range: '^1.0.0' }] });
	assert.throws(() => resolvePlugins([client, kernel]), /reason-kernel|version|satisf/i, 'a semver mismatch is refused');
});

test('detects a JS-init dependency cycle', () => {
	const a = P('a', { deps: [{ name: 'b', range: '*' }] });
	const b = P('b', { deps: [{ name: 'a', range: '*' }] });
	assert.throws(() => resolvePlugins([a, b]), /cycle/i, 'an init cycle is refused');
});

test('throws on an unresolved (missing) dependency', () => {
	const c = P('c', { deps: [{ name: 'ghost', range: '*' }] });
	assert.throws(() => resolvePlugins([c]), /unresolved dependency: ghost/i);
});

test('boots the REAL critical-mind plugin through the resolver — bit-identical to hand-wiring', async () => {
	const criticalMind = P('critical-mind', {
		version: '0.1.0',
		concepts: { dialectic: buildConceptTree(path.join(__dirname, '..', '..', 'concepts', '_dialectic')) },
		providers: require('../../lib/providers/dialectic.js'),   // { Dialectic: { tally, untally } }
		providerNamespaces: ['Dialectic'],
	});
	const cfg = resolvePlugins([criticalMind]);
	Graph._providers = cfg.providers;                            // the resolver output IS the host wiring
	const g = new Graph(
		{
			lastRev: 0,
			freeNodes: [{ _id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [] }],
			nodes: [
				{ _id: 'frame', isFrame: true, topic: 'is X good?', threshold: 1 },
				{ _id: 'p1', isStatement: true, side: 'PRO', text: 'because A', inPool: true },
				{ _id: 'V1', isViewpoint: true, side: 'PRO', text: 'X helps A', frame: 'frame', Explore: true, w0: 'p1' },
			],
			segments: [],
		},
		{ label: 'plugin-boot', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	await settle(g);
	assert.equal(cast(g, 'V1', 'ProEntry'), true, 'ProEntry casts through the resolver-wired plugin');
	assert.deepEqual(fact(g, 'ledger', 'pro'), ['V1'], 'ledger.pro tallied — identical to the hand-wired boot');
});
