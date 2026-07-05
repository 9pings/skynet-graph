'use strict';
/*
 * selftest.js — Probe #1 mechanics, DETERMINISTIC (real engine, injected content fns, no GPU) — the Laurie
 * gates at the mechanics level, each provable BEFORE any live spend:
 *   1. SEED from param-DISJOINT episodes → the LGG holes exactly the param positions, role-typed slots.
 *   2. UNSEEN param combo → ZERO-FIRE mount (eval 0 / expand 0) + the leaves COMPUTE from the NEW params
 *      (param-flow — the mount is not a replay of seed values; deterministic leaf execution).
 *   3. PARAM-SHUFFLE null (Laurie 7): swapped params → swapped answers — the params are load-bearing.
 *   4. STARVED mount (Laurie 5): missing param → typed impracticable + hint naming the role; NOTHING mounted,
 *      NO provider fires (off-diagonal starved→complete-answer = 0 by construction at this level).
 *   5. COMPLETE task is never falsely refused (false-impracticable = 0 on the covered case).
 *   6. DETERMINISM: the whole flow twice → identical.
 */
const assert = require('node:assert/strict');
const Graph = require('../../../../tests/_boot.js');
const { nextStable } = require('../../../../lib/authoring/supervise.js');
const { makeTypedDecomposeProviders } = require('../../../../lib/authoring/typed-loop.js');
const { seedMethod, slotBindings, mountParametric, paramLoopConceptTree } = require('./mechanics.js');
console.log = console.log.bind(console); console.info = console.warn = () => {};

const KINDS = { enum: ['aggregate', 'check', 'emit'] };
const DATA = { overdue: 3, paid: 5, open: 2, closed: 7, blocked: 11, done: 4 };   // the deterministic "dataset"
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, x ) => Object.assign({ _id: id, originNode: o, targetNode: t }, x);

// the deterministic "model": compare(dimA,dimB) → [aggregate(A), aggregate(B), check, emit]; leaves compute
// from DATA — content is DETERMINISTIC given the typed params (the Laurie-8b fork, chosen and attributed).
function contentFns( counters ) {
	return {
		stepKinds: KINDS, maxDepth: 2, stepFacts: ['group'],
		evalFn  : () => { counters.eval++; return { atomic: false }; },
		expandFn: ( s ) => { counters.expand++; return [
			{ stepKind: 'aggregate', group: s._.dimA }, { stepKind: 'aggregate', group: s._.dimB },
			{ stepKind: 'check' }, { stepKind: 'emit' } ]; },
		answerFn: ( s ) => { counters.answer++; return s._.group ? 'cnt:' + DATA[s._.group] : 'ok:' + s._.stepKind; },
	};
}

async function mountAndSettle( gen, slots, params, counters, label ) {
	Graph._providers = Object.assign({}, makeTypedDecomposeProviders(contentFns(counters)));
	const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] },
		{ label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: paramLoopConceptTree(['dimA', 'dimB']) });
	const m = mountParametric(gen, slots, { rootId: 'M1', origin: 'X', target: 'Y', create: true,
		facts: { stepKind: 'compare', dimA: params['aggregate#0'], dimB: params['aggregate#1'] } }, params);
	if ( m.status !== 'complete' ) return { m, g };
	g.pushMutation(m.mutation);
	await nextStable(g);
	return { m, g };
}
const leafAnswers = ( g ) => (g.getEtty('M1')._.expandedInto || []).map(( id ) => g.getEtty(id)._.answer);

