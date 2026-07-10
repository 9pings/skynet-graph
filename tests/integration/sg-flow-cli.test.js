'use strict';
// `sg flow run` — the C2 durable runner mounted as a CLI (roadmap FINIR F5). The workflow lives in a JS
// module ({ spec, makeRunTask, keyOf, STREAM } — examples/poc/durable-flow.js): the CLI runs it for real
// (child process), reports the economy (memoHits) + the audit summary, and fails usage-closed.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFile } = require('child_process');

const SG = path.resolve(__dirname, '../../bin/sg');
const MOD = path.resolve(__dirname, '../../examples/poc/durable-flow.js');
const run = ( args ) => new Promise(( res ) => {
	execFile('node', [SG, ...args], { timeout: 60000 }, ( err, stdout, stderr ) =>
		res({ code: err ? (err.code == null ? 1 : err.code) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

test('sg flow run — runs the module workflow: amortized (memoHits > 0), audited, exit 0', async () => {
	const r = await run(['flow', 'run', MOD, '--json']);
	assert.equal(r.code, 0, 'stderr:\n' + r.stderr);
	const j = JSON.parse(r.stdout);
	assert.ok(j.result.routed > 0, 'records routed');
	assert.ok(j.result.memoHits > 0, 'the content-memo amortized repeated steps');
	assert.ok(j.stats.done > 0, 'tokens completed');
	assert.ok(j.summary.split('\n').length >= j.result.routed, 'one audit summary line per record');
});

test('sg flow run — human output prints economy + audit; usage fails closed without a module', async () => {
	const human = await run(['flow', 'run', MOD]);
	assert.equal(human.code, 0);
	assert.match(human.stdout, /memoHits=\d+/);
	const usage = await run(['flow', 'run']);
	assert.notEqual(usage.code, 0, 'no module → usage error');
	assert.match(usage.stderr, /usage: sg flow run/);
});
