'use strict';
/**
 * Combos C7 — the HIERARCHICAL PLAN LOOP (plugins/planner/combo.js; design WIP/2026-07-07-design-r1-plan-loop.md;
 * kill-gated R1: KG-R1a the channel + KG-R1b the fixpoint). DETERMINISTIC (no GPU, no network): a GOLD decompose
 * and a GOLD leaf ladder are injected, so the combo's orchestration is exercised end-to-end without a model. It
 * locks the C7 gates, each with a discriminating NEGATIVE control:
 *
 *   1 RECOVER      — a DEGENERATE plan (redundant + disordered leaves) is driven to the CLEAN answer, converged, monotone.
 *   2 SCISSION     — an over-budget `{bundle}` node is split (E2), its atoms served, the answer complete.
 *   3 REFUSE       — a SEVERED leaf (a required fact amputated) is REFUSED at projection: it is `REFUSED` in the
 *                    answer (never a silent value) and named in `refused`. NEG: the same leaf un-severed → a real value.
 *   4 REASSEMBLE   — checkReassembly is sound (the root reads only covered ids).
 *   5 ESCALATION   — serveLeaf IS the ladder: a leaf the local stock misses ESCALATES to the frontier (LOAD-BEARING,
 *                    the KG-R1a finding — C-local alone is model-capability-bound). NEG: a covered leaf serves local at 0 escalations.
 *   6 GUARDS       — no decompose / no serveLeaf → throws.
 *   7 FACADE       — Graph.combos.createPlanLoop is the live function.
 *   8 DETERMINISM  — the same task yields the same answer + trace.
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlanLoop, sinkFold } = require('../../plugins/planner/combo.js');

const GOLD = { A: 1, B: 2, C: 3, D: 4 };
const CLEAN = 'A=1;B=2;C=3;D=4';
// a leaf's TYPED request (the fusion key + writes derive from it), and a decompose NODE wrapping one.
const reqBody = ( id, extra ) => Object.assign({ id: id, agg: 'sum', filters: [{ col: 'k', val: id }] }, extra || {});
const req = ( id ) => ({ id: 'n_' + id, request: reqBody(id), nl: 'fig ' + id });

// a GOLD leaf ladder: a covered id serves LOCAL; an uncovered ("hard") id ESCALATES to the frontier. Counts both.
function goldLadder( localCovers ) {
	const n = { local: 0, escalated: 0 };
	const serveLeaf = async ( leaf ) => {
		const id = leaf.request.id;
		if ( localCovers.has(id) ) { n.local++; return GOLD[id]; }
		n.escalated++; return GOLD[id];                              // frontier ground-truth
	};
	return { serveLeaf, n };
}

test('1 RECOVER — a redundant + disordered plan converges to the clean answer (monotone)', async () => {
	const { serveLeaf } = goldLadder(new Set(['A', 'B', 'C', 'D']));
	// degenerate: root implied, leaves reversed + duplicated
	const decompose = async () => [req('B'), req('A'), req('A'), req('C'), req('D'), req('B')];
	const loop = createPlanLoop({ decompose, serveLeaf });
	const r = await loop.run('report');
	assert.equal(r.answer, CLEAN, 'the fixpoint dedupes to the clean fold');
	assert.equal(r.converged, true);
	assert.equal(r.monotone, true, 'the lexicographic measure stays monotone (E2-before-E1)');
	assert.equal(r.leaves, 4, 'the 2 duplicates are gone');
	assert.equal(r.refusal, null);
});

test('2 SCISSION — an over-budget bundle node is split and its atoms served', async () => {
	const { serveLeaf } = goldLadder(new Set(['A', 'B', 'C', 'D']));
	const decompose = async () => [req('A'), req('B'), { id: 'bnd', bundle: [reqBody('C'), reqBody('D')] }];
	const loop = createPlanLoop({ decompose, serveLeaf });
	const r = await loop.run('report');
	assert.equal(r.answer, CLEAN, 'the bundle split into C and D, both served');
	assert.equal(r.leaves, 4);
	assert.equal(r.converged, true);
});

test('3 REFUSE — a severed leaf is REFUSED, never silently valued (NEG: un-severed → real value)', async () => {
	const { serveLeaf } = goldLadder(new Set(['A', 'B', 'C', 'D']));
	const severed = { id: 'A', agg: 'sum', filters: [{ col: 'k', val: null }] };   // required val amputated
	const loop = createPlanLoop({ decompose: async () => [{ id: 'A', request: severed }, req('B'), req('C'), req('D')], serveLeaf });
	const r = await loop.run('report');
	assert.match(r.answer, /A=REFUSED/, 'the severed figure is refused in the fold');
	assert.doesNotMatch(r.answer, /A=1/, 'no silent value for the severed figure');
	assert.deepEqual(r.refused, ['A'], 'the refused id is named');
	// NEG control: the same figure un-severed folds a real value
	const ok = createPlanLoop({ decompose: async () => [req('A'), req('B'), req('C'), req('D')], serveLeaf });
	assert.equal((await ok.run('report')).answer, CLEAN);
});

test('4 REASSEMBLE — checkReassembly is sound on a covered plan', async () => {
	const { serveLeaf } = goldLadder(new Set(['A', 'B', 'C', 'D']));
	const loop = createPlanLoop({ decompose: async () => [req('A'), req('B'), req('C'), req('D')], serveLeaf });
	const r = await loop.run('report');
	assert.equal(r.reassembly.sound, true);
	assert.equal(r.reassembly.uncovered.length, 0);
});

test('5 ESCALATION is LOAD-BEARING — an uncovered leaf escalates to the frontier (NEG: covered → 0 escalations)', async () => {
	const ladder = goldLadder(new Set(['A', 'B', 'C']));                  // D is NOT locally covered → must escalate
	const loop = createPlanLoop({ decompose: async () => [req('A'), req('B'), req('C'), req('D')], serveLeaf: ladder.serveLeaf });
	const r = await loop.run('report');
	assert.equal(r.answer, CLEAN, 'the escalated leaf still yields the right value');
	assert.equal(ladder.n.escalated, 1, 'exactly the uncovered leaf escalated (escalation load-bearing)');
	// NEG: fully covered → zero escalations
	const covered = goldLadder(new Set(['A', 'B', 'C', 'D']));
	await createPlanLoop({ decompose: async () => [req('A'), req('B'), req('C'), req('D')], serveLeaf: covered.serveLeaf }).run('report');
	assert.equal(covered.n.escalated, 0, 'a fully covered plan escalates nothing');
});

test('6 GUARDS — a missing stage throws', () => {
	assert.throws(() => createPlanLoop({ serveLeaf: async () => 0 }), /decompose/);
	assert.throws(() => createPlanLoop({ decompose: async () => [] }), /serveLeaf/);
});

test('7 FACADE — reachable via the library facade', () => {
	const facade = require('../../lib/index.js');
	assert.equal(typeof facade.combos.createPlanLoop, 'function');
	assert.equal(facade.combos.createPlanLoop, createPlanLoop);
});

test('8 DETERMINISM — the same task yields the same answer and trace', async () => {
	const build = () => createPlanLoop({ decompose: async () => [req('C'), req('A'), req('A'), req('B'), req('D')], serveLeaf: goldLadder(new Set(['A', 'B', 'C', 'D'])).serveLeaf });
	const a = await build().run('report'), b = await build().run('report');
	assert.equal(a.answer, b.answer);
	assert.equal(a.answer, CLEAN);
	assert.deepEqual(a.trace, b.trace);
});

test('9 PROJECTION — a leaf that reads another leaf’s write is served AFTER it, with the upstream value completed', async () => {
	// B readsExtra [A] → the projection serves A first, then B WITH A's value in its bounded context (the R1 §2 projection).
	const order = [];
	const serveLeaf = async ( leaf ) => {
		order.push(leaf.request.id);
		if ( leaf.request.id === 'A' ) return 10;
		if ( leaf.request.id === 'B' ) { assert.ok(leaf.inputs && leaf.inputs.A === 10, 'B is served WITH A’s value completed into its bounded context'); return leaf.inputs.A + 5; }
		return GOLD[leaf.request.id];
	};
	// declared B-before-A on purpose → the ORDER must emerge from the dependency, not the decompose order.
	const decompose = async () => [{ id: 'n_B', request: reqBody('B'), nl: 'fig B', readsExtra: ['A'] }, req('A')];
	const r = await createPlanLoop({ decompose, serveLeaf }).run('report');
	assert.equal(r.projected, true, 'the projection path was taken (an intra-plan dependency exists)');
	assert.deepEqual(order, ['A', 'B'], 'A served BEFORE B — emergent dependency order, not decompose order');
	assert.match(r.answer, /A=10/); assert.match(r.answer, /B=15/, 'B folded the value it computed FROM A (context completed)');
	assert.equal(r.converged, true);
	// NEG: drop the dependency → the flat fast path (no projection), both served independently
	const flat = await createPlanLoop({ decompose: async () => [req('A'), { id: 'n_B', request: reqBody('B'), nl: 'fig B' }], serveLeaf: goldLadder(new Set(['A', 'B'])).serveLeaf }).run('report');
	assert.equal(flat.projected, false, 'no intra-plan dependency → the direct serve fast path (degenerate projection)');
});

test('10 CYCLIC FOOTPRINT — a circular readsExtra is a typed refusal, never a hang', async () => {
	// A reads B, B reads A → the projection guard refuses (falls back to flat serve), then rebalance E3 surfaces CYCLE.
	const serveLeaf = async ( leaf ) => GOLD[leaf.request.id];
	const decompose = async () => [{ id: 'n_A', request: reqBody('A'), nl: 'a', readsExtra: ['B'] }, { id: 'n_B', request: reqBody('B'), nl: 'b', readsExtra: ['A'] }];
	const r = await createPlanLoop({ decompose, serveLeaf }).run('report');
	assert.equal(r.refusal, 'CYCLE', 'the cyclic footprint is a typed refusal (never a silent wedge, never a hang)');
});

test('11 FALLBACK — a DEGENERATE decompose (untyped echo / empty) serves WHOLE, FLAGGED; strictly opt-in', async () => {
	// the Q6 failure surface: the decomposer echoes the task as ONE untyped leaf (no request.kind) — a failed
	// split means "don't split": with opts.fallback the whole task is served and the result is flagged.
	const neverServed = async () => { throw new Error('leaf must not be served on the fallback path'); };
	const echo = async () => [{ id: 'n_echo', request: { id: 'echo' }, nl: 'the whole task again' }];
	const r = await createPlanLoop({ decompose: echo, serveLeaf: neverServed, fallback: async ( task ) => 'WHOLE:' + task }).run('report');
	assert.equal(r.answer, 'WHOLE:report'); assert.equal(r.fallback, true); assert.equal(r.refusal, null);
	const empty = await createPlanLoop({ decompose: async () => [], serveLeaf: neverServed, fallback: async () => 'W' }).run('t');
	assert.equal(empty.answer, 'W'); assert.equal(empty.fallback, true);
	// NEG — without opts.fallback the behavior is UNCHANGED (the echo leaf is served normally, no flag).
	const noFb = await createPlanLoop({ decompose: echo, serveLeaf: async ( leaf ) => 'v_' + leaf.request.id }).run('report');
	assert.notEqual(noFb.fallback, true);
	assert.match(String(noFb.answer), /echo=v_echo/);
	// NEG — a HEALTHY multi-leaf plan with opts.fallback wired does NOT fall back.
	const healthy = await createPlanLoop({ decompose: async () => [req('A'), req('B')], serveLeaf: goldLadder(new Set(['A', 'B'])).serveLeaf, fallback: async () => 'W' }).run('t');
	assert.notEqual(healthy.fallback, true);
});

test('12 SINKFOLD — the answer is the LAST SINK value (nobody reads it); a refused sink is skipped', async () => {
	// "the LAST part yields the final answer" plans (KG-ZOOM): A is read by B → B is the sink, its value IS the answer.
	const serveLeaf = async ( leaf ) => leaf.request.id === 'B' ? 42 : 1;
	const decompose = async () => [req('A'), { id: 'n_B', request: reqBody('B'), nl: 'fig B', readsExtra: ['A'] }];
	const r = await createPlanLoop({ decompose, serveLeaf, fold: sinkFold }).run('report');
	assert.equal(r.answer, '42');
	// NEG — a SEVERED sink (null required field → refused) is skipped by the fold, never folded as a value.
	const dec2 = async () => [req('A'), { id: 'n_B', request: reqBody('B'), nl: 'b', readsExtra: ['A'] },
		{ id: 'n_C', request: reqBody('C', { col: null }), nl: 'c' }];
	const r2 = await createPlanLoop({ decompose: dec2, serveLeaf, fold: sinkFold }).run('report');
	assert.equal(r2.answer, '42', 'the refused sink C is skipped — the fold falls back to the healthy sink');
});

test('13 LABELS — ctx.labels renders provenance next to the labelled input (the cells rule) and rides to serveLeaf', async () => {
	// B reads A's write AND a labelled cell given: the projected prompt renders `c1_1_rev=1500 (revenue · 2007)`;
	// the produced input (step-id keyed in the projection prompt) stays BARE — structured provenance only.
	const seen = {};
	const serveLeaf = async ( leaf ) => { seen[leaf.request.id] = leaf; return 7; };
	const decompose = async () => [req('A'), { id: 'n_B', request: reqBody('B'), nl: 'fig B', readsExtra: ['A', 'c1_1_rev'] }];
	const r = await createPlanLoop({ decompose, serveLeaf }).run('report',
		{ givens: { c1_1_rev: 1500 }, labels: { c1_1_rev: 'revenue · 2007' } });
	assert.equal(r.refusal, null);
	assert.match(String(seen.B.prompt), /c1_1_rev=1500 \(revenue · 2007\)/, 'the labelled given carries its provenance in the projected prompt');
	assert.equal(String(seen.B.prompt).indexOf('=7 ('), -1, 'the unlabelled upstream input stays bare');
	assert.deepEqual(seen.B.labels, { c1_1_rev: 'revenue · 2007' }, 'labels ride to a host serveLeaf that renders its own prompt');
});