async function run() {
	// ── 1. SEED (param-DISJOINT episodes: {overdue,paid} ∩ {open,closed} = ∅ — Laurie 4a) ────────────────
	const cSeed = { eval: 0, expand: 0, answer: 0 };
	const { candidate, gen, error } = await seedMethod({
		paramKeys: ['dimA', 'dimB'],
		seed: { lastRev: 0, nodes: [node('S1'), node('G1'), node('S2'), node('G2')],
			segments: [seg('T1', 'S1', 'G1', { stepKind: 'compare', dimA: 'overdue', dimB: 'paid' }),
			           seg('T2', 'S2', 'G2', { stepKind: 'compare', dimA: 'open', dimB: 'closed' })] },
		providers: makeTypedDecomposeProviders(contentFns(cSeed)),
	});
	assert.ok(!error, 'seed admitted: ' + error);
	assert.ok(gen.stable, 'the two per-combo templates share ONE skeleton (LGG stable)');
	const slots = slotBindings(gen);
	assert.equal(slots.length, 2, 'exactly the two param positions holed — nothing else varies');
	assert.deepEqual(slots.map(( s ) => s.role).sort(), ['aggregate#0', 'aggregate#1'], 'role-typed slots (kind + position)');
	assert.ok(slots.every(( s ) => s.key === 'group'), 'the holes sit on the typed content key');
	console.log('PASS 1 — seed: param-disjoint episodes → 2 role-typed slots on `group` (the LGG holes = the slots)');

	// ── 2. UNSEEN combo → ZERO-FIRE + param-flow ─────────────────────────────────────────────────────────
	const c2 = { eval: 0, expand: 0, answer: 0 };
	const { m: m2, g: g2 } = await mountAndSettle(gen, slots, { 'aggregate#0': 'blocked', 'aggregate#1': 'done' }, c2, 'unseen');
	assert.equal(m2.status, 'complete', 'covered task is not falsely refused (false-impracticable = 0)');
	assert.equal(c2.eval, 0, 'ZERO-FIRE: eval never fires on the mount');
	assert.equal(c2.expand, 0, 'ZERO-FIRE: expand never fires on the mount (never re-decomposes)');
	assert.equal(c2.answer, 4, 'content exactly at the 4 leaves');
	const ans2 = leafAnswers(g2);
	assert.equal(ans2[0], 'cnt:11', 'leaf 0 computed from the NEW param (blocked=11) — not a seed replay');
	assert.equal(ans2[1], 'cnt:4', 'leaf 1 computed from the NEW param (done=4)');
	console.log('PASS 2 — unseen combo (blocked,done): ZERO-FIRE mount, leaves compute cnt:11/cnt:4 from the NEW params');

	// ── 3. PARAM-SHUFFLE null: swapped params → swapped answers (params are load-bearing) ───────────────
	const c3 = { eval: 0, expand: 0, answer: 0 };
	const { g: g3 } = await mountAndSettle(gen, slots, { 'aggregate#0': 'done', 'aggregate#1': 'blocked' }, c3, 'shuffle');
	const ans3 = leafAnswers(g3);
	assert.equal(ans3[0], 'cnt:4');
	assert.equal(ans3[1], 'cnt:11');
	assert.notDeepEqual([ans2[0], ans2[1]], [ans3[0], ans3[1]], 'the shuffle null: role placement changes the answers');
	console.log('PASS 3 — param-shuffle null: swapped roles → swapped answers (params load-bearing, roles matter)');

	// ── 4. STARVED: missing dimB → typed hint, NOTHING mounted, NO provider fire ────────────────────────
	const c4 = { eval: 0, expand: 0, answer: 0 };
	const { m: m4, g: g4 } = await mountAndSettle(gen, slots, { 'aggregate#0': 'blocked' }, c4, 'starved');
	assert.equal(m4.status, 'impracticable', 'starved → typed refusal');
	assert.deepEqual(m4.hint, [{ role: 'aggregate#1', key: 'group', stepKind: 'aggregate' }],
		'the HINT names the missing role/sort — « il me manque une sorte X en rôle Y »');
	assert.equal(g4.getEtty('M1'), undefined, 'NOTHING mounted (never a partial mount)');
	assert.equal(c4.eval + c4.expand + c4.answer, 0, 'NO provider fires on a starved mount (off-diagonal = 0)');
	console.log('PASS 4 — starved (dimB absent): impracticable + hint {aggregate#1, group}, zero mutation, zero fire');

	// ── 5. DETERMINISM: the whole flow twice → identical ────────────────────────────────────────────────
	const cB = { eval: 0, expand: 0, answer: 0 };
	const again = await seedMethod({
		paramKeys: ['dimA', 'dimB'],
		seed: { lastRev: 0, nodes: [node('S1'), node('G1'), node('S2'), node('G2')],
			segments: [seg('T1', 'S1', 'G1', { stepKind: 'compare', dimA: 'overdue', dimB: 'paid' }),
			           seg('T2', 'S2', 'G2', { stepKind: 'compare', dimA: 'open', dimB: 'closed' })] },
		providers: makeTypedDecomposeProviders(contentFns(cB)),
	});
	assert.deepEqual(slotBindings(again.gen), slots, 'seed → slots deterministic RUN1≡RUN2');
	const c5 = { eval: 0, expand: 0, answer: 0 };
	const { g: g5 } = await mountAndSettle(again.gen, slots, { 'aggregate#0': 'blocked', 'aggregate#1': 'done' }, c5, 'again');
	assert.deepEqual(leafAnswers(g5), ans2, 'mount → answers deterministic RUN1≡RUN2');
	console.log('PASS 5 — determinism: seed→slots and mount→answers identical across runs');

	console.log('\nALL MECHANICS GATES PASS — the parametric-mount seam is live-ready (the live protocol adds: real intake extraction, dispatch/selection, the BLEND baseline on the 11-production residual, injection arms — per the Laurie protocol).');
}

run().then(() => process.exit(0), ( e ) => { console.error('FAIL:', e.message); process.exit(1); });
