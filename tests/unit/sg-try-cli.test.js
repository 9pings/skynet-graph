'use strict';
// `sg try` — the one-shot LIVE probe of an MCP tool feature. The live path needs a model (probed by
// hand / GPU); what the suite pins is the CLI contract: the three argument-validation exits with their
// actionable messages, and the help listing. Fast, spawn-based, zero model.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SG = path.join(__dirname, '..', '..', 'bin', 'sg');
const run = ( ...args ) => spawnSync(process.execPath, [SG, ...args],
	{ encoding: 'utf8', env: Object.assign({}, process.env, { FRONTIER_MODEL: '', LOCAL_MODEL: '', LLM_BASE: '' }) });

test('sg try — no feature: exit 1 with the feature list', () => {
	const r = run('try');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /try needs a feature/);
	assert.match(r.stderr, /critique · sc/);
});

test('sg try — no prompt: exit 1 naming the missing flag', () => {
	const r = run('try', 'critique');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /try needs the question/);
});

test('sg try — no model: exit 1 with every backend route and the WSL GPU hint', () => {
	const r = run('try', 'critique', '--prompt', 'x');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /--model <path\.gguf>/);
	assert.match(r.stderr, /FRONTIER_MODEL \/ LOCAL_MODEL \/ LLM_BASE/);
	assert.match(r.stderr, /LD_LIBRARY_PATH/);
});

test('sg try — listed in the CLI help', () => {
	const r = run('help-me');                             // unknown command → the usage text
	assert.match(r.stdout, /sg try\s+<critique\|sc> --model <gguf> --prompt/);
});
