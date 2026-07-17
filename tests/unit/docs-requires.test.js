'use strict';
/**
 * Every `require('skynet-graph/...')` printed in the docs must actually resolve.
 *
 * Why this exists: the 2026-07-16 plugin decomposition moved the `lib/authoring` modules into `core/` and
 * into the plugins' own lib folders, and the docs were not followed. `docs/API.md` told readers to require
 * `skynet-graph/lib/authoring/validate` and `docs/CAPABILITIES.md` told them to require
 * `skynet-graph/lib/authoring/givens` — both dead paths, sitting in the two pages a new reader is most
 * likely to copy from, for a full release. Nothing caught it because nothing was looking: prose about code
 * had no guard, while the code itself had a whole suite.
 *
 * This derives the check from the docs themselves rather than maintaining a list — move a module again and
 * this fails here instead of failing in a stranger's terminal.
 */
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

/** every .md the package publishes, plus the two root pages */
function docFiles() {
	const out = [];
	const walk = ( dir ) => {
		for ( const e of fs.readdirSync(dir, { withFileTypes: true }) ) {
			const p = path.join(dir, e.name);
			if ( e.isDirectory() ) { if ( !/node_modules|\.git/.test(p) ) walk(p); }
			else if ( /\.md$/.test(e.name) ) out.push(p);
		}
	};
	walk(path.join(ROOT, 'docs'));
	for ( const f of ['README.md', 'CLAUDE.md'] ) {
		const p = path.join(ROOT, f);
		if ( fs.existsSync(p) ) out.push(p);
	}
	return out;
}

test('every require() path the docs show a reader actually resolves', () => {
	const bad = [];
	let checked = 0;
	for ( const file of docFiles() ) {
		const lines = fs.readFileSync(file, 'utf8').split('\n');
		lines.forEach(( line, i ) => {
			const re = /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
			let m;
			while ( (m = re.exec(line)) ) {
				const spec = m[1];
				if ( !/^skynet-graph(\/|$)/.test(spec) ) continue;         // only OUR package's paths are ours to keep true
				if ( /[<{]/.test(spec) ) continue;                          // `.../<module>` = a placeholder, not a path
				const rel = spec === 'skynet-graph' ? 'lib/index.js' : spec.replace(/^skynet-graph\//, '');
				const cands = [rel, rel + '.js', path.join(rel, 'index.js')];
				checked++;
				if ( !cands.some(( c ) => fs.existsSync(path.join(ROOT, c)) ) )
					bad.push(path.relative(ROOT, file) + ':' + (i + 1) + ' → ' + spec);
			}
		});
	}
	assert.ok(checked >= 10, 'the scan found the docs (only ' + checked + ' requires seen — did docs/ move?)');
	assert.deepEqual(bad, [], 'docs point at modules that do not exist:\n  ' + bad.join('\n  '));
});

test('the docs do not teach the retired `combos` alias', () => {
	// `Graph.combos` still works (deprecated alias, pinned by its own test) but no page should TEACH it:
	// 3c3a3d1 renamed the concept to capability factories, and docs/CAPABILITIES.md kept handing readers
	// the old name for two releases.
	const bad = [];
	for ( const file of docFiles() ) {
		fs.readFileSync(file, 'utf8').split('\n').forEach(( line, i ) => {
			if ( /require\([^)]*\)\s*\.combos\b|['"`]skynet-graph['"`]\s*\)\s*\.combos\b/.test(line) )
				bad.push(path.relative(ROOT, file) + ':' + (i + 1));
		});
	}
	assert.deepEqual(bad, [], 'these pages teach `.combos` — the canonical name is `.factories`:\n  ' + bad.join('\n  '));
});
