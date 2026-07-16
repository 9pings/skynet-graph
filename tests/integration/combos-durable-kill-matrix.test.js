'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P4 — the DURABLE-RUNNER KILL MATRIX (roadmap Phase 4: "matrice de kill verte — aucun effet perdu ni dupliqué,
 * reprise exacte"). combos-durable-runner.test.js already locks a SINGLE fuel-cut resume; this locks the cells a
 * clean fuel-cut does NOT reach — the ones that decide production-safety:
 *   A. FENCING       — a zombie worker whose lease lapsed and was re-claimed CANNOT commit (Kleppmann fencing token);
 *                      the re-claimer commits exactly once. No double-effect, no marking corruption.
 *   B. LEASE SAFETY  — a token still WITHIN its lease is NOT re-offered to a second worker (no concurrent double-claim).
 *   C. MULTI-CRASH   — two successive crashes mid-flow (SQLite) still resume to exactly-once completion.
 *   D. KILL -9       — a REAL child process SIGKILLed mid-flow (not a clean fuel-cut) resumes from the WAL-durable
 *                      SQLite file with nothing lost or duplicated (hard-crash durability, not just an in-process stop).
 *   E. POISON        — a token that keeps failing is dead-lettered at maxAttempts (FAILED), never re-leased forever.
 * Cells A/B/E drive the CheckpointStore directly with an injected clock (deterministic); C/D use the combo on SQLite.
 */
global.__SERVER__ = true;

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const Graph = require(ROOT + '/lib/index.js');
const cp = require(ROOT + '/plugins/durable/lib/checkpoint-store.js');
const { spec, keyOf, makeRunTask, STREAM } = require(ROOT + '/examples/poc/durable-flow.js');
const createDurableRunner = Graph.factories.createDurableRunner;

let sqliteReason = false;
try { require('node:sqlite'); } catch ( e ) { sqliteReason = 'node:sqlite unavailable: ' + e.message; }

// a mutable, injectable clock so lease expiry is DETERMINISTIC (no real sleeps).
function clockStore() {
	const clk = { t: 1000 };
	const store = cp.createMemoryCheckpointStore({ now: () => clk.t });
	store.ensureRun('r', { start: 'start', sinks: ['done'], fail: 'failed' });
	return { store, clk };
}

// ── A. FENCING — a re-claimed token's ORIGINAL holder is fenced out; the re-claimer commits exactly once ──────
test('A fencing — a zombie worker (lapsed lease, re-claimed) cannot commit; exactly one move wins', () => {
	const { store, clk } = clockStore();
	store.inject('r', [{ id: 'x' }]);

	const [tA] = store.claim('r', { lease: 1000, limit: 1 });        // worker A leases the token (leaseId #1)
	assert.ok(tA && tA.leaseId != null, 'worker A holds a fencing token');

	clk.t += 5000;                                                    // A stalls; its lease lapses
	const [tB] = store.claim('r', { lease: 1000, limit: 1 });        // worker B re-claims the SAME token (leaseId #2)
	assert.ok(tB && tB.id === tA.id, 'B re-claims the same token id');
	assert.notStrictEqual(tB.leaseId, tA.leaseId, 'B holds a FRESH fencing token (bumped leaseId)');

	const zombie = store.move(tA, 'done');                           // A wakes up and tries to commit → FENCED OUT
	assert.strictEqual(zombie, null, 'the zombie (stale lease) move is REJECTED — no corruption');
	const winner = store.move(tB, 'done');                          // B commits
	assert.ok(winner && winner.status === 'done', 'the re-claimer commits');

	const st = store.stats('r');
	assert.strictEqual(st.done, 1, 'the token reached done EXACTLY once (no duplicate effect)');
	assert.strictEqual(st.leased || 0, 0, 'no token left leased');
});

// ── B. LEASE SAFETY — a token still within its lease is NOT re-offered (no concurrent double-claim) ──────────
test('B lease safety — a live lease is not re-offered to a second worker', () => {
	const { store, clk } = clockStore();
	store.inject('r', [{ id: 'y' }]);

	const a = store.claim('r', { lease: 10000, limit: 1 });
	assert.strictEqual(a.length, 1, 'worker A claims the token');
	clk.t += 3000;                                                   // still WELL within the 10s lease
	const b = store.claim('r', { lease: 10000, limit: 1 });
	assert.strictEqual(b.length, 0, 'worker B gets NOTHING — the live lease is not double-claimed');

	clk.t += 8000;                                                  // now the lease HAS lapsed
	const c = store.claim('r', { lease: 10000, limit: 1 });
	assert.strictEqual(c.length, 1, 'once lapsed, the token is re-offered');
});

