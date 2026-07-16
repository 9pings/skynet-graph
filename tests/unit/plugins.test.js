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

const CRITICAL_MIND_DIR = path.join(__dirname, '..', '..', 'plugins', 'critical-mind');
const REASON_KERNEL_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

test('boots the REAL critical-mind plugin CARRYING its reason-kernel dep (flatten on a real object graph)', async () => {
	const { loadPlugin, definePlugin } = require('../../lib/plugins');
	// the npm shape: critical-mind carries its already-loaded reason-kernel dependency as an object
	const criticalMind = definePlugin(CRITICAL_MIND_DIR, [loadPlugin(REASON_KERNEL_DIR)]);
	assert.equal(criticalMind.name, 'critical-mind');
	assert.equal(criticalMind.pluginDeps[0].name, 'reason-kernel', 'the dep is carried as an object');
	const cfg = resolvePlugins([criticalMind]);                 // ONLY the top-level plugin — reason-kernel is flattened in
	assert.deepEqual(cfg.order, ['reason-kernel', 'critical-mind'], 'the carried kernel resolves first');
	assert.equal(typeof cfg.providers.Ledger.tally, 'function', 'Ledger providers merged FROM the kernel dep');
	Graph._providers = cfg.providers;                           // the resolver output IS the host wiring
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
	assert.equal(cast(g, 'V1', 'ProEntry'), true, 'ProEntry casts — the client concept found the KERNEL provider');
	assert.deepEqual(fact(g, 'ledger', 'pro'), ['V1'], "ledger.pro tallied via reason-kernel's Ledger::tally");
});

test('the critical-mind index.js auto-export CARRIES reason-kernel (definePlugin + dep, in-repo)', () => {
	const p = require('../../plugins/critical-mind');   // exercises the require(pkg)→relative fallback for BOTH host and dep
	assert.equal(p.name, 'critical-mind');
	assert.deepEqual(p.deps, [{ name: 'reason-kernel', range: '^0.1.0' }], 'declares the kernel dep');
	assert.equal(p.pluginDeps.length, 1, 'carries exactly one dep object');
	assert.equal(p.pluginDeps[0].name, 'reason-kernel', 'the carried object is reason-kernel (relative fallback resolved it)');
	assert.equal(typeof p.pluginDeps[0].providers.Ledger.tally, 'function', 'the kernel object carries its Ledger providers');
	assert.ok(p.concepts.dialectic, 'critical-mind still ships its dialectic grammar');
	assert.equal(typeof p.combos.createCriticalMind, 'function');
	// end-to-end: the auto-exported object resolves (flattens the carried kernel) with no extra wiring
	const cfg = resolvePlugins([p]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'critical-mind']);
});

test('reason-kernel index.js auto-export resolves in-repo (providers-only foundation plugin)', () => {
	const k = require('../../plugins/reason-kernel');
	assert.equal(k.name, 'reason-kernel');
	assert.deepEqual(k.pluginDeps, [], 'no deps');
	assert.deepEqual(Object.keys(k.concepts), [], 'providers-only (no concept sets yet)');
	assert.equal(typeof k.providers.Ledger.tally, 'function');
	assert.equal(typeof k.providers.Ledger.untally, 'function');
});

const FIX_MINI = path.join(__dirname, '..', 'fixtures', 'plugins', 'mini');

test('loadPlugin reads a plugin dir: manifest + concept sets + provider entrypoint', () => {
	const { loadPlugin } = require('../../lib/plugins');
	const p = loadPlugin(FIX_MINI);
	assert.equal(p.name, 'mini');
	assert.ok(p.concepts.mini && p.concepts.mini.childConcepts.Thing, 'built the `mini` concept set from concepts/mini/');
	assert.equal(typeof p.providers.Mini.tag, 'function', 'required the providers entrypoint');
	assert.deepEqual(p.providerNamespaces, ['Mini']);
});

