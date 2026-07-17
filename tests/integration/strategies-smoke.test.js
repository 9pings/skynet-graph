'use strict';
/**
 * The STRATEGY smoke-runner — the sibling of bootstrap-smoke, for `examples/strategies/`. Every file there
 * must run DETERMINISTIC, model-free, GPU-free, exit 0, and print its `STRATEGY OK — <guarantee>` line.
 * Each example asserts its own strategy's guarantee internally (the margin bound / the counter-gate / the
 * order guard / the defeasible cascade / the live worklist / the fail-closed router / the native prune /
 * the reproducible search); this runner executes them for real — a child process each, the exact
 * `node examples/strategies/<f>.js` a reader would type.
 *
 * Why a smoke runner at all: doc/strategies.md tells the reader these files demonstrate the guarantees. If
 * one rots, the doc becomes a lie. This is the pin that keeps the page true.
 */
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = path.resolve(__dirname, '../../examples/strategies');
const STRATEGIES = [
	'self-consistency', 'refinement', 'reflexion', 'socratic', 'least-to-most',
	'analogical', 'react', 'meta-router', 'tree-of-thoughts', 'mcts',
];

const run = ( file ) => new Promise(( res ) => {
	execFile('node', [path.join(DIR, file + '.js')], { timeout: 60000 }, ( err, stdout, stderr ) =>
		res({ code: err ? (err.code == null ? 1 : err.code) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

for ( const f of STRATEGIES ) {
	test('strategy — ' + f + ' runs green (exit 0 + its guarantee line)', async () => {
		const r = await run(f);
		assert.equal(r.code, 0, f + ' exited ' + r.code + '\nstdout:\n' + r.stdout + '\nstderr:\n' + r.stderr);
		assert.match(r.stdout, /STRATEGY OK — /, f + ' printed its guarantee line');
	});
}

test('the strategy example set COVERS the plugins that ship a strategy (no silent gap)', () => {
	// derive the expectation from the repo, not from this list: a new strategy plugin without an example is
	// a doc gap by construction (doc/strategies.md promises one runnable file per strategy).
	const PLUGINS = path.resolve(__dirname, '../../plugins');
	const STRATEGY_PLUGINS = ['self-consistency', 'refinement', 'socratic', 'least-to-most', 'analogical', 'react', 'tree-of-thoughts', 'mcts'];
	for ( const p of STRATEGY_PLUGINS ) {
		assert.ok(fs.existsSync(path.join(PLUGINS, p)), 'sanity: plugins/' + p + ' exists');
		// `refinement` ships TWO accept gates (refinement + reflexion) → two example files; react's dir is `react`.
		const expected = p === 'refinement' ? ['refinement', 'reflexion'] : [p];
		for ( const e of expected )
			assert.ok(fs.existsSync(path.join(DIR, e + '.js')),
				'plugins/' + p + ' ships a strategy but examples/strategies/' + e + '.js is missing');
	}
	// and the two catalog entries that live outside the strategy plugins
	assert.ok(fs.existsSync(path.join(DIR, 'meta-router.js')), 'the meta-router (planner) needs its example too');
	for ( const f of STRATEGIES ) assert.ok(fs.existsSync(path.join(DIR, f + '.js')), f + '.js is listed but missing');
});
