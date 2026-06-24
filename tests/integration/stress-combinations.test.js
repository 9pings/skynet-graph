'use strict';
/**
 * STRESS / COMBINATION battery (2026-06-24). The per-brick unit + integration suite is
 * green and non-vacuous (audited). These tests instead push the INTEGRATION SEAMS where
 * several proven bricks compose, plus two subtle PROPERTIES the methodology flags:
 *
 *   1. Git-for-reasoning under churn — add→add→patch→partial-rollback→full-rollback over
 *      ONE graph, asserting BOTH fact-state AND the concept-library return *exactly* to
 *      each checkpoint, with structural cascade-retraction in between (N6 #11.c.2 +
 *      self-mod #10/#11 + nested-childConcepts cascade, finding #10(b)).
 *   2. Apply-cap is a BACKSTOP, not a killer (finding #15 dual-use): a CONVERGING
 *      iterative-trial finishes clean (never flagged) while a true runaway trips
 *      `divergent` — same cap. Discrimination is the property, not "it caps".
 *   3. The logodds semiring fold is ORDER-INVARIANT at scale (E1 commutative-monoid /
 *      Théorème 1) AND {__push} fan-in is race-free with 40 concurrent contributors.
 *   4. The tree-decomposition tiling is a CHECKED contract end-to-end: forkPlan derives
 *      each fork's frontier alphabet, every fork's clean projection passes, and any
 *      internal-fact leak across that frontier is flagged (P4 + Tier-4 auto-tiling).
 *
 * No core change is under test — this is robustness-of-composition. If any test reveals a
 * real engine limit it is a finding to log, not necessarily a thing to "fix" here.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createSemiring, semiringConceptTree } = require('../../lib/providers');
const { forkPlan } = require('../../lib/authoring/decompose');
const { validateMergeProjection } = require('../../lib/authoring/validate');

console.log = console.info = console.warn = () => {};

const seg = (g) => g._objById['seg']._etty;
const distSeed = () => ({
	lastRev: 0,
	nodes: [{ _id: 'a' }, { _id: 'b' }],
	segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
});

// ---------------------------------------------------------------------------
// 1. Git-for-reasoning under churn — multi-checkpoint add/patch/rollback.
//    Distance.inKm=400 so: Far(>300)✓ VeryFar(>350)✓ UltraFar(>380)✓ ; patch Far(>500)✗.
//    r0 = base ; r1 = after VeryFar added ; then UltraFar added, Far patched, two rollbacks.
// ---------------------------------------------------------------------------
test('STRESS: add→add→patch→rollback(r1)→rollback(r0) returns facts AND concept-lib to each checkpoint', async () => {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {
		Far: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] }
	} } };

	let phase = 0, r0 = null, r1 = null;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('churn-versioning timed out at phase ' + phase)), 20000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		new Graph(distSeed(), {
			label: 'stress-churn', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						r0 = g.getCurrentRevision();
						assert.equal(seg(g)._.Far, true, 'Far cast at r0');
						g.addConcept('Far', { _id: 'VeryFar', _name: 'VeryFar', require: 'Far', assert: ['$Distance.inKm > 350'] });
					} else if (phase === 1) {
						phase = 2;
						assert.equal(seg(g)._.VeryFar, true, 'VeryFar cast after add');
						r1 = g.getCurrentRevision();
						g.addConcept('VeryFar', { _id: 'UltraFar', _name: 'UltraFar', require: 'VeryFar', assert: ['$Distance.inKm > 380'] });
					} else if (phase === 2) {
						phase = 3;
						assert.equal(seg(g)._.UltraFar, true, 'UltraFar (grandchild) cast after add');
						// tighten Far -> Far uncasts -> structural cascade uncasts VeryFar + UltraFar (nested children, finding #10b)
						g.patchConcept('Far', { assert: ['$Distance.inKm > 500'] });
					} else if (phase === 3) {
						phase = 4;
						assert.ok(!seg(g)._.Far, 'Far uncast after tightening to >500');
						assert.ok(!seg(g)._.VeryFar, 'VeryFar cascade-uncast (its parent Far fell)');
						assert.ok(!seg(g)._.UltraFar, 'UltraFar cascade-uncast (grandparent fell)');
						g.rollbackTo(r1);                              // back to: Far(>300)+VeryFar, before UltraFar/patch
					} else if (phase === 4) {
						phase = 5;
						assert.equal(seg(g)._.Far, true, 'Far re-cast — patch reverted to >300');
						assert.deepEqual(g.getConceptByName('Far')._schema.assert, ['$Distance.inKm > 300'], 'Far schema reverted');
						assert.equal(seg(g)._.VeryFar, true, 'VeryFar restored (present at r1)');
						assert.ok(g._conceptLib['VeryFar'], 'VeryFar still in the lib at r1');
						assert.ok(!seg(g)._.UltraFar, 'UltraFar gone (added after r1) — not resurrected');
						assert.ok(!g._conceptLib['UltraFar'], 'UltraFar removed from the lib (N6)');
						g.rollbackTo(r0);                              // back to base: Far only
					} else if (phase === 5) {
						clearTimeout(timer);
						assert.equal(seg(g)._.Far, true, 'Far cast at base');
						assert.ok(!seg(g)._.VeryFar, 'VeryFar gone (added after r0)');
						assert.ok(!g._conceptLib['VeryFar'], 'VeryFar removed from the lib at r0 (N6)');
						assert.ok(!g._conceptLib['UltraFar'], 'UltraFar still gone');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});

// ---------------------------------------------------------------------------
// 2. Apply-cap dual-use: a converging trial vs a runaway, SAME cap.
// ---------------------------------------------------------------------------
test('STRESS: a CONVERGING iterative-trial finishes clean (never flagged divergent), under the same cap', async () => {
	// re-casts itself (unsets its self-flag) twice, then CONVERGES at n=3 by keeping the flag -> cast-once -> settle.
	Graph._providers = { Trial: { go(graph, concept, scope, argz, cb) {
		const n = (scope._.trialN || 0) + 1;
		if (n < 3) cb(null, { $_id: '_parent', Trial: null, trialN: n });   // iterate (re-cast)
		else cb(null, { $_id: '_parent', Trial: true, trialN: n });         // converge (stop)
	} } };
	const conceptMap = { common: { childConcepts: {
		Trial: { _id: 'Trial', _name: 'Trial', require: 'Distance', provider: ['Trial::go'] }
	} } };
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('converging trial never settled')), 12000);
		new Graph(distSeed(), {
			label: 'stress-converge', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			applyCap: 5,
			onStabilize(g) {
				if (seg(g)._.Trial !== true) return;       // wait for convergence
				clearTimeout(timer);
				try {
					assert.equal(seg(g)._.trialN, 3, 'trial iterated exactly to convergence (3 applies < cap 5)');
					assert.ok(!seg(g)._.divergent, 'a CONVERGING trial is never flagged divergent (backstop, not killer)');
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, conceptMap);
	});
});

test('STRESS: a true runaway under the SAME cap trips divergent (the discrimination)', async () => {
	// never converges: unsets its self-flag every apply -> the apply-cap must fire.
	Graph._providers = { Loop: { go(graph, concept, scope, argz, cb) {
		cb(null, { $_id: '_parent', Loop: null, loopN: (scope._.loopN || 0) + 1 });
	} } };
	const conceptMap = { common: { childConcepts: {
		Loop: { _id: 'Loop', _name: 'Loop', require: 'Distance', provider: ['Loop::go'] }
	} } };
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('runaway NOT bounded — cap never fired')), 12000);
		new Graph(distSeed(), {
			label: 'stress-runaway', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			applyCap: 5,
			onStabilize(g) {
				if (!seg(g)._.divergent) return;
				clearTimeout(timer);
				try {
					const rec = seg(g)._.divergent.find((d) => d && d.concept === 'Loop' && d.reason === 'apply-cap');
					assert.ok(rec, 'the runaway tripped the apply-cap and recorded WHY');
					assert.ok(!seg(g)._.Trial, 'distinct from the converging-trial case');
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, conceptMap);
	});
});

// ---------------------------------------------------------------------------
// 3. logodds order-invariance at scale + race-free {__push} fan-in (E1 monoid).
// ---------------------------------------------------------------------------
test('STRESS: logodds fold is order-invariant across 12 seeded shuffles of 40 race-free contributions', async () => {
	const pushProv = { Src: { push(graph, concept, scope, argz, cb) {
		cb(null, [{ $_id: '_parent', Contrib: true }, { $$_id: 'pool', contribs: { __push: scope._.w } }]);
	} } };
	Graph._providers = Object.assign({}, createSemiring(), pushProv);
	const cfg = { label: 'stress-semiring', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
	const tree = { common: { childConcepts: {
		Contrib: { _id: 'Contrib', _name: 'Contrib', require: ['src'], provider: ['Src::push'] },
		PoolRoot: { _id: 'PoolRoot', _name: 'PoolRoot', require: ['PoolRoot'],
			childConcepts: semiringConceptTree({ semiring: 'logodds', require: ['PoolRoot'] }).childConcepts }
	} } };

	const N = 40;
	const weights = Array.from({ length: N }, (_, i) => ((i % 7) - 3) * 0.1); // mix of +/- log-odds increments
	const expected = weights.reduce((s, w) => s + w, 0);

	// deterministic re-run (methodology §2.5): a seeded LCG, not Math.random
	const lcg = (seed) => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };
	const shuffle = (arr, rnd) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

	const rnd = lcg(20260624);
	for (let trial = 0; trial < 12; trial++) {
		const order = shuffle(weights, rnd);
		const seed = { lastRev: 0, nodes: [{ _id: 'pool', PoolRoot: true, expected: N, contribs: [] }]
			.concat(order.map((w, i) => ({ _id: 's' + i, src: true, w }))), segments: [] };
		const g = new Graph(seed, cfg, tree);
		await nextStable(g);
		const pool = g._objById['pool']._etty._;
		assert.equal(pool.Reduce, true, 'trial ' + trial + ': Reduce cast — the cardinality gate saw all 40 (race-free fan-in)');
		assert.equal(pool.n, N, 'trial ' + trial + ': all 40 contributions landed (no {__push} race-loss at scale)');
		assert.ok(Math.abs(pool.acc - expected) < 1e-9, 'trial ' + trial + ': Σ⊕ order-invariant (' + pool.acc + ' vs ' + expected + ')');
		assert.ok(Math.abs(pool.value - 1 / (1 + Math.exp(-expected))) < 1e-9, 'trial ' + trial + ': readout σ(Σw) invariant');
	}
});

// ---------------------------------------------------------------------------
// 4. Tiling-as-contract end-to-end: every derived fork frontier is a checked contract.
// ---------------------------------------------------------------------------
test('STRESS: forkPlan derives per-fork frontier alphabets and validateMergeProjection enforces each as a contract', () => {
	// 4 weakly-coupled domains sharing two bridge facts {cost, risk}; one fork (supply) runs a
	// solver whose INTERNAL `steps` must NOT cross the frontier (barrier).
	const tree = { childConcepts: {
		Diagnose:   { _id: 'Diagnose', _name: 'Diagnose', require: ['symptom'], ensure: ['$risk != null'], applyMutations: [{ $_id: '_parent', diagnosis: true }] },
		TravelRisk: { _id: 'TravelRisk', _name: 'TravelRisk', require: ['distance'], ensure: ['$risk != null', '$mode != null'] },
		TravelCost: { _id: 'TravelCost', _name: 'TravelCost', require: ['distance'], ensure: ['$cost != null', '$mode != null'] },
		Reorder:    { _id: 'Reorder', _name: 'Reorder', require: ['stock'], ensure: ['$cost != null'], applyMutations: [{ $_id: '_parent', order: true, steps: 0 }] }
	} };
	const plan = forkPlan(tree);
	assert.deepEqual(plan.separators, ['cost', 'risk'], 'the two bridge facts are the derived interface');
	assert.equal(plan.forks.length, 3, 'three tiles');

	// every fork: a projection of exactly its frontier is CLEAN; any off-frontier key is a leak.
	for (const f of plan.forks) {
		const clean = { $$_id: 'p' };
		for (const k of f.frontier) clean[k] = 'x';
		assert.equal(
			validateMergeProjection(clean, { frontierAlphabet: f.frontier }).warnings.length, 0,
			'fork [' + f.concepts.join(',') + '] frontier [' + f.frontier.join(',') + '] projects clean'
		);
		// inject an internal fact the fork does NOT export -> must be flagged frontier-leak
		const leaky = Object.assign({ steps: 99 }, clean);
		const leaks = validateMergeProjection(leaky, { frontierAlphabet: f.frontier }).warnings.filter((w) => w.kind === 'frontier-leak');
		assert.equal(leaks.length, 1, 'fork [' + f.concepts.join(',') + ']: an internal `steps` leak is caught by the contract');
	}

	// the continuous-vs-snapped axis: a raw float crossing is an advisory continuous-crossing
	const cont = validateMergeProjection({ $$_id: 'p', cost: 0.73 }, { frontierAlphabet: ['cost'], flagContinuous: true });
	assert.ok(cont.warnings.some((w) => w.kind === 'continuous-crossing'), 'a raw float across the frontier is flagged (snap before gating, C1/E4)');
});
