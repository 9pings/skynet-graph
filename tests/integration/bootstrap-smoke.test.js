'use strict';
// The BOOTSTRAP smoke-runner (roadmap FINIR F3): every examples/bootstrap/* file must run DETERMINISTIC,
// GPU-free, exit 0, and print its `BOOTSTRAP OK — <guarantee>` line — the runnable vitrine stays green as
// the lib evolves. Each bootstrap asserts its own combo's guarantee internally (economy / typed refusal /
// amortize+audit / rule enrichment / supervised authoring / wire provenance); this runner just executes
// them for real (a child process each — the exact `node examples/bootstrap/<f>.js` a reader would type).
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFile } = require('child_process');

const DIR = path.resolve(__dirname, '../../examples/bootstrap');
const BOOTSTRAPS = [
	'c1-appliance', 'c2-durable', 'c3-learning-library', 'c4-reactive-kg', 'c5-self-mod', 'c6-proxy',
	'openai-client', 'mcp-tools'
];

const run = ( file ) => new Promise(( res ) => {
	execFile('node', [path.join(DIR, file + '.js')], { timeout: 60000 }, ( err, stdout, stderr ) =>
		res({ code: err ? (err.code == null ? 1 : err.code) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

for ( const f of BOOTSTRAPS ) {
	test('bootstrap — ' + f + ' runs green (exit 0 + its guarantee line)', async () => {
		const r = await run(f);
		assert.equal(r.code, 0, f + ' exited ' + r.code + '\nstdout:\n' + r.stdout + '\nstderr:\n' + r.stderr);
		assert.match(r.stdout, /BOOTSTRAP OK — /, f + ' printed its guarantee line');
	});
}
