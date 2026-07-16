'use strict';
/**
 * §3.3 (A) — C-fail++ recovery LADDER on the durable executor: beyond all-or-nothing fail-fast, a bounded
 * RETRY (transient/non-deterministic tasks) then a one-shot ESCALATE (a bigger micro-task that rejoins the
 * flow), then the terminal group policy. NEVER a silently-wrong derivation; bounded (no infinite loop);
 * the recovery counters ride the DURABLE payload so they survive a crash/restart. ZERO Layer-A (interpreter
 * ladder + xlate emits `retry`/the escalation place).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryCheckpointStore } = require('../../plugins/durable/lib/checkpoint-store.js');
const { compileMethod } = require('../../plugins/durable/lib/xlate.js');
const { runFlow } = require('../../plugins/durable/lib/interpreter.js');

function run(spec, runTask, opts) {
	const net = compileMethod(spec);
	const store = createMemoryCheckpointStore();
	store.ensureRun('r', net);
	store.inject('r', [{ id: 'rec1', x: 1 }]);
	return runFlow(store, 'r', net, Object.assign({ runTask }, opts)).then((c) => ({ c, st: store.stats('r') }));
}
// a transient task that only succeeds once it has been retried `threshold` times (reads its durable `_retry`).
const flakyUntil = (threshold) => (task, t) => { if ((t.payload._retry || 0) >= threshold) return { payload: { ok: true } }; throw new Error('transient'); };

test('§3.3 RETRY recovers a transient task within the bound', async () => {
	const { c, st } = await run({ methods: { M: { steps: [{ task: 'T::flaky', retry: 2 }] } } }, flakyUntil(2));
	assert.equal(st.done, 1, 'reached DONE after retrying');
	assert.equal(st.failed, 0);
	assert.equal(c.retried, 2, 'retried exactly twice');
	assert.equal(c.taskCalls, 3, '3 task runs (1 + 2 retries)');
});

test('§3.3 NEG: an insufficient retry bound still fails (no silent success)', async () => {
	const { c, st } = await run({ methods: { M: { steps: [{ task: 'T::flaky', retry: 1 }] } } }, flakyUntil(2));
	assert.equal(st.done, 0);
	assert.equal(st.failed, 1, 'exhausted the bound → terminal fail');
	assert.equal(c.retried, 1, 'retried once then gave up');
});

test('§3.3 ESCALATE routes a failing shard to a bigger micro-task that rejoins the flow', async () => {
	const { c, st } = await run({ methods: { M: { steps: [{ task: 'T::small', escalate: 'T::big' }] } } },
		(task) => { if (task === 'T::small') throw new Error('small-failed'); return { payload: { via: 'big' } }; });
	assert.equal(st.done, 1, 'the escalation task recovered the shard');
	assert.equal(c.escalated, 1);
	assert.equal(c.retried, 0, 'no retry declared');
});

test('§3.3 NEG: escalation that also fails terminates (no infinite escalate loop)', async () => {
	const { c, st } = await run({ methods: { M: { steps: [{ task: 'T::small', escalate: 'T::big' }] } } },
		(task) => { throw new Error(task + '-failed'); });
	assert.equal(st.done, 0);
	assert.equal(st.failed, 1, 'both small and big failed → terminal fail');
	assert.equal(c.escalated, 1, 'escalated exactly once (the _escalated flag stops a re-escalate)');
});

test('§3.3 LADDER: retry exhausts, THEN escalate recovers', async () => {
	const { c, st } = await run({ methods: { M: { steps: [{ task: 'T::small', retry: 2, escalate: 'T::big' }] } } },
		(task) => { if (task === 'T::small') throw new Error('small-failed'); return { payload: { via: 'big' } }; });
	assert.equal(st.done, 1, 'recovered via the escalation rung after retries failed');
	assert.equal(c.retried, 2, 'the retry rung ran first (bounded)');
	assert.equal(c.escalated, 1, 'then escalated once');
	assert.equal(c.taskCalls, 4, '3 small attempts + 1 big');
});

test('§3.3 ESCALATE recovers a CONTRACT blame (not just a thrown error)', async () => {
	// T::small returns a value violating the post (decision must be "ok"); the escalation returns a compliant one.
	const spec = { methods: { M: { steps: [{ task: 'T::small', escalate: 'T::big',
		contract: { read: ['x'], write: ['decision'], pre: [], post: ['decision=="ok"'], effect: 'internal' } }] } } };
	const { c, st } = await run(spec, (task) => task === 'T::small' ? { payload: { decision: 'bad' } } : { payload: { decision: 'ok' } });
	assert.equal(st.done, 1, 'the escalated task satisfied the contract');
	assert.equal(c.escalated, 1);
	assert.equal(c.blamed, 0, 'the original blame was recovered, not terminal');
});

test('§3.3 REGRESSION: a step with no recovery declared still fails fast', async () => {
	const { c, st } = await run({ methods: { M: { steps: [{ task: 'T::small' }] } } }, () => { throw new Error('failed'); });
	assert.equal(st.done, 0);
	assert.equal(st.failed, 1);
	assert.equal(c.retried, 0);
	assert.equal(c.escalated, 0);
});

test('§3.3 CRASH-RESUME: the retry counter is durable — it survives a fuel cut at every boundary', async () => {
	const spec = { methods: { M: { steps: [{ task: 'T::flaky', retry: 4 }] } } };
	const flaky = flakyUntil(4);
	for ( let fuelCut = 1; fuelCut <= 6; fuelCut++ ) {
		const net = compileMethod(spec);
		const store = createMemoryCheckpointStore();
		store.ensureRun('r', net);
		store.inject('r', [{ id: 'rec1' }]);
		let guard = 0;
		// drive in fuel-limited chunks, simulating a crash (rollbackInflight) between each.
		while ( (store.stats('r').done + store.stats('r').failed) < 1 && guard++ < 60 ) {
			await runFlow(store, 'r', net, { runTask: flaky, maxSteps: fuelCut });
			store.rollbackInflight('r');     // crash/restart recovery between chunks
		}
		assert.equal(store.stats('r').done, 1, 'retry recovered across fuel cuts at cut=' + fuelCut + ' (counter not lost/double-counted)');
		assert.ok(guard < 60, 'terminated (no infinite resume loop)');
	}
});
