'use strict';
/**
 * §6.1 SELECTION-K1 live-measure BACKBONE (deterministic fence; the gitignored live arm is
 * doc/WIP/experiments/2026-07-01-flex-live-measures/measure-selection-k1.js). The live measure on qwen3-8b (temp 0)
 * measured the SELECTION-K1 fraction — is the pareto-competition WINNER a function of the typed signature Σ={taskClass}
 * (crystallizable, elides the N-way rollout) or of the untyped surface (refuse)? Result, hardened by the Laurie confront
 * (two axes, C3 disambiguation):
 *   dedupe          → winner `set` constant, clean-dominant       → REGIME-1 (crystallizable, reuse=4)
 *   membership      → winner `hashmap` constant but Pareto-TIED   → determined-but-tied (the tie-gate soundly refuses)
 *   word-frequency  → winner flips scan/hashmap across surface    → undetermined (signatureDetermined refuses)
 *   ⇒ SELECTION-K1 (winner-determinacy) = 2/3; CRYSTALLIZABLE (∧ clean-dominance) = 1/3.
 *
 * This fence reproduces those verdicts deterministically over the REAL `paretoSelect` (semiring.js) + `digest`
 * (canonicalize.js), with the winner-determinacy predicate mirrored from `mine.js:392-398` (winner-determinacy lifted
 * from content-determinacy, per compete.js) — the SAME rule the tracked `compete-crystallize.test.js` proves on the
 * real crystallizer. The load-bearing NEG control = a clean-dominant flip both sides ⇒ the predicate refuses (the
 * mis-dispatch prevention the live borderline set tie-gated instead of triggering cleanly).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paretoSelect } = require('../../lib/providers/semiring.js');
const { digest } = require('../../lib/providers/canonicalize.js');

const CRITERIA = { cost: { dir: 'min' }, risk: { dir: 'min' }, quality: { dir: 'max' } };
// run the REAL pareto competition over a candidate set → { winnerMethod, front, sig }.
function sel( cands ) {
	const s = paretoSelect(cands, CRITERIA, { idKey: 'id' });
	const w = cands.find(( c ) => c.id === s.selectedId ) || s.selected;
	return { winnerMethod: w.method, front: s.front.length, sig: digest({ method: w.method }) };
}
// the winner-determinacy predicate — mirrored from mine.js:392-398, applied to WINNERS grouped by Σ-digest.
function signatureDetermined( obs ) {
	const byDigest = {};
	for ( const o of obs ) { if ( byDigest[o.sigmaDigest] === undefined ) byDigest[o.sigmaDigest] = o.sig; else if ( byDigest[o.sigmaDigest] !== o.sig ) return false; }
	return true;
}
const SIG = ( taskClass ) => digest({ taskClass });

// candidate-set fixtures reproducing the live qwen3-8b competitions (winner, front) per class.
const set_wins    = [{ id: 'a', method: 'set', cost: 1, risk: 1, quality: 5 }, { id: 'b', method: 'sort', cost: 3, risk: 2, quality: 3 }, { id: 'c', method: 'scan', cost: 2, risk: 3, quality: 2 }]; // set clean-dominant → front 1
const hashmap_tie = [{ id: 'a', method: 'hashmap', cost: 1, risk: 2, quality: 5 }, { id: 'b', method: 'set', cost: 2, risk: 1, quality: 5 }, { id: 'c', method: 'scan', cost: 3, risk: 3, quality: 2 }]; // hashmap/set Pareto-tie → front 2, winner hashmap (lex cost)
const scan_tie    = [{ id: 'a', method: 'scan', cost: 1, risk: 1, quality: 4 }, { id: 'b', method: 'hashmap', cost: 2, risk: 1, quality: 5 }, { id: 'c', method: 'sort', cost: 4, risk: 3, quality: 2 }]; // scan/hashmap tie → front 2, winner scan (lex cost)
const hashmap_dom = [{ id: 'a', method: 'hashmap', cost: 1, risk: 1, quality: 5 }, { id: 'b', method: 'scan', cost: 2, risk: 2, quality: 3 }]; // hashmap clean-dominant → front 1

test('§6.1 backbone: dedupe = REGIME-1 (winner constant + clean-dominant → crystallizable)', () => {
	const obs = [set_wins, set_wins, set_wins, set_wins].map(( c ) => ({ sigmaDigest: SIG('dedupe'), ...sel(c) }));
	assert.ok(obs.every(( o ) => o.winnerMethod === 'set' ), 'the winner is `set` across all four surfaces');
	assert.ok(obs.every(( o ) => o.front === 1 ), 'each competition has a clean Pareto dominator (front 1)');
	assert.equal(signatureDetermined(obs), true, 'winner = f(Σ) → determined');
	// determined ∧ clean-dominance → REGIME-1 (crystallizes once, dispatches subsequent same-Σ instances at 0 calls).
});

test('§6.1 backbone: membership = DETERMINED-BUT-TIED (winner constant, Pareto tie → tie-gate refuses, not latency)', () => {
	const obs = [hashmap_tie, hashmap_tie, hashmap_tie].map(( c ) => ({ sigmaDigest: SIG('membership'), ...sel(c) }));
	assert.ok(obs.every(( o ) => o.winnerMethod === 'hashmap' ), 'the winner IS Σ-determined (`hashmap` every time)');
	assert.equal(signatureDetermined(obs), true, 'determined on the winner axis');
	assert.ok(obs.every(( o ) => o.front === 2 ), 'but each competition is a Pareto TIE (set≈hashmap for membership) → front 2');
	// determined ∧ ¬clean-dominance → the TIE-GATE (flat-skip) soundly refuses an arbitrary pick — NOT undetermined latency.
});

test('§6.1 backbone: word-frequency = UNDETERMINED (winner flips scan/hashmap across surface → signatureDetermined refuses)', () => {
	const obs = [scan_tie, hashmap_dom, scan_tie].map(( c ) => ({ sigmaDigest: SIG('word-frequency'), ...sel(c) }));
	assert.deepEqual(obs.map(( o ) => o.winnerMethod ), ['scan', 'hashmap', 'scan'], 'the winner flips across surface (the live scan/hashmap split)');
	assert.equal(signatureDetermined(obs), false, 'two winners for one Σ → NOT determined → REFUSE (no mis-dispatch)');
});

test('§6.1 backbone: the two fractions (winner-determinacy 2/3, crystallizable 1/3) — the honest ceiling', () => {
	const classes = [
		{ name: 'dedupe',        cands: [set_wins, set_wins, set_wins, set_wins] },
		{ name: 'membership',    cands: [hashmap_tie, hashmap_tie, hashmap_tie] },
		{ name: 'word-frequency', cands: [scan_tie, hashmap_dom, scan_tie] },
	].map(( c ) => {
		const obs = c.cands.map(( x ) => ({ sigmaDigest: SIG(c.name), ...sel(x) }));
		const determined = signatureDetermined(obs), cleanDom = obs.every(( o ) => o.front === 1 );
		return { name: c.name, determined, regime1: determined && cleanDom };
	});
	const detFrac = classes.filter(( c ) => c.determined ).length / classes.length;
	const cryFrac = classes.filter(( c ) => c.regime1 ).length / classes.length;
	assert.equal(detFrac.toFixed(2), '0.67', 'SELECTION-K1 (winner-determinacy) = 2/3 (dedupe + membership) — matches the live run');
	assert.equal(cryFrac.toFixed(2), '0.33', 'CRYSTALLIZABLE (∧ clean-dominance) = 1/3 (only dedupe) — the tie-gate & the flip cost the other two');
});

test('§6.1 backbone NEG (load-bearing): a CLEAN-DOMINANT flip both sides ⇒ signatureDetermined REFUSES (mis-dispatch prevention)', () => {
	// the genuine NC-refuse: two same-Σ instances, front==1 BOTH (no tie-gate), winner flips → the gate must catch it.
	const twoPtrDom = [{ id: 'a', method: 'two-pointer', cost: 1, risk: 1, quality: 5 }, { id: 'b', method: 'hashmap', cost: 3, risk: 3, quality: 2 }];
	const a = sel(hashmap_dom), b = sel(twoPtrDom);
	assert.equal(a.front, 1); assert.equal(b.front, 1);   // both clean-dominant → the tie-gate does NOT fire
	assert.notEqual(a.winnerMethod, b.winnerMethod, 'the winner flips (hashmap → two-pointer) on the same Σ');
	assert.equal(signatureDetermined([{ sigmaDigest: SIG('nc'), sig: a.sig }, { sigmaDigest: SIG('nc'), sig: b.sig }]), false,
		'two clean-dominant winners for one Σ → signatureDetermined refuses (the mis-dispatch the tie-gate would NOT have caught)');
});
