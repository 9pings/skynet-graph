'use strict';
/**
 * The flat factory catalog (`Graph.factories`) vs. the plugin manifests — the DRIFT GUARD.
 *
 * README + CLAUDE.md both promise: "every plugin's factory is re-exported on the flat `Graph.factories.*`
 * catalog". That promise silently went FALSE once (tree-of-thoughts / mcts / forge shipped their factories
 * in `entrypoints.factories` and nobody added the barrel line) — the docs claimed a surface the code did
 * not serve. This test derives the expectation FROM the manifests, so a new plugin factory either lands on
 * the catalog or fails here: the doc sentence is now enforced, not maintained by hand.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const json5 = require('json5');

const PLUGINS = path.join(__dirname, '..', '..', 'plugins');
const factories = require('../../lib/factories');

// every `entrypoints.factories` key declared by a bundled plugin, with the plugin that declares it
function declaredFactories() {
	const out = [];
	for ( const name of fs.readdirSync(PLUGINS).sort() ) {
		const manifest = path.join(PLUGINS, name, 'sg-plugin.json');
		if ( !fs.existsSync(manifest) ) continue;
		const m = json5.parse(fs.readFileSync(manifest, 'utf8'));         // JSONC — the manifests carry // comments
		const f = (m.entrypoints && m.entrypoints.factories) || {};
		for ( const key of Object.keys(f) ) out.push({ plugin: name, key });
	}
	return out;
}

test('every factory a plugin DECLARES is re-exported on the flat catalog', () => {
	const declared = declaredFactories();
	assert.ok(declared.length >= 6, 'sanity: the bundled plugins declare factories (' + declared.length + ')');
	for ( const { plugin, key } of declared )
		assert.equal(typeof factories[key], 'function',
			'plugins/' + plugin + ' declares entrypoints.factories.' + key + ' — it MUST be on Graph.factories (add the barrel line in lib/factories/index.js)');
});

test('the catalog covers the strategy catalog\'s two class-B drivers + the forge', () => {
	// the exact three that had drifted — named explicitly so the regression is legible, not just derived
	assert.equal(typeof factories.createTreeOfThoughts, 'function', 'ToT beam driver');
	assert.equal(typeof factories.createMCTS, 'function', 'MCTS UCB1 driver');
	assert.equal(typeof factories.forgeStock, 'function', 'the certified-stock forge (what `sg forge` runs)');
	assert.equal(typeof factories.dossierMarkdown, 'function', 'the forge admission dossier renderer');
});

test('the catalog is reachable through the facade under BOTH names (factories + the @deprecated combos alias)', () => {
	const Graph = require('../../lib/index.js');
	assert.equal(Graph.factories.createMCTS, factories.createMCTS, 'canonical name');
	assert.equal(Graph.combos.createMCTS, factories.createMCTS, 'the alias kept until 2.0 stays in sync');
});

test('the class-B drivers are callable from the catalog alone (no plugin-path require in a host)', async () => {
	// the point of the barrel: a host reaches ToT/MCTS the SAME way as C1-C9 — through the facade.
	const Graph = require('../../lib/index.js');
	const r = await Graph.factories.createMCTS({
		actions : async ( n ) => n.parent == null ? ['good', 'bad'] : [],
		simulate: async ( n ) => n.move === 'good' ? 1 : 0,
		iterations: 6,
	}).run('catalog-reachability');
	assert.equal(r.best.move, 'good', 'the driver ran, booted its own plugin graph, and converged');
});
