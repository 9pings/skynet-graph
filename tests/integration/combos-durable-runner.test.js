'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * Integration test for the C2 DURABLE-RUNNER combo (plugins/durable/combo.js). Deterministic — no GPU, no
 * network: the runner is driven with the POC's plain micro-tasks (examples/poc/durable-flow.js), whose outputs are
 * pure functions of the keyed facts, so the content-memo amortization and crash-resume properties are exact and
 * reproducible. Locks in the C2 gates:
 *   1. AMORTIZE     — a recurrent typed stream replays steps → task calls << naive (11); memoHits > 0.
 *   2. AUDIT        — the derivation forest + a one-line-per-record summary.
 *   3. CRASH-RESUME — SQLite store, fuel-cut leaves an in-flight token → a fresh runner reclaims it (exactly-once).
 *   4. COMPILE      — a spec compiles to a workflow net (+ validation); a malformed spec throws.
 *   5. GUARD        — no runTask → throws /runTask/.
 *   6. FACADE       — Graph.combos.createDurableRunner is the live function.
 */
global.__SERVER__ = true;

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const Graph = require('../../lib/index.js');
const { spec, keyOf, makeRunTask, STREAM } = require('../../examples/poc/durable-flow.js');

const createDurableRunner = Graph.combos.createDurableRunner;

// node:sqlite (Node 22+, experimental) backs the file store. If unavailable, the SQLite case skips; the in-memory
// cases must still pass.
let sqliteReason = false;
try { require('node:sqlite'); } catch ( e ) { sqliteReason = 'node:sqlite unavailable: ' + e.message; }

const NAIVE = 11;   // naive task-runs over STREAM with no memo (2+2+3+3+1) — see examples/poc/durable-flow.js.

// 1 — AMORTIZE: a recurrent typed stream replays steps at 0 task calls (content-memo). In-memory runner.
test('C2 amortize — task calls << naive, memoHits > 0, work completes', async () => {
	const rt = makeRunTask();
	const runner = createDurableRunner({ runTask: rt.runTask, keyOf });
	try {
		const r = await runner.run('run', spec, STREAM);

		const calls = rt.total();
		assert.ok(calls > 0, 'expected some real task calls, got ' + calls);
		assert.ok(calls < NAIVE, 'expected fewer task calls than naive ' + NAIVE + ', got ' + calls);
		assert.ok(r.memoHits > 0, 'expected content-memo hits, got ' + r.memoHits);
		assert.ok(runner.stats('run').done > 0, 'expected done tokens, got ' + runner.stats('run').done);
		assert.strictEqual(r.routed, STREAM.length, 'every record should route');
	} finally {
		runner.close();
	}
});

// 2 — AUDIT: after a run, audit() reconstructs the derivation forest + a non-empty summary line per record.
test('C2 audit — derivation forest + summary', async () => {
	const rt = makeRunTask();
	const runner = createDurableRunner({ runTask: rt.runTask, keyOf });
	try {
		await runner.run('run', spec, STREAM);
		const a = runner.audit('run');

		assert.strictEqual(typeof a.summary, 'string');
		assert.ok(a.summary.length > 0, 'summary should be a non-empty string');
		assert.ok(a.audit && typeof a.audit === 'object', 'audit should be an object');
		assert.ok(a.audit.records && typeof a.audit.records === 'object', 'audit.records forest present');
		assert.ok(a.audit.totals && typeof a.audit.totals === 'object', 'audit.totals present');
		// one summary line per record.
		assert.strictEqual(a.summary.split('\n').length, STREAM.length);
	} finally {
		runner.close();
	}
});

// 3 — CRASH-RESUME: SQLite store. Fuel-cut mid-flow leaves an in-flight (leased) token; a FRESH runner on the same
// file reclaims it via rollbackInflight and finishes — nothing lost or duplicated (the exactly-once property).
test('C2 crash-resume — in-flight token recovered exactly-once (SQLite)', { skip: sqliteReason }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-c2-'));
	const file = path.join(dir, 'flow.db');
	const records = [{ id: 'a', kind: 'scalar' }, { id: 'b', kind: 'scalar' }, { id: 'c', kind: 'scalar' }];
	try {
		// crash run: fuel (maxSteps) cut leaves a claimed-but-unprocessed token LEASED.
		const t1 = makeRunTask();
		const r1 = createDurableRunner({ store: file, runTask: t1.runTask, keyOf });
		let leasedAtCrash;
		try {
			await r1.run('c', spec, records, { batch: 8, maxSteps: 2 });
			leasedAtCrash = r1.stats('c').leased;
			assert.ok(leasedAtCrash >= 1, 'fuel-cut should leave >=1 in-flight token, got ' + leasedAtCrash);
		} finally {
			r1.close();   // ── crash ──
		}

		// a FRESH runner on the same file: reclaim orphaned in-flight + drain to completion.
		const t2 = makeRunTask();
		const r2 = createDurableRunner({ store: file, runTask: t2.runTask, keyOf });
		try {
			await r2.resume('c', spec);
			const st = r2.stats('c');
			assert.ok(st.done >= 3, 'all 3 records should be done after resume, got ' + st.done);
			assert.strictEqual(st.failed, 0, 'nothing should fail on resume, got ' + st.failed);
		} finally {
			r2.close();
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// 4 — COMPILE: a spec compiles to a workflow net (start/sinks/fail/transitions). A malformed spec throws.
test('C2 compile — spec → validated workflow net; malformed throws', () => {
	const rt = makeRunTask();
	const runner = createDurableRunner({ runTask: rt.runTask, keyOf });
	try {
		const net = runner.compile(spec);
		assert.ok(net && typeof net === 'object', 'compile returns a net object');
		assert.strictEqual(net.start, 'start', 'net.start');
		assert.deepStrictEqual(net.sinks, ['done'], 'net.sinks');
		assert.strictEqual(net.fail, 'failed', 'net.fail');
		assert.ok(Array.isArray(net.transitions) && net.transitions.length > 0, 'net.transitions is a non-empty array');
		// the select spec compiles to a typed routing transition.
		assert.ok(net.transitions.some(( t ) => t.kind === 'select'), 'a select transition is emitted');

		// a malformed spec (a select rule routing to an undefined method) throws deterministically.
		assert.throws(() => runner.compile({ name: 'bad', methods: { m: { steps: [{ task: 'T::x' }] } },
			select: { rules: [{ when: "$kind=='x'", method: 'nope' }] } }), /unknown method|method/);
		// a spec with no methods at all throws too.
		assert.throws(() => runner.compile({ name: 'empty' }), /methods/);
	} finally {
		runner.close();
	}
});

// 5 — GUARD: runTask is REQUIRED.
test('C2 guard — createDurableRunner without runTask throws /runTask/', () => {
	assert.throws(() => createDurableRunner({}), /runTask/);
});

// 6 — FACADE: the combo is reachable off the package facade.
test('C2 facade — Graph.combos.createDurableRunner is the live function', () => {
	assert.strictEqual(typeof require('../../lib/index.js').combos.createDurableRunner, 'function');
});
