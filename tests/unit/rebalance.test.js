'use strict';
/**
 * rebalance — the R1 rebalancing fixpoint (E2∘E1∘E3∘E4 under a lexicographic termination measure). Mirrors
 * the KG-R1b kill-gate (WIP/experiments/2026-07-07-kg-r1b-fixpoint): the 4 degeneracies recover, the measure
 * stays monotone (the E2-before-E1 finding is a REGRESSION here), the negative-control severed leaf REFUSES
 * (never silently folded), an injected retractable cycle is rejected TYPED, and checkReassembly has teeth.
 * Every claim carries a NEGATIVE CONTROL.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../plugins/planner/lib/rebalance.js');
const { stableStringify } = require('../../lib/providers/cache.js');

// ── a minimal self-contained plan domain (a leaf produces one figure id → value; the root folds them) ──
let uid = 0;
const leaf = ( id, val ) => ({ id: 'n' + (++uid), kind: 'leaf', req: { id, f: id }, val: String(val) });
const bundle = ( parts ) => ({ id: 'n' + (++uid), kind: 'leaf', over: true, parts });   // an over-budget 2-figure node
const root = ( reads ) => ({ id: 'n' + (++uid), kind: 'root', reads: reads.slice(), value: null });

const spec = {
	isLeaf: ( n ) => n.kind === 'leaf',
	fusionKey: ( n ) => stableStringify(n.req),
	overBudget: ( n ) => !!n.over,
	split: ( n ) => n.parts.map(( p, i ) => ({ id: n.id + '_' + i, kind: 'leaf', req: { id: p.id, f: p.id }, val: String(p.val) }) ),
	writes: ( n ) => n.over ? n.parts.map(( p ) => p.id ) : [n.req.id],
	reads: ( n ) => n.kind === 'root' ? (n.reads || []) : (n.readsExtra || []),
	refold: ( c, leaves ) => leaves.map(( l ) => l.over ? '(bundle)' : (l.severed ? l.req.id + '=REFUSED' : l.req.id + '=' + l.val) ).sort().join(';'),
	contractOf: ( n ) => n.kind === 'root'
		? { name: n.id, contract: { read: (n.reads || []).concat(n.readsExtra || []), write: ['summary'], effect: 'pure' } }
		: { name: n.id, contract: { read: (n.readsExtra || []), write: n.over ? n.parts.map(( p ) => p.id ) : [n.req.id], effect: n.retract ? 'effect' : 'pure' } },
};

const foldOf = ( plan ) => plan.order.find(( n ) => n.kind === 'root' ).value;
const nLeaves = ( plan ) => plan.order.filter(( n ) => n.kind === 'leaf' ).length;
const CLEAN_FOLD = 'A=1;B=2;C=3;D=4';   // fold of leaves A..D

function clean() { uid = 0; return { order: [leaf('A', 1), leaf('B', 2), leaf('C', 3), leaf('D', 4), root(['A', 'B', 'C', 'D'])] }; }

test('E1 fusion — a redundant plan dedupes to the clean leaf set, converges, monotone, fold recovered', () => {
	const p = { order: [leaf('A', 1), leaf('A', 1), leaf('B', 2), leaf('B', 2), leaf('C', 3), leaf('D', 4), root(['A', 'B', 'C', 'D'])] };
	const out = R.rebalancePlan(p, spec);
	assert.equal(out.converged, true, 'reaches the balanced fixpoint');
	assert.equal(out.monotone, true, 'lexicographic measure non-increasing');
	assert.equal(out.refusal, null);
	assert.equal(nLeaves(out.plan), 4, 'the 2 duplicates are gone');
	assert.equal(foldOf(out.plan), CLEAN_FOLD, 'the root fold matches the clean plan');
});

test('E2 scission — an over-budget bundle splits into within-budget atoms', () => {
	const p = { order: [bundle([{ id: 'A', val: 1 }, { id: 'B', val: 2 }]), leaf('C', 3), leaf('D', 4), root(['A', 'B', 'C', 'D'])] };
	const out = R.rebalancePlan(p, spec);
	assert.equal(out.converged, true);
	assert.equal(out.monotone, true);
	assert.equal(nLeaves(out.plan), 4, 'the bundle is now 2 atoms');
	assert.equal(out.plan.order.every(( n ) => !spec.overBudget(n) ), true, 'nothing over budget');
	assert.equal(foldOf(out.plan), CLEAN_FOLD);
});

test('E3 reorder — a disordered plan (root first, leaves reversed) puts the root last', () => {
	uid = 0;
	const p = { order: [root(['A', 'B', 'C', 'D']), leaf('D', 4), leaf('C', 3), leaf('B', 2), leaf('A', 1)] };
	const out = R.rebalancePlan(p, spec);
	assert.equal(out.converged, true);
	assert.equal(out.monotone, true);
	assert.equal(out.plan.order[out.plan.order.length - 1].kind, 'root', 'root moved to the end');
	assert.equal(foldOf(out.plan), CLEAN_FOLD);
});

test('COMBINED (the E2-before-E1 regression) — bundle+redundant+disordered still converges MONOTONE', () => {
	// the bundle atoms (A,B) DUPLICATE the redundant dups (A,B) — E1-before-E2 would GROW the measure here.
	uid = 0;
	const p = { order: [root(['A', 'B', 'C', 'D']), leaf('B', 2), leaf('A', 1), leaf('C', 3), leaf('D', 4),
		bundle([{ id: 'A', val: 1 }, { id: 'B', val: 2 }])] };
	const out = R.rebalancePlan(p, spec);
	assert.equal(out.converged, true, 'converges');
	assert.equal(out.monotone, true, 'MONOTONE — the split-then-dedupe ordering holds (KG-R1b finding)');
	assert.equal(nLeaves(out.plan), 4, 'deduped to the clean leaf set');
	assert.equal(foldOf(out.plan), CLEAN_FOLD);
});

test('NEGATIVE CONTROL — a severed leaf is REFUSED in the fold, never silently valued', () => {
	uid = 0;
	const sev = Object.assign(leaf('A', 1), { severed: true });   // its required fact was amputated
	const p = { order: [sev, leaf('B', 2), leaf('C', 3), leaf('D', 4), root(['A', 'B', 'C', 'D'])] };
	const out = R.rebalancePlan(p, spec);
	assert.equal(out.converged, true);
	assert.match(foldOf(out.plan), /A=REFUSED/, 'the severed figure is refused, not guessed');
	assert.doesNotMatch(foldOf(out.plan), /A=1/, 'no silent value for the severed figure');
	// non-vacuity: the SAME leaf un-severed folds a real value
	uid = 0;
	const ok = R.rebalancePlan({ order: [leaf('A', 1), leaf('B', 2), leaf('C', 3), leaf('D', 4), root(['A', 'B', 'C', 'D'])] }, spec);
	assert.match(foldOf(ok.plan), /A=1/, 'un-severed → real value (control is not vacuous)');
});

test('E3 cycle rejection — an injected RETRACTABLE back-edge is refused TYPED, not oscillated', () => {
	uid = 0;
	// a retractable leaf that READS the root's `summary` write → root→back→root cycle
	const back = Object.assign(leaf('A', 1), { retract: true, readsExtra: ['summary'] });
	const p = { order: [back, leaf('B', 2), leaf('C', 3), root(['A', 'B', 'C']) ] };
	const out = R.rebalancePlan(p, spec);
	assert.equal(out.refusal, 'CYCLE', 'the illegal cycle is a typed refusal');
	assert.equal(out.converged, false, 'not silently balanced');
	// negative control: the SAME plan without the back-edge is acyclic and converges
	uid = 0;
	const ok = R.rebalancePlan({ order: [leaf('A', 1), leaf('B', 2), leaf('C', 3), root(['A', 'B', 'C'])] }, spec);
	assert.equal(ok.refusal, null);
	assert.equal(ok.converged, true);
});

test('checkReassembly — sound on real pairs; uncovered read → refused; contradictory contract → unsound', () => {
	uid = 0;
	const leaves = [leaf('A', 1), leaf('B', 2)];
	const r = root(['A', 'B']);
	const ok = R.checkReassembly(r, leaves, spec);
	assert.equal(ok.sound, true, 'folding the producers into the consumer is sound');
	// uncovered: the root reads a GHOST id no leaf writes → not sound (claim-of-absence blocked)
	const ghost = R.checkReassembly(root(['A', 'B', 'ghost']), leaves, spec);
	assert.equal(ghost.sound, false);
	assert.deepEqual(ghost.uncovered, ['ghost']);
	// teeth: a producer whose post CONTRADICTS the consumer pre → checkCompose 'unsound'
	const contra = { verdict: require('../../lib/authoring/core/contract.js').checkCompose(
		{ name: 'p', contract: { read: [], write: ['A'], pre: [], post: ['A==0'], effect: 'pure' } },
		{ name: 'c', contract: { read: ['A'], write: ['s'], pre: ['A==5'], post: ['s'], effect: 'pure' } }).verdict };
	assert.equal(contra.verdict, 'unsound', 'checkCompose catches a contradictory contract (not vacuous)');
});

test('determinism — the same degenerate plan rebalances identically across runs', () => {
	const build = () => { uid = 0; return { order: [leaf('B', 2), leaf('A', 1), leaf('A', 1), bundle([{ id: 'C', val: 3 }, { id: 'D', val: 4 }]), root(['A', 'B', 'C', 'D'])] }; };
	const a = R.rebalancePlan(build(), spec), b = R.rebalancePlan(build(), spec);
	assert.equal(foldOf(a.plan), foldOf(b.plan));
	assert.equal(a.rounds, b.rounds);
	assert.deepEqual(a.trace, b.trace);
	assert.equal(foldOf(a.plan), CLEAN_FOLD);
});
