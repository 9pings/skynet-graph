/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C2 — the DURABLE RUNNER (`createDurableRunner`): a crash-safe workflow executor.
 * THE GUARANTEE SHOWN: a recurrent typed stream AMORTIZES (content-memo — repeated steps replay at 0 task
 * calls, far under the naive count) and every run leaves a complete AUDIT (the derivation forest, one
 * summary line per record). With a file store the same runner resumes EXACTLY after a crash (kill-matrix
 * tested in the suite; node:sqlite backs it).
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { createDurableRunner } = require('../../lib/index.js').factories;
// the POC's plain micro-tasks: outputs are pure functions of the keyed facts → memoization is exact.
const { spec, keyOf, makeRunTask, STREAM } = require('../poc/durable-flow.js');

const NAIVE = 11;   // task-runs over this stream with NO memo

async function main() {
	const tasks = makeRunTask();
	const runner = createDurableRunner({ runTask: tasks.runTask, keyOf });   // add store:'flow.sqlite' for crash-safe
	try {
		const r = await runner.run('demo', spec, STREAM);
		const calls = tasks.total();
		console.log('stream  : ' + STREAM.length + ' records routed=' + r.routed);
		console.log('economy : ' + calls + ' task calls (naive would be ' + NAIVE + ') — memoHits=' + r.memoHits);
		assert.ok(calls < NAIVE, 'the content-memo amortized the recurrent steps');
		assert.equal(r.routed, STREAM.length, 'every record routed');

		const a = runner.audit('demo');
		console.log('audit   : ' + a.summary.split('\n').length + ' summary lines (one per record), forest keys='
			+ Object.keys(a.audit.records).length);
		assert.equal(a.summary.split('\n').length, STREAM.length);

		console.log('BOOTSTRAP OK — amortized (' + calls + '<' + NAIVE + ' calls), fully audited; file store = exact crash-resume');
	} finally { runner.close(); }
}
main().catch(( e ) => { console.error(e); process.exit(1); });
