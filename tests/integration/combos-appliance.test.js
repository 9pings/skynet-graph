'use strict';
/**
 * Combos C1 — the typed-QA APPLIANCE gate verification (roadmap P1 / design doc §3, §11).
 *
 * A DETERMINISTIC integration test (no GPU, no network): a canned mock-`ask` is injected and dispatches
 * on the concept's system prompt exactly like the proven smoke (scratchpad/smoke-appliance.js). It locks
 * in `lib/combos/appliance.js#createAppliance` behavior AND doubles as the appliance's product gates:
 *
 *   G1 — a typed question is ANSWERED (synthesized answer + confidence band).
 *   G2 — an untyped intake is REFUSED and the refusal NAMES the missing requirement (never a wrong answer).
 *   G4 — the SAME question replays with 0 new model calls, identical result (content-stable id fast path).
 *   Amortization — a DIFFERENT question that shares a sub-step label hits the leaf `answer` memo.
 *   §4 posture — the durable memo is ON by default and is a KNOB (opt-out with memo:false).
 *   opt-in backend — no `ask` throws (the combo needs a backend; buildAsk fails-closed).
 *   facade — reachable via `require('lib/index.js').combos.createAppliance` (same function).
 *
 * The appliance requires the engine internally; `lib/graph/index.js` defaults __SERVER__ to server, but we
 * set it explicitly (as the smoke does) so the file boots standalone regardless of load order.
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert');
const { createAppliance } = require('../../lib/combos/appliance.js');

// ── hermetic canned mock-ask (a call counter + the dispatch from the proven smoke) ────────────────────
// The ANSWER-path mock: any typed question → question kind; complexity → compound; decompose → 2 fixed
// steps; confidence → high; synthesize → 'SYNTHESIS'. `ask.count()` exposes the number of invocations.
function makeTypedMock() {
	let n = 0;
	const ask = async ( { system } ) => {
		n++;
		const s = String(system || '');
		if ( /inbound message kind/i.test(s) ) return '{"kind":"question","prose":"restated"}';
		if ( /complexityClass/.test(s) )        return '{"complexityClass":"compound"}';
		if ( /"steps"/.test(s) )                return '{"steps":["find country","recall capital"]}';
		if ( /confBand/.test(s) )               return '{"confBand":"high"}';
		if ( /Synthesize/i.test(s) )            return 'SYNTHESIS';
		return 'ANSWER';
	};
	ask.count = () => n;
	return ask;
}

// The REFUSAL-path mock: an out-of-vocab `kind` → a required miss → the intake stays untyped.
function makeUntypedMock() {
	let n = 0;
	const ask = async ( { system } ) => {
		n++;
		if ( /inbound message kind/i.test(String(system)) ) return '{"kind":"gibberish","prose":"x"}';
		return 'ANSWER';
	};
	ask.count = () => n;
	return ask;
}

const ANSWER_TIMEOUT = 30000;   // the mock resolves fast; a generous per-answer cap well under the 120s default.

// ── G1 / answer — a typed question is answered ────────────────────────────────────────────────────────
test('G1 answer: a typed question is answered (synthesis + confidence band)', async () => {
	const app = createAppliance({ ask: makeTypedMock(), maxDepth: 1 });
	try {
		const r = await app.answer('What is the capital of France?', { timeout: ANSWER_TIMEOUT });
		assert.equal(r.status, 'answered', 'a clean typed question is answered');
		assert.equal(r.answer, 'SYNTHESIS', 'the synthesized rollup answer is projected');
		assert.equal(r.confBand, 'high', 'the confidence band is projected (snapped to the high enum)');
	} finally {
		app.close();
	}
});

// ── G2 / refusal names the miss — an untyped intake refuses ───────────────────────────────────────────
test('G2 refusal: an untyped intake refuses and NAMES the missing requirement', async () => {
	const app = createAppliance({ ask: makeUntypedMock() });
	try {
		const r = await app.answer('zzz?', { timeout: ANSWER_TIMEOUT });
		assert.equal(r.status, 'refused', 'an untyped intake is refused, never wrong-answered');
		assert.equal(r.reason, 'untyped', 'the refusal reason is the intake barrier (untyped)');
		assert.ok(Array.isArray(r.missing) && r.missing.indexOf('kind') !== -1,
			'the refusal NAMES the missing decision-bearing requirement (kind)');
		assert.notEqual(r.prose, null, 'a prose narrative accompanies the typed refusal');
	} finally {
		app.close();
	}
});

// ── G4 / memo 0-call replay — the SAME question replays with 0 new model calls, identical result ───────
test('G4 memo: the same question replays with 0 new model calls, identical result', async () => {
	const ask = makeTypedMock();
	const app = createAppliance({ ask, maxDepth: 1 });
	try {
		const first = await app.answer('What is the capital of France?', { timeout: ANSWER_TIMEOUT });
		const asksAfterFirst = ask.count();
		assert.ok(asksAfterFirst > 0, 'the cold run made model calls');

		const second = await app.answer('What is the capital of France?', { timeout: ANSWER_TIMEOUT });
		const replayAsks = ask.count() - asksAfterFirst;

		assert.equal(replayAsks, 0, 'the repeat made 0 NEW model calls (content-stable id fast path)');
		assert.deepEqual(second, first, 'the replayed result is deep-equal to the first');
		assert.equal(second.status, 'answered');
		assert.equal(second.answer, 'SYNTHESIS');
	} finally {
		app.close();
	}
});

// ── Amortization — a DIFFERENT question sharing a sub-step label hits the leaf `answer` memo ───────────
// The decompose mock returns the SAME two step labels for any question, so a second, DIFFERENT question
// re-runs its own intake/root steps but its leaves HIT the first question's leaf `answer`/`confidence`/
// `evalComplexity` cache. Observed (this substrate): cold A = 9 asks / 0 hits; different B = 5 new asks /
// 6 new hits. Asserted as the qualitative invariant (some leaf hit, strictly fewer calls than a cold run)
// to lock the amortization behavior without pinning brittle exact counts.
test('Amortization: a different question sharing sub-steps hits the leaf memo', async () => {
	const ask = makeTypedMock();
	const app = createAppliance({ ask, maxDepth: 1 });
	try {
		const rA = await app.answer('What is the capital of France?', { timeout: ANSWER_TIMEOUT });
		assert.equal(rA.status, 'answered');
		const coldAsks = ask.count();
		const hitsAfterA = app.memo.stats.hits;

		const rB = await app.answer('What is the capital of Germany?', { timeout: ANSWER_TIMEOUT });
		assert.equal(rB.status, 'answered', 'the different question is also answered');
		const newAsks = ask.count() - coldAsks;
		const newHits = app.memo.stats.hits - hitsAfterA;

		assert.ok(newHits > 0, 'the different question hit the shared leaf memo (' + newHits + ' hits)');
		assert.ok(newAsks < coldAsks,
			'the shared sub-steps amortized: ' + newAsks + ' new asks < ' + coldAsks + ' cold asks');
	} finally {
		app.close();
	}
});

// ── §4 default — the durable memo is ON by default and is a KNOB (opt-out) ─────────────────────────────
test('§4 memo posture: ON by default, opt-out with memo:false', async () => {
	const on = createAppliance({ ask: makeTypedMock(), maxDepth: 1 });
	try {
		assert.ok(on.memo, 'the durable memo is ON by default (§4 posture)');
	} finally {
		on.close();
	}

	const off = createAppliance({ ask: makeTypedMock(), maxDepth: 1, memo: false });
	try {
		assert.ok(!off.memo, 'memo:false opts the cache out (a knob, not hardcoded)');
	} finally {
		off.close();
	}
});

// ── opt-in backend — no `ask` throws (the combo needs a backend) ───────────────────────────────────────
test('opt-in backend: createAppliance with no ask throws (fail-closed)', () => {
	assert.throws(() => createAppliance({}), /needs a backend/i,
		'no backend → buildAsk throws; the appliance never boots without an ask');
});

// ── facade — reachable via require(lib/index.js).combos.createAppliance (same function) ────────────────
test('facade: Graph.combos.createAppliance is the live wiring', async () => {
	const facade = require('../../lib/index.js');
	assert.equal(typeof facade.combos, 'object', 'the facade exposes a combos namespace');
	assert.equal(facade.combos.createAppliance, createAppliance,
		'the facade createAppliance is the same function as the module export');

	// smoke that it actually builds + answers through the facade path.
	const app = facade.combos.createAppliance({ ask: makeTypedMock(), maxDepth: 1 });
	try {
		const r = await app.answer('What is the capital of France?', { timeout: ANSWER_TIMEOUT });
		assert.equal(r.status, 'answered', 'the facade-built appliance answers');
		assert.equal(r.answer, 'SYNTHESIS');
	} finally {
		app.close();
	}
});
