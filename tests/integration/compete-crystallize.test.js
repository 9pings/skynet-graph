'use strict';
/**
 * §6.1 MULTI-PATH CONSTRUCT — the dominance-gated competitive crystallizer (spec §6.1, refined by the 2026-06-30
 * Laurie confront). RESIDENCY = isolated forks (ZERO-CORE; the co-resident in-core SubGraph stays FILED — true
 * co-residency = ATMS multi-context, and its only justifying case is the non-local frontier contract.js G1 already
 * forbids). A multi-path Construct proposes a SET of candidate decompositions; pareto SELECTS the survivor; the
 * survivor's decomposition crystallizes into a re-mountable Method so the next same-class problem dispatches the
 * winner at 0 calls — eliding the WHOLE N-way rollout (a bigger amortization than the single-path kill-gate).
 *
 * The load-bearing soundness line (Laurie pt2): crystallizing the survivor with `pre:[]` is candidate elimination
 * (Mitchell 1982) with the NEGATIVES (the losing siblings) discarded → a silent MIS-DISPATCHER. The fix reifies the
 * SELECTION CRITERION, not the siblings:
 *   • crystallize ONLY on CLEAN DOMINANCE (`front.length===1`); a Pareto TIE (front>1) → a FLAT marker → the miner
 *     SKIPS it (the existing flat-patch-skip IS the tie-gate — a sibling was equally good, the pick is arbitrary);
 *   • a winner that FLIPS for the same premise P → two templates for one signature → `signatureDetermined` REFUSES
 *     (no false crystallization, no mis-dispatch). Winner-determinacy lifted from content-determinacy.
 * ZERO-CORE: a provider over `paretoSelect` (semiring.js) + the kill-gate crystallize/dispatch pipeline.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { crystallizeStructural, adopt } = require('../../lib/authoring/learning/crystallize.js');
const { makeCompeteProvider } = require('../../lib/authoring/core/compete.js');
console.log = console.info = console.warn = () => {};

// the winner's STRUCTURAL decomposition (a bounded multi-object sub-graph, base-derived ids so relativize holes it).
function decompFor( strategy ) {
	return function ( base, o, t ) {
		const m = base + '_w';
		return [
			{ _id: m, Node: true, role: 'winner', strategy },
			{ _id: base + '_c0', Segment: true, originNode: o, targetNode: m, parentSeg: base },
			{ _id: base + '_c1', Segment: true, originNode: m, targetNode: t, parentSeg: base },
		];
	};
}
const CRITERIA = { cost: { dir: 'min' } };                              // realized cost, lower is better
const STRATS = ['quick', 'refactor', 'rewrite'];
const cands = ( costs ) => STRATS.map(( s ) => ({ id: s, cost: costs[s], decomp: decompFor(s) }));

// a counted provider: `propose` returns the candidates (by a host cost table); the winner is selected by paretoSelect.
function detCompete( costFor ) {
	const calls = [];
	const propose = ( scope ) => { calls.push(scope._._id); return cands(costFor(scope._)); };
	const { Compete } = makeCompeteProvider({ propose, criteria: CRITERIA, discriminantKey: 'taskClass' });
	return { Compete, calls };
}
const TREE = { childConcepts: {
	Compete: { _id: 'Compete', _name: 'Compete', require: ['Segment', 'taskClass'], ensure: ['!$Competed'], provider: ['Compete::compete'] },
} };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, taskClass ) => ({ _id: id, originNode: o, targetNode: t, taskClass });
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

// ── REGIME-1: a winner determined by the typed premise → crystallise + amortise (the whole rollout elided) ──
test('§6.1 — a clean-dominance survivor (winner = f(premise)) crystallises + re-mounts on a fresh same-class problem at 0 calls', async () => {
	// for taskClass 'fast', 'quick' strictly dominates (cost 1) on EVERY instance → winner determined by the premise.
	const { Compete, calls } = detCompete(() => ({ quick: 1, refactor: 3, rewrite: 5 }));
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'fast'), seg('E2', 'A', 'B', 'fast') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Compete }, equivKeys: ['Competed'], idFor: () => 'CrystalCompete', declaredFrontier: DECL });
	assert.equal(res.admitted, true, 'the competitive survivor crystallises into a Method');
	const learnt = calls.length;
	assert.ok(learnt >= 2, 'cold competition ran the rollout on each instance');

	// adopt into a FRESH grammar; a new same-class problem E4 re-mounts the WINNER decomposition at 0 NEW rollouts.
	Graph._providers = {};
	const g2 = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'fast') ] },
		{ label: 'kg', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts: {} } });
	await adopt(g2, res.candidate);
	await nextStable(g2);
	assert.equal(calls.length, learnt, '0 NEW rollouts — the crystal re-mounts the learned winner (the whole compete is elided)');
	assert.ok(g2._objById['E4_w'], 'the winner node is re-mounted on the fresh problem');
	assert.equal(g2._objById['E4_w']._etty._.strategy, 'quick', 'the winning strategy (quick) is the re-mounted decomposition');
	assert.equal(g2._objById['E4']._etty._.CrystalCompete, true, 'crystal cast marker set (no re-fire / divergence)');
});

// ── the LOAD-BEARING neg control: a winner that FLIPS for the same premise must NOT crystallise (the mis-dispatch bug) ──
test('§6.1 NEG (load-bearing) — same premise P, winner FLIPS between instances → REFUSED (no silent mis-dispatcher)', async () => {
	// both segments are taskClass 'fast' but the realised winner flips by a LATENT factor (NOT the premise):
	// E1 → quick dominates; E2 → rewrite dominates. Same signature, two winner templates → signatureDetermined refuses.
	const { Compete } = detCompete(( s ) => s._id === 'E1' ? { quick: 1, refactor: 3, rewrite: 5 } : { quick: 5, refactor: 3, rewrite: 1 });
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'fast'), seg('E2', 'A', 'B', 'fast') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Compete }, equivKeys: ['Competed'], idFor: () => 'CrystalCompete', declaredFrontier: DECL });
	assert.equal(res.admitted, false, 'a winner not determined by the premise is NOT crystallised — the silent mis-dispatcher is refused');
});

// ── the TIE neg control: a Pareto trade-off (no single dominator) → flat marker → not minable ──
test('§6.1 NEG — a Pareto TIE (no clean dominator) emits a FLAT marker → the miner skips it (no arbitrary crystallisation)', async () => {
	// quick and rewrite TIE (both cost 1, mutually non-dominated) → front.length===2 → flat marker → not crystallisable.
	const { Compete } = detCompete(() => ({ quick: 1, refactor: 3, rewrite: 1 }));
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'fast'), seg('E2', 'A', 'B', 'fast') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Compete }, equivKeys: ['Competed'], idFor: () => 'CrystalCompete', declaredFrontier: DECL });
	assert.equal(res.admitted, false, 'a tie (equally-good sibling) is not crystallised — the pick would be arbitrary (unsound)');

	// but the cast still completes (no divergence / apply-cap runaway) — the head marker is set even on a tie.
	Graph._providers = {};
	const g = new Graph(seed, { label: 'tie', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: TREE });
	Graph._providers = { Compete };
	await nextStable(g);
	assert.equal(g._objById['E1']._etty._.Competed, true, 'the tie still casts (a flat marker) — bounded, no divergence');
	assert.ok(!g._objById['E1_w'], 'no structural winner decomposition emitted on a tie');
	assert.ok(g.getRevisions().length < 50, 'bounded (no apply-cap runaway)');
});
