'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * `sg plugin {list,validate,scaffold}` — the plugin author/consumer tooling (design
 * WIP/2026-07-16-design-plugin-architecture.md; the manifest↔derived cross-checks the loader core
 * deliberately left out).
 *
 *   list <dir>       enumerate the plugins of a folder from their manifests (no code is required/run)
 *   validate <dir>   load + lint one plugin: manifest sanity, sg-plugin.deps ⊆ package.json (lintPluginDeps),
 *                    author-time grammar validation per set (validateConceptTree), and the DERIVED
 *                    cross-checks (deriveManifest): provider namespaces the grammar actually references
 *                    vs. the manifest's claims (unclaimed → warning: ambient lib namespaces like AI/LLM/
 *                    Semiring or a dep's claim are legitimate), fact COLLISIONS across the plugin's sets
 *                    (warning: extension sets like loop/loop-reactive share their spine by design).
 *   scaffold <name>  write a loadable skeleton package (manifest + package.json + index.js auto-export +
 *                    an empty concept set + README). Refuses to overwrite.
 *
 * Validation philosophy: ERRORS are what would break a consumer (unloadable plugin, lying dep
 * declaration, structurally invalid grammar); everything informative stays a WARNING.
 */
const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');
const { loadPlugin, lintPluginDeps } = require('../plugins/load.js');
const { validateConceptTree } = require('../authoring/core/validate.js');
const { deriveManifest } = require('../authoring/core/corpus-pack.js');

// ── list — manifests only (never requires plugin code, safe on untrusted folders) ──
function listPlugins( rootDir ) {
	const out = [];
	for ( const e of fs.readdirSync(rootDir, { withFileTypes: true }) ) {
		if ( !e.isDirectory() ) continue;
		const mf = path.join(rootDir, e.name, 'sg-plugin.json');
		if ( !fs.existsSync(mf) ) continue;
		const m = JSON5.parse(fs.readFileSync(mf, 'utf8'));
		out.push({
			dir: path.join(rootDir, e.name),
			name: m.name, version: m.version, tier: m.tier,
			description: m.description || '',
			sets: (m.concepts || []).slice(),
			providerNamespaces: (m.providerNamespaces || []).slice(),
			combos: Object.keys((m.entrypoints || {}).combos || {}),
			deps: (m.deps || []).map(( d ) => typeof d === 'string' ? d : d.name)
		});
	}
	return out;
}

// ── validate — one plugin directory → { ok, errors[], warnings[], report } ──
function validatePluginDir( dir, opts ) {
	opts = opts || {};
	const errors = [], warnings = [];
	let plugin = null;
	try { plugin = loadPlugin(dir); }
	catch ( e ) { return { ok: false, errors: ['loadPlugin failed: ' + e.message], warnings, report: null }; }

	if ( !plugin.name ) errors.push('manifest has no name');
	if ( !plugin.version ) errors.push('manifest has no version');

	// dep declaration honesty: sg-plugin.deps ⊆ package.json (deps ∪ peer ∪ optional)
	if ( fs.existsSync(path.join(dir, 'package.json')) ) {
		const lint = lintPluginDeps(dir);
		if ( !lint.ok ) errors.push('sg-plugin.deps not in package.json dependencies: ' + lint.missing.join(', '));
	} else if ( (plugin.deps || []).length )
		warnings.push('declares deps but has no package.json (fine for a plugins/-folder-only plugin)');

	// author-time grammar validation, per set
	for ( const set of Object.keys(plugin.concepts) ) {
		const v = validateConceptTree(plugin.concepts[set], {});
		for ( const err of v.errors ) errors.push(`[${set}] ${err.message || err}`);
		for ( const w of v.warnings ) warnings.push(`[${set}] ${w.message || w}`);
	}

	// the DERIVED cross-checks (manifest ↔ what the grammar actually does)
	let derived = null;
	if ( Object.keys(plugin.concepts).length ) {
		derived = deriveManifest(plugin.concepts, { name: plugin.name, version: plugin.version });
		const claimed = new Set(plugin.providerNamespaces || []);
		// providersRequired lists full "Ns::fn" refs — the manifest claims NAMESPACES; compare at that grain
		const referencedNs = [...new Set((derived.providersRequired || []).map(( p ) => String(p).split('::')[0]))];
		const unclaimed = referencedNs.filter(( ns ) => !claimed.has(ns));
		if ( unclaimed.length )
			warnings.push('grammar references provider namespaces not claimed by this manifest: '
				+ unclaimed.join(', ') + ' (legitimate if ambient — AI/LLM/Semiring/… — or claimed by a dep)');
		for ( const ns of claimed )
			if ( !referencedNs.includes(ns) && !plugin.providers[ns] )
				warnings.push(`manifest claims namespace "${ns}" that neither the grammar references nor a providers entrypoint serves (factory-built at run time?)`);
		if ( (derived.collisions || []).length )
			warnings.push('fact collisions across this plugin\'s sets (by design for extension sets): '
				+ derived.collisions.map(( c ) => c.key || JSON.stringify(c)).slice(0, 8).join(', '));
	}

	return { ok: errors.length === 0, errors, warnings, report: { plugin: { name: plugin.name, version: plugin.version, tier: plugin.tier, sets: Object.keys(plugin.concepts), combos: Object.keys(plugin.combos), deps: plugin.deps }, derived } };
}

