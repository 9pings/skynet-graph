'use strict';
// `sg validate <conceptsDir>` — the grammar author's pre-flight (sandbox CLI): the shipped gallery
// validates clean (exit 0); a broken grammar (unparseable expr / unknown ref) exits non-zero and NAMES
// the offending concept; a missing dir fails usage-closed.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SG = path.resolve(__dirname, '../../bin/sg');
const run = ( args ) => new Promise(( res ) => {
	execFile('node', [SG, ...args], { timeout: 60000 }, ( err, stdout, stderr ) =>
		res({ code: err ? (err.code == null ? 1 : err.code) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

test('sg validate — the shipped gallery is clean (every public concept set validates, exit 0)', async () => {
	const r = await run(['validate', path.resolve(__dirname, '../../concepts')]);
	assert.equal(r.code, 0, 'stdout:\n' + r.stdout + '\nstderr:\n' + r.stderr);
	assert.match(r.stdout, /common: OK/);
});

test('sg validate — a broken grammar exits non-zero and NAMES the offending concept', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-val-'));
	try {
		fs.writeFileSync(path.join(dir, 'Broken.json'),
			JSON.stringify({ _id: 'Broken', _name: 'Broken', require: 'Distance', assert: ['$Distance.inKm >>>> ('] }));
		const r = await run(['validate', dir]);
		assert.notEqual(r.code, 0, 'a broken expr must fail the pre-flight');
		assert.match(r.stdout, /Broken/, 'the offending concept is named');
		const usage = await run(['validate']);
		assert.notEqual(usage.code, 0);
		assert.match(usage.stderr, /usage: sg validate/);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
