'use strict';
/*
 * Copyright 2026 Nathanael Braun
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
// sg plugin {list,validate,scaffold} — the plugin author/consumer tooling (lib/sg/plugin-cli.js).
// The real plugins/ folder is the dogfood: every shipped plugin must validate clean (errors = 0).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { listPlugins, validatePluginDir, scaffoldPlugin } = require('../../lib/sg/plugin-cli.js');

const ROOT = path.join(__dirname, '..', '..');
const PLUGINS = path.join(ROOT, 'plugins');

test('listPlugins enumerates the shipped plugins with their manifest facts', () => {
	const list = listPlugins(PLUGINS);
	const names = list.map(( p ) => p.name).sort();
	for ( const expected of ['critical-mind', 'durable', 'forge', 'learning', 'mixture-serve', 'planner', 'reason-kernel', 'refinement', 'self-consistency'] )
		assert.ok(names.includes(expected), expected + ' listed');
	const planner = list.find(( p ) => p.name === 'planner');
	assert.deepStrictEqual(planner.sets.sort(), ['loop', 'loop-reactive', 'planner', 'support']);
	const forge = list.find(( p ) => p.name === 'forge');
	assert.deepStrictEqual(forge.deps, ['learning']);
	assert.ok(forge.combos.includes('forgeStock'));
});

test('every shipped plugin validates clean (the dogfood — 0 errors)', () => {
	for ( const e of fs.readdirSync(PLUGINS, { withFileTypes: true }) ) {
		if ( !e.isDirectory() ) continue;
		const r = validatePluginDir(path.join(PLUGINS, e.name));
		assert.deepStrictEqual(r.errors, [], e.name + ' has no validation errors');
		assert.ok(r.ok, e.name + ' ok');
	}
});

test('validate flags a bad dep declaration (negative control — the check is not vacuous)', () => {
	// the mini-badlint fixture declares an sg-plugin dep missing from package.json
	const r = validatePluginDir(path.join(ROOT, 'tests', 'fixtures', 'plugins', 'mini-badlint'));
	assert.ok(!r.ok, 'badlint fails');
	assert.ok(r.errors.some(( m ) => /package\.json/.test(m)), 'names the missing package.json dep');
});

test('validate reports unclaimed provider namespaces referenced by the grammar (warning, with the list)', () => {
	// planner's grammar names AI:: (ambient, deliberately unclaimed) → surfaced as a warning, not an error
	const r = validatePluginDir(path.join(PLUGINS, 'planner'));
	assert.ok(r.ok);
	assert.ok(r.warnings.some(( w ) => /AI/.test(w)), 'AI namespace surfaced: ' + JSON.stringify(r.warnings));
});

test('scaffold writes a loadable skeleton package; refuses to overwrite', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-scaffold-'));
	const dir = scaffoldPlugin(tmp, 'my-strategy');
	for ( const f of ['sg-plugin.json', 'package.json', 'index.js', 'README.md'] )
		assert.ok(fs.existsSync(path.join(dir, f)), f + ' written');
	assert.ok(fs.existsSync(path.join(dir, 'concepts', 'my-strategy')), 'concept set dir written');
	const r = validatePluginDir(dir);
	assert.deepStrictEqual(r.errors, [], 'skeleton validates clean');
	assert.throws(() => scaffoldPlugin(tmp, 'my-strategy'), /exists/, 'no silent overwrite');
	fs.rmSync(tmp, { recursive: true, force: true });
});
