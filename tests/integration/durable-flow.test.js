'use strict';
/**
 * The DURABLE EXECUTOR end to end (Layer B over Layer A): a compiled Brick-1/3 method run over a stream of case
 * records. The conception §11-gate setup, measured with NEGATIVE CONTROLS:
 *   - typed SELECT routing is correct per class;
 *   - content-memo AMORTIZES a recurrent stream (calls < naive) and is SOUND (each class gets its OWN correct
 *     output — no false replay across classes);
 *   - map FAN-OUT yields one child per element, a shared element replays;
 *   - the durable memo replays ACROSS A RESTART (warm class → 0 calls);
 *   - CRASH-RESUME recovers an in-flight token with no work lost or duplicated (totalCalls == baseline).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { amortize, crossRestart, crashResume } = require('../../examples/poc/durable-flow.js');

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-df-')), 'flow.sqlite'); }

test('select routing + content-memo amortization + map fan-out (measured, sound)', () => {
	const r = amortize();
	// content-memo: 7 real task calls for a stream a naive replay would cost 11 (4 elided on RELATED records).
	assert.equal(r.taskCalls, 7, 'engine task calls');
	assert.equal(r.c.memoHits, 4, 'memo hits = elided calls');
	assert.equal(r.c.bypass, 0, 'every step was keyable (no CanonMiss bypass)');
	assert.equal(r.c.routed, 5, 'each of the 5 records fired exactly one select');
	assert.equal(r.c.fanOut, 4, 'two collection records fanned out 2 elements each');
	assert.equal(r.stats.done, 7, 'all tokens reached the sink (2 scalar + 2*2 map children + 1 fallback)');
	assert.equal(r.stats.failed, 0, 'no dead-letters');

	// SOUNDNESS (negative control): each class got its OWN correct output — no false cross-class replay.
	const done = r.marking.done;
	const byRec = ( id ) => done.filter(( t ) => t.recordId === id);
	assert.ok(byRec('a').every(( t ) => t.payload.total === 42), 'scalar a → foldRoute (total)');
	assert.ok(byRec('b').every(( t ) => t.payload.total === 42), 'scalar b → foldRoute (amortized, same correct output)');
	assert.equal(byRec('e')[0].payload.answer, 'llm:mystery', 'unknown class e → fallback micro (cost gradient, not a crash)');
	assert.deepEqual(byRec('c').map(( t ) => t.payload.converted).sort(), ['c(x)', 'c(y)'], 'collection c → map per element');
	assert.deepEqual(byRec('d').map(( t ) => t.payload.converted).sort(), ['c(x)', 'c(z)'], 'collection d → map; shared x replayed');
});

test('the durable content-memo replays ACROSS a process restart (warm class → 0 calls)', () => {
	const file = tmpFile();
	const r = crossRestart(file);
	assert.equal(r.warmCalls, 2, 'cold: classify + sum');
	assert.equal(r.replayCalls, 0, 'a same-class record in a FRESH process replays at 0 task calls (C5 survives restart)');
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('CRASH-RESUME: an in-flight token is recovered, no work lost or duplicated', () => {
	const file = tmpFile();
	const r = crashResume(file);
	assert.equal(r.leasedAtCrash, 1, 'the fuel-cut left exactly one token in-flight (leased)');
	assert.equal(r.resetCount, 1, 'rollbackInflight recovered it');
	assert.equal(r.done, 3, 'all three records completed after resume (nothing lost)');
	assert.equal(r.failed, 0, 'no dead-letters');
	assert.equal(r.totalCalls, r.baseline, 'total task calls across crash+resume == the uninterrupted baseline (no duplication)');
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
