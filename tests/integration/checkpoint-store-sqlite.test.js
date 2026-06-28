'use strict';
/**
 * The SQLite CheckpointStore (Layer A of the durable executor). Two things:
 *   1. the SHARED contract suite (tests/_checkpoint-suite.js) on a fresh :memory: db — pins the SQLite backend
 *      to the exact same behaviour as the memory reference impl (marking, lease/fence, fan-out, memo, rollback).
 *   2. DURABILITY + real CRASH-RESUME on a temp FILE — the property that justifies the SQLite default: state
 *      survives a process restart, and an in-flight (leased) token + its partial side-effects are recovered.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteCheckpointStore } = require('../../lib/durable/checkpoint-store.js');
const { runCheckpointContract } = require('../_checkpoint-suite.js');

// (1) the same contract, on the SQL backend (each store = a fresh isolated :memory: db).
runCheckpointContract('sqlite', ( o ) => {
	const s = createSqliteCheckpointStore(Object.assign({ file: ':memory:' }, o));
	return { store: s, close: () => s.close() };
}, { test, assert });

// (2) durability + crash-resume on disk.
function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ckpt-')), 'ckpt.sqlite'); }

test('[sqlite] state survives a restart: marking + content-memo re-open from the same file', () => {
	const file = tmpFile();
	let s = createSqliteCheckpointStore({ file });
	s.ensureRun('r1', { start: 'start', sinks: ['end'] });
	s.inject('r1', [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
	const [t] = s.claim('r1', { limit: 1, lease: 5000 });
	s.move(t, 'mid', { payload: { n: 9 } });
	s.memoSet('digest:xyz', { plan: 'cached' });
	s.close();                                                    // ── process exits ──

	s = createSqliteCheckpointStore({ file });                    // ── fresh process, same file ──
	const m = s.marking('r1');
	assert.equal((m.mid || []).length, 1, 'the moved token survived the restart');
	assert.equal(m.mid[0].payload.n, 9, 'its forwarded payload survived');
	assert.equal((m.start || []).length, 1, 'the un-touched token survived');
	assert.deepEqual(s.memoGet('digest:xyz'), { plan: 'cached' }, 'the content-memo survived (cross-restart 0-call replay, C5)');
	assert.equal(s.memoGet('digest:nope'), undefined, 'a different digest still misses (negative control)');
	s.close();
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('[sqlite] CRASH-RESUME: an in-flight token + its partial createdRefs are recovered after restart', () => {
	const file = tmpFile();
	let s = createSqliteCheckpointStore({ file });
	s.ensureRun('r1', { start: 'start', sinks: ['end'] });
	s.inject('r1', [{ id: 'a' }]);
	const [t] = s.claim('r1', { limit: 1, lease: 60000 });        // long lease — a clean restart must not wait it out
	s.track(t, [{ etty: 'Doc', id: 'side-effect-A' }]);           // a partial side-effect recorded mid-step
	// ── CRASH: the process dies here, the token is leased, the step half-done, no move committed ──
	s.close();

	s = createSqliteCheckpointStore({ file });                    // ── reboot ──
	assert.equal(s.stats('r1').leased, 1, 'on reboot the token is still marked in-flight (leased)');
	const rb = s.rollbackInflight('r1');                          // the orphan-scan
	assert.deepEqual(rb.created, [{ etty: 'Doc', id: 'side-effect-A' }], 'the partial side-effect is handed back to undo');
	assert.equal(rb.reset.length, 1, 'the in-flight token was reset');
	assert.equal(s.stats('r1').ready, 1, 'it is ready for a clean re-run');

	const [t2] = s.claim('r1', { limit: 1, lease: 5000 });        // re-claimable immediately (not waiting for lease)
	assert.equal(t2.recordId, 'a', 'the recovered case re-runs');
	// the pre-crash holder is fenced out: its stale move must be rejected
	assert.equal(s.move(t, 'mid'), null, 'the crashed worker’s stale (old-fence) move is rejected after resume');
	s.close();
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('[sqlite] lease counter is monotonic ACROSS restarts (the fence is not reused)', () => {
	const file = tmpFile();
	let s = createSqliteCheckpointStore({ file });
	s.ensureRun('r1', { start: 'start' });
	s.inject('r1', [{ id: 'a' }]);
	const [t1] = s.claim('r1', { limit: 1, lease: 5000 });
	const stale = t1.leaseId;
	s.rollbackInflight('r1');                                     // back to ready, fence cleared
	s.close();

	s = createSqliteCheckpointStore({ file });                    // reboot — an in-memory counter would reset to 0 here
	const [t2] = s.claim('r1', { limit: 1, lease: 5000 });
	assert.ok(t2.leaseId > stale, `a post-restart lease (${t2.leaseId}) outranks the pre-restart one (${stale}) — no fence reuse`);
	s.close();
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
