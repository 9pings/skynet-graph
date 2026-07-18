'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * Plugin file-layer — turn a plugin DIRECTORY into the in-memory plugin object the resolver consumes.
 * Standard layout (design `WIP/2026-07-16-design-plugin-architecture.md` §2):
 *   <dir>/sg-plugin.json                 the manifest (identity, concepts, providerNamespaces, deps, entrypoints)
 *   <dir>/concepts/<set>/                a concept set per name in manifest.concepts (buildConceptTree)
 *   <dir>/<entrypoints.providers>        a module exporting { Ns: { fn } }  (Tier-1 only; Tier-0 has none)
 *   <dir>/<entrypoints.combos[name]>     a module exporting the combo factory `name`
 *
 * `.sgc` stocks and the manifest-vs-derived cross-check are layered on top later; this is the loader core.
 */
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');
const { buildConceptTree } = require('../authoring/core/concepts');

// loadPlugin(dir) -> { name, version, concepts:{set:tree}, providers:{ns:frag}, providerNamespaces,
//   deps, combos:{name:factory}, tier, manifest } — the exact shape resolvePlugins expects.
function loadPlugin( dir ) {
	var manifest = JSON5.parse(fs.readFileSync(path.join(dir, 'sg-plugin.json'), 'utf8'));

	var concepts = {};
	for ( var i = 0; i < (manifest.concepts || []).length; i++ ) {
		var set = manifest.concepts[i];
		concepts[set] = buildConceptTree(path.join(dir, 'concepts', set));
	}

	var ep = manifest.entrypoints || {};
	var providers = ep.providers ? require(path.resolve(dir, ep.providers)) : {};
	// canonical manifest key: `factories` (a plugin's packaged assembly — the retired "combo" name).
	// `combos` = the legacy spelling, still read for back-compat — remove at 2.0.
	var epFactories = ep.factories || ep.combos;
	var factories = {};
	if ( epFactories ) {
		var names = Object.keys(epFactories);
		for ( var c = 0; c < names.length; c++ ) {
			var mod = require(path.resolve(dir, epFactories[names[c]]));
			factories[names[c]] = (mod && mod[names[c]]) || (mod && mod.default) || mod;
		}
	}

	// instance-type descriptor (`entrypoints.descriptor`): the typed-action contract the instance
	// service dispatches on (and generates MCP tools from). Loaded like factories; consumers reach
	// it as pluginObj.descriptor / resolvePlugins().descriptors[type]. See lib/plugins/descriptor.js.
	var descriptor = ep.descriptor ? require(path.resolve(dir, ep.descriptor)) : null;

	return {
		name: manifest.name, version: manifest.version, tier: manifest.tier,
		concepts: concepts, providers: providers, providerNamespaces: manifest.providerNamespaces || [],
		deps: manifest.deps || [], factories: factories, combos: factories /* @deprecated alias */,
		descriptor: descriptor, manifest: manifest,
	};
}

// loadPlugins(dirs) -> resolved graph config (loads each dir then resolves the set together).
function loadPlugins( dirs ) {
	var resolvePlugins = require('./resolve.js').resolvePlugins;
	return resolvePlugins(dirs.map(loadPlugin));
}

// definePlugin(dir, depObjects) -> the auto-export helper an npm-published plugin's index.js uses:
//   module.exports = require('skynet-graph').definePlugin(__dirname, [require('reason-kernel')]);
// It is loadPlugin(dir) PLUS carriage of the already-required dependency OBJECTS (npm + node's `require`
// did the install/resolution — the graph never fetches; owner 07-16 quater). The carried set is checked
// against sg-plugin.deps: every declared dep must be carried (the "forgot to require" bug), and every
// carried object must be declared (no stray dep) — fail-closed, author-time, with a precise message.
function definePlugin( dir, depObjects ) {
	var base = loadPlugin(dir);
	var carried = depObjects || [];
	var declared = (base.deps || []).map(function ( d ) { return d.name; });
	var carriedNames = carried.map(function ( o ) { return o && o.name; });
	for ( var i = 0; i < declared.length; i++ )
		if ( carriedNames.indexOf(declared[i]) < 0 )
			throw new Error('plugin "' + base.name + '": declared dependency "' + declared[i] +
				'" is not carried — pass its object: definePlugin(__dirname, [require(\'' + declared[i] + '\')])');
	for ( var j = 0; j < carried.length; j++ )
		if ( declared.indexOf(carriedNames[j]) < 0 )
			throw new Error('plugin "' + base.name + '": carried dependency object "' + carriedNames[j] +
				'" is not declared in sg-plugin.deps — declare it there or drop the require');
	base.pluginDeps = carried;
	return base;
}

// lintPluginDeps(dir) -> { ok, missing:[name], declared:[name] } : sg-plugin.deps ⊆ package.json
// dependencies (∪ peer ∪ optional). A plugin dep the package never installs would `require`-fail at load —
// catch it author-time (owner 07-16 quater: sg-plugin.deps = npm package names). Used by `sg plugin validate`.
function lintPluginDeps( dir ) {
	var manifest = JSON5.parse(fs.readFileSync(path.join(dir, 'sg-plugin.json'), 'utf8'));
	var pkgPath = path.join(dir, 'package.json');
	var pkg = fs.existsSync(pkgPath) ? JSON5.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
	var installed = Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies);
	var declared = (manifest.deps || []).map(function ( d ) { return d.name; });
	var missing = declared.filter(function ( n ) { return !Object.prototype.hasOwnProperty.call(installed, n); });
	return { ok: missing.length === 0, missing: missing, declared: declared };
}

module.exports = { loadPlugin: loadPlugin, loadPlugins: loadPlugins, definePlugin: definePlugin, lintPluginDeps: lintPluginDeps };
