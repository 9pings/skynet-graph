'use strict';
/**
 * The CheckpointStore CONTRACT suite — the durable marking + content-memo + lease-queue semantics that EVERY
 * backend impl must satisfy (convergence study §5). Run against the memory impl (tests/unit) and the SQLite
 * impl on :memory: (tests/integration), so both backends are pinned to ONE behavioural contract. The SQLite
 * file-durability + real crash-resume live in the integration file (they need a temp file on disk).
 *
 * Methodology: one sub-test per claim + a NEGATIVE CONTROL (the case that SHOULD fail / not-fire does).
 * Time is injected (clock.t) so lease-expiry is deterministic — no wall-clock flake.
 *
 * @param label     a prefix for the sub-test names ('memory' / 'sqlite')
 * @param makeStore (opts) => store     — opts.now is the injected clock; the backend file/handle is the
 *                  factory's concern. May return { store, close } or a bare store (close optional).
 */
function runCheckpointContract( label, makeStore, deps ) {
	const test = deps.test;
	const assert = deps.assert;

	// open a fresh store bound to a mutable clock; return { s, clock, done }
	function open() {
		const clock = { t: 1000 };
		const made = makeStore({ now: () => clock.t });
		const s = made.store || made;
		const close = made.close || (s.close ? () => s.close() : () => {});
		return { s, clock, done: close };
	}

	test(`[${label}] inject seeds tokens at the start place; marking reflects them`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', sinks: ['end'] });
			const toks = s.inject('r1', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
			assert.equal(toks.length, 3, 'one token per record');
			assert.ok(toks.every(( t ) => t.placeId === 'start' && t.status === 'ready'), 'all at start, ready');
			assert.deepEqual(toks.map(( t ) => t.recordId).sort(), ['a', 'b', 'c'], 'recordIds carried');
			const m = s.marking('r1');
			assert.equal(m.start.length, 3, 'marking shows 3 at start');
		} finally { done(); }
	});

	test(`[${label}] claim leases ready tokens; a held lease is NOT re-offered (negative control)`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start' });
			s.inject('r1', [{ id: 'a' }, { id: 'b' }]);
			const first = s.claim('r1', { limit: 1, lease: 5000 });
			assert.equal(first.length, 1, 'leased exactly limit=1');
			assert.equal(first[0].status, 'leased', 'status flips to leased');
			assert.equal(first[0].attempts, 1, 'attempt counted on claim');
			const second = s.claim('r1', { limit: 5, lease: 5000 });
			assert.equal(second.length, 1, 'only the OTHER ready token is offered — the held one is not');
			assert.notEqual(second[0].id, first[0].id, 'a different token');
			// negative control: nothing ready and no lease expired → empty claim
			assert.equal(s.claim('r1', { limit: 5, lease: 5000 }).length, 0, 'no claimable tokens remain');
		} finally { done(); }
	});

	test(`[${label}] lease expiry re-offers the token (crash-resume at token granularity); not before (neg ctrl)`, () => {
		const { s, clock, done } = open();
		try {
			s.ensureRun('r1', { start: 'start' });
			s.inject('r1', [{ id: 'a' }]);
			const c1 = s.claim('r1', { limit: 1, lease: 5000 });
			assert.equal(c1.length, 1, 'claimed');
			// negative control: before the lease expires, NOT re-offered
			clock.t += 4999;
			assert.equal(s.claim('r1', { limit: 1, lease: 5000 }).length, 0, 'lease still held → not re-offered');
			// past expiry → re-offered, attempts bumped
			clock.t += 2;
			const c2 = s.claim('r1', { limit: 1, lease: 5000 });
			assert.equal(c2.length, 1, 'expired lease re-offered (the worker is assumed crashed)');
			assert.equal(c2[0].id, c1[0].id, 'same token');
			assert.equal(c2[0].attempts, 2, 'a re-claim is a retry');
		} finally { done(); }
	});

	test(`[${label}] move 1->1 relabels the token to the next place (identity preserved for audit)`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', sinks: ['end'] });
			s.inject('r1', [{ id: 'a' }]);
			const [t] = s.claim('r1', { limit: 1, lease: 5000 });
			const moved = s.move(t, 'mid');
			assert.equal(moved.id, t.id, 'same token id (it walks the net)');
			assert.equal(moved.placeId, 'mid', 'now at mid');
			assert.equal(moved.status, 'ready', 'ready to be claimed at the next place');
			const m = s.marking('r1');
			assert.ok(!m.start || m.start.length === 0, 'left the start place');
			assert.equal(m.mid.length, 1, 'at mid');
		} finally { done(); }
	});

	test(`[${label}] move to a SINK marks the token done (terminal, not claimable)`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', sinks: ['end'] });
			s.inject('r1', [{ id: 'a' }]);
			const [t] = s.claim('r1', { limit: 1, lease: 5000 });
			const moved = s.move(t, 'end');
			assert.equal(moved.status, 'done', 'a sink move is terminal');
			assert.equal(s.claim('r1', { limit: 5, lease: 5000 }).length, 0, 'a done token is not claimable');
			assert.equal(s.stats('r1').done, 1, 'one case finished');
		} finally { done(); }
	});

	test(`[${label}] move 1->N fans out (>1 token/record), children carry recordId + parentId`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', sinks: ['end'] });
			s.inject('r1', [{ id: 'a' }]);
			const [t] = s.claim('r1', { limit: 1, lease: 5000 });
			const kids = s.move(t, ['b1', 'b2', 'b3']);
			assert.equal(kids.length, 3, 'three child tokens spawned');
			assert.ok(kids.every(( k ) => k.recordId === 'a'), 'all children belong to the same record');
			assert.ok(kids.every(( k ) => k.parentId === t.id), 'children link to the parent for audit');
			assert.ok(kids.every(( k ) => k.status === 'ready' && k.attempts === 0), 'children start fresh + ready');
			assert.deepEqual(kids.map(( k ) => k.placeId).sort(), ['b1', 'b2', 'b3'], 'one per out-place');
			const m = s.marking('r1');
			assert.equal((m.b1 || []).length + (m.b2 || []).length + (m.b3 || []).length, 3, 'three live tokens at the out-places');
			// the source is consumed (no longer at start, not ready)
			assert.equal((m.start || []).filter(( x ) => x.status === 'ready').length, 0, 'source consumed');
		} finally { done(); }
	});

	test(`[${label}] fan-out with per-child payloads gives each child its OWN element (the map case)`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', sinks: ['end'] });
			s.inject('r1', [{ id: 'a', shared: 'X' }]);
			const [t] = s.claim('r1', { limit: 1, lease: 5000 });
			const kids = s.move(t, ['body', 'body', 'body'], { payloads: [{ shared: 'X', elem: 'e0' }, { shared: 'X', elem: 'e1' }, { shared: 'X', elem: 'e2' }] });
			assert.deepEqual(kids.map(( k ) => k.payload.elem).sort(), ['e0', 'e1', 'e2'], 'each child carries its own element');
			assert.ok(kids.every(( k ) => k.payload.shared === 'X' && k.recordId === 'a'), 'shared context + recordId preserved per child');
		} finally { done(); }
	});

	test(`[${label}] move carries a payload patch forward`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start' });
			s.inject('r1', [{ id: 'a', n: 1 }]);
			const [t] = s.claim('r1', { limit: 1, lease: 5000 });
			const moved = s.move(t, 'mid', { payload: { n: 2, extra: 'x' } });
			assert.equal(moved.payload.n, 2, 'payload field updated');
			assert.equal(moved.payload.extra, 'x', 'payload field added');
		} finally { done(); }
	});

	test(`[${label}] a stale move (lease re-claimed by another worker) is ignored — no marking corruption`, () => {
		const { s, clock, done } = open();
		try {
			s.ensureRun('r1', { start: 'start' });
			s.inject('r1', [{ id: 'a' }]);
			const [stale] = s.claim('r1', { limit: 1, lease: 5000 });   // worker 1 claims
			clock.t += 6000;                                            // worker 1 "crashes" → lease expires
			const [fresh] = s.claim('r1', { limit: 1, lease: 5000 });   // worker 2 re-claims the same token
			assert.equal(fresh.id, stale.id, 'same token, re-leased');
			const zombie = s.move(stale, 'wrong-place');                // worker 1 wakes up and tries to move
			assert.equal(zombie, null, 'the stale (out-of-lease) move is rejected');
			const m = s.marking('r1');
			assert.ok(!m['wrong-place'], 'the marking was NOT corrupted by the zombie');
			assert.equal(m.start[0].status, 'leased', 'still held by worker 2');
		} finally { done(); }
	});

	test(`[${label}] content-addressed memo: hit by key, MISS on a different key (negative control)`, () => {
		const { s, done } = open();
		try {
			assert.equal(s.memoGet('k1'), undefined, 'cold miss');
			s.memoSet('k1', { answer: 42 });
			assert.deepEqual(s.memoGet('k1'), { answer: 42 }, 'hit returns the stored output');
			assert.equal(s.memoGet('k2'), undefined, 'a DIFFERENT key misses — no false replay (C5)');
			// idempotent overwrite by the same key (same canonical input → same slot)
			s.memoSet('k1', { answer: 42 });
			assert.deepEqual(s.memoGet('k1'), { answer: 42 }, 'stable under re-set');
		} finally { done(); }
	});

	test(`[${label}] fail routes a token to the dead-letter place with a reason`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', fail: 'failed' });
			s.inject('r1', [{ id: 'a' }]);
			const [t] = s.claim('r1', { limit: 1, lease: 5000 });
			const dead = s.fail(t, 'provider gave up');
			assert.equal(dead.status, 'failed', 'dead-lettered');
			assert.equal(dead.placeId, 'failed', 'at the fail place');
			assert.equal(dead.reason, 'provider gave up', 'reason recorded (defeasible / inspectable)');
			assert.equal(s.claim('r1', { limit: 5, lease: 5000 }).length, 0, 'a failed token is not claimable');
			assert.equal(s.stats('r1').failed, 1, 'one failure');
		} finally { done(); }
	});

	test(`[${label}] createdRefs tracked during a step; rollbackInflight undoes IN-FLIGHT only (neg ctrl)`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', sinks: ['end'] });
			s.inject('r1', [{ id: 'a' }, { id: 'b' }]);
			// token A: claimed + a side-effect ref tracked, then a crash leaves it in-flight (leased)
			const [a] = s.claim('r1', { limit: 1, lease: 5000 });
			s.track(a, [{ etty: 'Doc', id: 'doc-A' }]);
			// token B: claimed, tracked, and cleanly MOVED to a sink (done) — must NOT be rolled back
			const [b] = s.claim('r1', { limit: 1, lease: 5000 });
			const moved = s.move(b, 'end', { created: [{ etty: 'Doc', id: 'doc-B' }] });
			assert.equal(moved.status, 'done', 'B finished cleanly');

			const rb = s.rollbackInflight('r1');
			assert.deepEqual(rb.created, [{ etty: 'Doc', id: 'doc-A' }], 'only the IN-FLIGHT refs are returned to undo');
			assert.deepEqual(rb.reset.sort(), [a.id], 'only the in-flight token was reset');
			// A is back to ready (clean re-run); B stays done (negative control)
			const m = s.marking('r1');
			assert.equal(m.start.find(( x ) => x.id === a.id).status, 'ready', 'A reset to ready for a clean re-run');
			assert.equal(m.end.find(( x ) => x.id === b.id).status, 'done', 'B untouched');
			// the in-flight refs were cleared, so a second rollback returns nothing
			assert.equal(s.rollbackInflight('r1').created.length, 0, 'idempotent — refs cleared');
		} finally { done(); }
	});

	test(`[${label}] maxAttempts dead-letters a poison token instead of re-leasing forever`, () => {
		const { s, clock, done } = open();
		try {
			s.ensureRun('r1', { start: 'start', fail: 'failed' });
			s.inject('r1', [{ id: 'a' }]);
			// lease + let it expire repeatedly; with maxAttempts=2 the 3rd offer dead-letters
			s.claim('r1', { limit: 1, lease: 1000, maxAttempts: 2 }); clock.t += 1001;  // attempt 1
			s.claim('r1', { limit: 1, lease: 1000, maxAttempts: 2 }); clock.t += 1001;  // attempt 2
			const c3 = s.claim('r1', { limit: 1, lease: 1000, maxAttempts: 2 });
			assert.equal(c3.length, 0, 'a poison token is NOT re-leased past maxAttempts');
			assert.equal(s.stats('r1').failed, 1, 'it was dead-lettered');
		} finally { done(); }
	});

	test(`[${label}] runs are isolated — claim/marking never cross runId (negative control)`, () => {
		const { s, done } = open();
		try {
			s.ensureRun('r1', { start: 'start' });
			s.ensureRun('r2', { start: 'start' });
			s.inject('r1', [{ id: 'a' }]);
			s.inject('r2', [{ id: 'x' }]);
			const c = s.claim('r1', { limit: 10, lease: 5000 });
			assert.equal(c.length, 1, 'only r1 tokens claimed');
			assert.equal(c[0].recordId, 'a', 'r2 not leaked into r1');
			assert.equal((s.marking('r2').start || []).length, 1, 'r2 marking intact');
		} finally { done(); }
	});
}

module.exports = { runCheckpointContract };
