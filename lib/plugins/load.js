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
const { buildConceptTree } = require('../authoring/concepts');

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
	var combos = {};
	if ( ep.combos ) {
		var names = Object.keys(ep.combos);
		for ( var c = 0; c < names.length; c++ ) {
			var mod = require(path.resolve(dir, ep.combos[names[c]]));
			combos[names[c]] = (mod && mod[names[c]]) || (mod && mod.default) || mod;
		}
	}

	return {
		name: manifest.name, version: manifest.version, tier: manifest.tier,
		concepts: concepts, providers: providers, providerNamespaces: manifest.providerNamespaces || [],
		deps: manifest.deps || [], combos: combos, manifest: manifest,
	};
}

// loadPlugins(dirs) -> resolved graph config (loads each dir then resolves the set together).
function loadPlugins( dirs ) {
	var resolvePlugins = require('./resolve.js').resolvePlugins;
	return resolvePlugins(dirs.map(loadPlugin));
}

module.exports = { loadPlugin: loadPlugin, loadPlugins: loadPlugins };