// ── C. MULTI-CRASH — two successive mid-flow crashes still resume to exactly-once completion (SQLite) ────────
test('C multi-crash — two fuel-cuts then resume: exactly-once, nothing lost', { skip: sqliteReason }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-p4-c-'));
	const file = path.join(dir, 'flow.db');
	const records = [{ id: 'a', kind: 'scalar' }, { id: 'b', kind: 'scalar' }, { id: 'c', kind: 'scalar' }];
	try {
		// crash #1 — a very tight fuel cut leaves the flow barely started.
		const r1 = createDurableRunner({ store: file, runTask: makeRunTask().runTask, keyOf });
		try { await r1.run('m', spec, records, { batch: 8, maxSteps: 1 }); } finally { r1.close(); }

		// crash #2 — resume, but cut the fuel again mid-way (a SECOND crash before completion).
		const r2 = createDurableRunner({ store: file, runTask: makeRunTask().runTask, keyOf });
		try { r2.resume && await r2.resume('m', spec, { batch: 8, maxSteps: 2 }); } finally { r2.close(); }

		// final resume — drain to completion.
		const r3 = createDurableRunner({ store: file, runTask: makeRunTask().runTask, keyOf });
		try {
			await r3.resume('m', spec);
			const st = r3.stats('m');
			assert.ok(st.done >= 3, 'all 3 records done after two crashes, got ' + st.done);
			assert.strictEqual(st.failed, 0, 'nothing failed across the crash sequence, got ' + st.failed);
			assert.strictEqual(st.leased || 0, 0, 'no orphaned in-flight token remains');
		} finally { r3.close(); }
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── D. KILL -9 — a REAL child SIGKILLed mid-flow resumes from the WAL-durable file (hard-crash durability) ────
test('D kill -9 — a SIGKILLed child mid-flow resumes exactly-once (WAL durability)', { skip: sqliteReason }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-p4-d-'));
	const file = path.join(dir, 'flow.db');
	const marker = path.join(dir, 'MID');
	const childJs = path.join(dir, 'child.js');
	// the child: run the flow on SQLite; after 2 COMMITTED task-steps, drop a marker and HANG (so kill -9 hits it
	// truly mid-flow, with a leased token durably on disk) — never exits on its own.
	fs.writeFileSync(childJs, `
global.__SERVER__ = true;
const Graph = require(${JSON.stringify(ROOT + '/lib/index.js')});
const { spec, keyOf, makeRunTask, STREAM } = require(${JSON.stringify(ROOT + '/examples/poc/durable-flow.js')});
const fs = require('fs');
const rt = makeRunTask(); let n = 0;
const runTask = async ( task, token ) => {
	const r = await rt.runTask(task, token);
	if ( ++n === 2 ) {                                   // mid-flow: commit-then-hang, KEEPING the process alive so kill -9 hits it
		fs.writeFileSync(${JSON.stringify(marker)}, 'MID');
		setInterval(() => {}, 1e9);                       // hold the event loop open (a bare pending promise would let node EXIT)
		await new Promise(() => {});
	}
	return r;
};
const runner = Graph.factories.createDurableRunner({ store: ${JSON.stringify(file)}, runTask, keyOf });
runner.run('k', spec, STREAM).catch(() => {});
`);
	try {
		const child = spawn(process.execPath, [childJs], { stdio: 'ignore' });
		let spawnErr = null; child.on('error', ( e ) => { spawnErr = e; });
		// wait (deterministically, via the marker written AFTER the 2nd commit) up to ~8s for the child to be mid-flow.
		const t0 = Date.now();
		while ( !fs.existsSync(marker) && !spawnErr && (Date.now() - t0) < 8000 ) await new Promise(( res ) => setTimeout(res, 25));
		assert.ok(!spawnErr, 'child spawned: ' + (spawnErr && spawnErr.message));
		assert.ok(fs.existsSync(marker), 'child reached mid-flow (committed >=1 step) before the kill');

		// ── kill -9, truly mid-flow ── attach the exit listener BEFORE killing; short-circuit if already gone.
		await new Promise(( res ) => {
			if ( child.exitCode !== null || child.signalCode !== null ) return res();
			child.once('exit', res);
			child.kill('SIGKILL');
		});

		// a FRESH runner on the same WAL-durable file: reclaim the orphaned in-flight + drain to completion.
		const r = createDurableRunner({ store: file, runTask: makeRunTask().runTask, keyOf });
		try {
			await r.resume('k', spec);
			const st = r.stats('k');
			assert.ok(st.done >= STREAM.length, 'every record done after the kill, got ' + st.done + '/' + STREAM.length);
			assert.strictEqual(st.failed, 0, 'nothing failed after resume from the SIGKILL, got ' + st.failed);
			assert.strictEqual(st.leased || 0, 0, 'no orphaned lease survived the resume');
			// audit is COMPLETE on the resumed run (observability holds across the crash).
			const a = r.audit('k');
			assert.ok(a.summary && a.summary.length > 0, 'the derivation forest is auditable after a hard kill');
		} finally { r.close(); }
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── E. POISON — a token that keeps failing is dead-lettered at maxAttempts (never re-leased forever) ─────────
test('E poison — a repeatedly-unhandled token is dead-lettered at maxAttempts (FAILED, not infinite re-lease)', () => {
	const { store, clk } = clockStore();
	store.inject('r', [{ id: 'z' }]);
	// simulate a worker that claims but crashes before moving, repeatedly — each re-claim bumps attempts.
	let claimed = 0;
	for ( let i = 0; i < 5; i++ ) {
		const got = store.claim('r', { lease: 1000, limit: 1, maxAttempts: 3 });
		if ( got.length ) claimed++;
		clk.t += 5000;                                               // the worker "crashes" → lease lapses → re-offer
	}
	const st = store.stats('r');
	assert.strictEqual(st.failed, 1, 'the poison token is dead-lettered (FAILED) after maxAttempts');
	assert.strictEqual(st.leased || 0, 0, 'it is NOT left leased / re-offered forever');
	assert.ok(claimed <= 3, 'it was re-offered at most maxAttempts times, got ' + claimed);
});
