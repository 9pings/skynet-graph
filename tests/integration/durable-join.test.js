'use strict';
/**
 * The FOLD-BACK / cardinality JOIN — map ∘ reduce END TO END on the durable executor (the JTMS-at-merge point,
 * study §4B/§9.3). The first concrete sub-rung toward §11 kill-criterion #6 (soundness under composition).
 * Measured with NEGATIVE CONTROLS:
 *   - SOUNDNESS (= open-the-box): the durable folded result EQUALS a plain JS map-then-reduce;
 *   - ORDER-INDEPENDENCE: identical result under a varied SCHEDULE (batch=1/3/32) — commutative monoid (sum)
 *     trivially, NON-commutative (concat) via the element-index sort (non-det throughput, deterministic belief);
 *   - AMORTIZATION: a recurrent stream replays per-element bodies AND a micro-TASK fold at 0 calls (projected
 *     keys); a novel element/group pays (no false hit);
 *   - CROSS-RESTART: the durable memo (incl. the fold) replays across a process restart;
 *   - CRASH-RESUME of a half-complete JOIN, at EVERY fuel cut: committed parked siblings survive, in-flight
 *     tokens recover, the result is always correct, no work lost or duplicated;
 *   - NEGATIVE CONTROL: the fold does NOT fire (no done token) until ALL siblings have arrived.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mr = require('../../examples/poc/durable-mapreduce.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mrj-')); }

test('map∘reduce SOUNDNESS (= open-the-box) + ORDER-INDEPENDENCE under a varied schedule', async () => {
	const r = await mr.soundAndOrder();
	// #1 soundness: the durable sum EQUALS the plain map-then-reduce, at every batch size (= schedule).
	for ( const b of [1, 3, 32] ) {
		assert.equal(r.out['sum_b' + b].total, r.openSum, `durable sum @batch=${b} equals open-the-box (${r.openSum})`);
		assert.equal(r.out['sum_b' + b].joins, 1, 'exactly one cardinality JOIN fired');
		assert.equal(r.out['sum_b' + b].folds, 1, 'exactly one fold');
	}
	// #2 order-independence: a NON-commutative monoid (concat) is deterministic + ordered (by element index).
	for ( const b of [1, 3, 32] ) assert.deepEqual(r.out['cat_b' + b], r.openCat, `concat @batch=${b} == open-the-box, _i-ordered`);
});

test('AMORTIZATION: a recurrent stream replays bodies AND the micro-task fold (projected keys); a novel group pays', async () => {
	const a = await mr.amortize();
	// 3 records × (3 bodies + 1 fold) = 12 firings; only the genuinely-new work calls the model.
	assert.equal(a.taskCalls, 6, 'real calls: a=4 (3 score+1 fold) + c=2 (score(4)+novel fold); b replays fully');
	assert.equal(a.memoHits, 6, 'b: 3 bodies + 1 fold; c: 2 bodies — all elided');
	assert.equal(a.counts['T::score'], 4, 'score paid for {1,2,3} then only the novel {4}');
	assert.equal(a.counts['T::reconcile'], 2, 'the task-fold paid for a + the novel group c; b replayed it');
	// SOUNDNESS (negative control): b (identical group) == a; c (different group) gets its OWN correct fold.
	assert.equal(a.results.b.sum, a.results.a.sum, 'identical group → same fold result (sound replay)');
	assert.equal(a.results.a.sum, 14, 'a = 1+4+9');
	assert.equal(a.results.c.sum, 29, 'c = 4+9+16 (its own correct fold, no false replay)');
	assert.equal(a.results.c.max, 16, 'c max distinct from a max (9)');
});

test('CROSS-RESTART: the durable memo (incl. the task-fold) replays across a process restart', async () => {
	const dir = tmpDir();
	try {
		const r = await mr.crossRestart(path.join(dir, 'x.sqlite'));
		assert.equal(r.warmCalls, 4, 'cold: 3 score + 1 reconcile');
		assert.equal(r.replayCalls, 0, 'a same-group record in a FRESH process replays bodies AND fold at 0 calls');
		assert.equal(r.total, 14, 'and the correct folded total survives the restart');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CRASH-RESUME of a half-complete JOIN is SOUND at EVERY fuel cut (no work lost or duplicated)', async () => {
	const dir = tmpDir();
	try {
		let sawLeased = false, sawJoined = false;
		for ( let fuel = 1; fuel <= 14; fuel++ ) {
			const r = await mr.crashResume(path.join(dir, 'f' + fuel + '.sqlite'), fuel);
			assert.equal(r.resumedTotal, r.baselineTotal, `fuel=${fuel}: resumes to the correct total (${r.baselineTotal})`);
			assert.equal(r.totalCalls, r.baselineCalls, `fuel=${fuel}: total calls == baseline (no duplication)`);
			assert.equal(r.done, 1, `fuel=${fuel}: the record completes after resume`);
			assert.equal(r.failed, 0, `fuel=${fuel}: no dead-letters`);
			assert.equal(r.reset, r.midLeased, `fuel=${fuel}: rollbackInflight recovers exactly the in-flight tokens`);
			// NEGATIVE CONTROL: while the join is incomplete (< all siblings parked), there is NO premature result.
			if ( r.midJoined < 5 ) assert.equal(r.midDone, 0, `fuel=${fuel}: the fold did NOT fire before all siblings arrived`);
			if ( r.midLeased > 0 ) sawLeased = true;
			if ( r.midJoined > 0 && r.midJoined < 5 ) sawJoined = true;
		}
		// the sweep genuinely exercised both a mid-fan-OUT crash (in-flight bodies) and a mid-fan-IN crash
		// (some siblings committed/parked while others recovered) — not a vacuous single point.
		assert.ok(sawLeased, 'some cut left an in-flight (leased) token — a real crash window');
		assert.ok(sawJoined, 'some cut left a PARTIALLY-joined group — committed parks + recovered in-flight');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