test('loadPlugins → resolve → boot: a FILE-loaded plugin casts through its provider', async () => {
	const { loadPlugins } = require('../../lib/plugins');
	const cfg = loadPlugins([FIX_MINI]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: [{ _id: 't1', isThing: true }], segments: [] },
		{ label: 'plug', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	await settle(g);
	assert.equal(cast(g, 't1', 'Thing'), true, 'the concept cast');
	assert.equal(fact(g, 't1', 'tagged'), true, 'the Mini provider ran via the file-loaded plugin');
});

test('the facade exposes the plugin subsystem (Graph.plugins)', () => {
	const Facade = require('../../lib/index.js');
	assert.equal(typeof Facade.plugins.loadPlugins, 'function');
	assert.equal(typeof Facade.plugins.resolvePlugins, 'function');
	assert.equal(typeof Facade.plugins.loadPlugin, 'function');
	assert.equal(typeof Facade.plugins.definePlugin, 'function');
	assert.equal(typeof Facade.plugins.lintPluginDeps, 'function');
	assert.equal(typeof Facade.definePlugin, 'function', 'definePlugin also lives at the top of the facade (plugin authors: require("skynet-graph").definePlugin)');
});

// ─── The npm-distribution model (owner 07-16 quater): a plugin is a package whose index.js exports its
// plugin object via definePlugin(__dirname, [require(dep), …]); a dependent CARRIES its already-required
// deps as OBJECTS; resolvePlugins FLATTENS the object graph (never fetches). ───────────────────────────

const FIX_DEP = path.join(__dirname, '..', 'fixtures', 'plugins', 'mini-dep');
const FIX_BADLINT = path.join(__dirname, '..', 'fixtures', 'plugins', 'mini-badlint');

test('definePlugin(dir) with no deps ≡ loadPlugin shape + empty pluginDeps', () => {
	const { definePlugin, loadPlugin } = require('../../lib/plugins');
	const p = definePlugin(FIX_MINI);
	const l = loadPlugin(FIX_MINI);
	assert.equal(p.name, l.name);
	assert.deepEqual(Object.keys(p.concepts), Object.keys(l.concepts));
	assert.equal(typeof p.providers.Mini.tag, 'function');
	assert.deepEqual(p.pluginDeps, [], 'no deps → empty carried-object array');
});

test('definePlugin(dir, [depObj]) carries the already-required dep as an object', () => {
	const { definePlugin } = require('../../lib/plugins');
	const mini = definePlugin(FIX_MINI);
	const minidep = definePlugin(FIX_DEP, [mini]);
	assert.equal(minidep.name, 'minidep');
	assert.deepEqual(minidep.deps, [{ name: 'mini', range: '^1.0.0' }], 'declarations preserved');
	assert.equal(minidep.pluginDeps.length, 1);
	assert.equal(minidep.pluginDeps[0], mini, 'the carried object IS the passed one (no fetch)');
});

test('definePlugin rejects a declared dep with no object passed (the "forgot to require" bug)', () => {
	const { definePlugin } = require('../../lib/plugins');
	assert.throws(() => definePlugin(FIX_DEP, []), /mini/i, 'declared dep `mini` was not carried');
	assert.throws(() => definePlugin(FIX_DEP), /mini/i, 'omitting depObjects entirely also throws when deps are declared');
});

test('definePlugin rejects an object for a dep NOT declared in sg-plugin.deps', () => {
	const { definePlugin } = require('../../lib/plugins');
	const mini = definePlugin(FIX_MINI);                 // FIX_MINI declares deps: []
	const stray = Object.assign({}, mini, { name: 'stray' });
	assert.throws(() => definePlugin(FIX_MINI, [stray]), /stray|declared/i, 'an undeclared carried object is refused');
});

test('resolvePlugins FLATTENS a carried object graph: one top-level plugin, dep carried as object', () => {
	const kernel = P('reason-kernel', {
		concepts: { rk: { childConcepts: { Thought: { _name: 'Thought' } } } },
	});
	const client = P('critical-mind', {
		version: '0.1.0',
		concepts: { dialectic: { childConcepts: { Statement: { _name: 'Statement', require: 'Thought' } } } },
		providers: { Dialectic: { tally() {}, untally() {} } },
		providerNamespaces: ['Dialectic'],
		deps: [{ name: 'reason-kernel', range: '^1.0.0' }],
		pluginDeps: [kernel],                             // the npm shape: kernel carried, NOT a sibling
	});
	const r = resolvePlugins([client]);                   // ONLY the top-level plugin is passed
	assert.deepEqual(r.order, ['reason-kernel', 'critical-mind'], 'the carried dep is flattened + ordered first');
	assert.deepEqual(Object.keys(r.conceptMap).sort(), ['dialectic', 'rk'], 'both sets merged after flatten');
	assert.ok(r.providers.Dialectic && typeof r.providers.Dialectic.tally === 'function');
});

test('flatten dedups a shared kernel reached from two clients (no "duplicate plugin")', () => {
	const kernel = P('reason-kernel');
	const a = P('a', { deps: [{ name: 'reason-kernel', range: '^1.0.0' }], pluginDeps: [kernel] });
	const b = P('b', { deps: [{ name: 'reason-kernel', range: '^1.0.0' }], pluginDeps: [kernel] });
	const r = resolvePlugins([a, b]);
	assert.equal(r.order.filter((n) => n === 'reason-kernel').length, 1, 'kernel appears exactly once');
	assert.equal(r.order.indexOf('reason-kernel'), 0, 'kernel ordered before both dependents');
});

test('flatten refuses conflicting VERSIONS of the same carried plugin (no silent clobber)', () => {
	const k1 = P('reason-kernel', { version: '1.0.0' });
	const k2 = P('reason-kernel', { version: '2.0.0' });
	const a = P('a', { deps: [{ name: 'reason-kernel', range: '^1.0.0' }], pluginDeps: [k1] });
	const b = P('b', { deps: [{ name: 'reason-kernel', range: '^2.0.0' }], pluginDeps: [k2] });
	assert.throws(() => resolvePlugins([a, b]), /conflict|version|reason-kernel/i, 'two versions of one plugin is a hard error');
});

test('flatten is a no-op for the dev sibling path (backward-compatible)', () => {
	// The dev path passes all plugins as siblings with NO pluginDeps — flatten must not change anything.
	const kernel = P('reason-kernel');
	const client = P('c', { version: '0.1.0', deps: [{ name: 'reason-kernel', range: '^1.0.0' }] });
	const r = resolvePlugins([client, kernel]);
	assert.deepEqual(r.order, ['reason-kernel', 'c'], 'sibling deps still resolve exactly as before');
});

test('loadPlugins → resolve → boot a plugin that DEPENDS on another (mini-dep on mini)', async () => {
	const { loadPlugins } = require('../../lib/plugins');
	const cfg = loadPlugins([FIX_MINI, FIX_DEP]);         // dev sibling path: both dirs
	assert.deepEqual(cfg.order, ['mini', 'minidep'], 'dependency mini ordered before minidep');
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: [{ _id: 't2', isThing2: true }], segments: [] },
		{ label: 'plug-dep', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	await settle(g);
	assert.equal(cast(g, 't2', 'Thing2'), true, 'the dependent plugin cast');
	assert.equal(fact(g, 't2', 'tagged2'), true, 'the MiniDep provider ran through the resolved config');
});

test('the npm path end-to-end: definePlugin carries a REAL file-loaded dep → resolve → BOOTS on the engine', async () => {
	const { definePlugin } = require('../../lib/plugins');
	const mini = definePlugin(FIX_MINI);
	const minidep = definePlugin(FIX_DEP, [mini]);        // the dependent carries its dep as an object
	const cfg = resolvePlugins([minidep]);                // ONLY the top-level plugin — mini is flattened in
	assert.deepEqual(cfg.order, ['mini', 'minidep'], 'the carried dep flattens + orders first');
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes: [{ _id: 't3', isThing2: true }], segments: [] },
		{ label: 'plug-npm', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	await settle(g);
	assert.equal(cast(g, 't3', 'Thing2'), true, 'the dependent casts — the carried-object path boots identically to siblings');
	assert.equal(fact(g, 't3', 'tagged2'), true, 'its provider ran; both plugins were merged from ONE requireable object');
});

test('lintPluginDeps: sg-plugin.deps ⊆ package.json.dependencies passes; a missing dep is reported', () => {
	const { lintPluginDeps } = require('../../lib/plugins');
	const ok = lintPluginDeps(FIX_DEP);
	assert.equal(ok.ok, true, 'mini-dep declares `mini` in both sg-plugin.json and package.json');
	assert.deepEqual(ok.missing, []);
	const bad = lintPluginDeps(FIX_BADLINT);
	assert.equal(bad.ok, false, 'mini-badlint declares `ghost` only in sg-plugin.json');
	assert.deepEqual(bad.missing, ['ghost'], 'the undeclared npm dependency is named');
});