// ── scaffold — a loadable skeleton package ──
function scaffoldPlugin( rootDir, name ) {
	if ( !/^[a-z][a-z0-9-]*$/.test(String(name || '')) ) throw new Error('plugin name must be kebab-case: ' + name);
	const dir = path.join(rootDir, name);
	if ( fs.existsSync(dir) ) throw new Error(dir + ' already exists (no silent overwrite)');
	fs.mkdirSync(path.join(dir, 'concepts', name), { recursive: true });
	const w = ( f, s ) => fs.writeFileSync(path.join(dir, f), s);
	w('sg-plugin.json', JSON.stringify({
		name: name, version: '0.1.0', tier: 0,
		description: 'TODO — one line: what this strategy/capability does.',
		engine: '^1.3.0', concepts: [name], providerNamespaces: [], deps: []
	}, null, 2) + '\n');
	w('package.json', JSON.stringify({
		name: name, version: '0.1.0', description: 'TODO', main: 'index.js',
		license: 'AGPL-3.0-or-later',
		keywords: ['skynet-graph', 'skynet-graph-plugin'],
		peerDependencies: { 'skynet-graph': '>=1.3.0' },
		files: ['index.js', 'concepts', 'sg-plugin.json', 'README.md']
	}, null, 2) + '\n');
	w('index.js', [
		"'use strict';",
		'// auto-export: `require(\'' + name + '\')` returns the resolved plugin object.',
		'function requireEither( pkgName, relPath ) {',
		"\ttry { return require(pkgName); }",
		"\tcatch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }",
		'}',
		"const host = requireEither('skynet-graph', '../../lib/index.js');",
		'',
		'module.exports = host.definePlugin(__dirname);',
		''
	].join('\n'));
	w(path.join('concepts', name, 'Example.json'), [
		'{',
		'  // Example — a Tier-0 concept: pure grammar, no JS. Casts on any object carrying `exampleFlag`.',
		'  // Keep require/ensure on DISCRETE typed facts (never prose — the K1 barrier).',
		'  "require": ["exampleFlag"]',
		'}',
		''
	].join('\n'));
	w('README.md', '# ' + name + '\n\nTODO — a [skynet-graph](https://github.com/9pings/skynet-graph) plugin.\nValidate with `sg plugin validate ' + name + '`.\n');
	return dir;
}

// ── the CLI entry (wired from lib/sg/cli.js `sg plugin …`) ──
function runPluginCommand( args, log ) {
	log = log || console.log;
	const sub = args[0];
	if ( sub === 'list' ) {
		const root = args[1] || 'plugins';
		const list = listPlugins(root);
		if ( !list.length ) { log('no plugins under ' + root); return 0; }
		for ( const p of list )
			log(`${p.name}@${p.version}  tier ${p.tier}  sets[${p.sets.join(',')}]  ns[${p.providerNamespaces.join(',')}]  combos[${p.combos.join(',')}]${p.deps.length ? '  deps[' + p.deps.join(',') + ']' : ''}`);
		return 0;
	}
	if ( sub === 'validate' ) {
		const dir = args[1];
		if ( !dir ) { log('usage: sg plugin validate <dir>'); return 1; }
		const r = validatePluginDir(dir);
		for ( const e of r.errors ) log('ERROR   ' + e);
		for ( const w of r.warnings ) log('warning ' + w);
		log(r.ok ? `OK — ${path.basename(dir)} validates (${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'})` : `FAIL — ${r.errors.length} error(s)`);
		return r.ok ? 0 : 1;
	}
	if ( sub === 'scaffold' ) {
		const name = args[1];
		if ( !name ) { log('usage: sg plugin scaffold <kebab-name> [rootDir]'); return 1; }
		const dir = scaffoldPlugin(args[2] || 'plugins', name);
		log('scaffolded ' + dir + ' — edit sg-plugin.json / concepts/, then `sg plugin validate ' + dir + '`');
		return 0;
	}
	log('usage: sg plugin {list [dir] | validate <dir> | scaffold <name> [rootDir]}');
	return 1;
}

module.exports = { listPlugins, validatePluginDir, scaffoldPlugin, runPluginCommand };
