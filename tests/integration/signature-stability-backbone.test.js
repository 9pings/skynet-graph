'use strict';
/**
 * SIGNATURE-STABILITY backbone (deterministic fence; the gitignored live arm is
 * doc/WIP/experiments/2026-07-01-signature-stability/live.js — real makeLocalAsk on vibethinker-3b).
 *
 * The decisive gate for the composed roadmap's 2-phase minimum (studies/2026-07-01-composed-roadmap.md):
 * everything downstream (dispatch, cache, call-elision, method reuse) keys on the intake `FactsDigest`, so
 * if paraphrases of ONE task fragment the digest the memo never hits. This backbone proves the MEASUREMENT
 * PLUMBING — the REAL `Intake::type` provider (lib/providers/intake.js) feeding the real signature-stability
 * profiler (lib/authoring/learning/emittability.js) — deterministically, without the GPU, by driving the provider
 * with stub `ask`s of DESIGNED behavior. The live arm swaps the stub for the model; the numbers there are
 * the empirical finding, but the mechanism is fenced here.
 *
 * The load-bearing thing it fences (Laurie confront): the profiler catches BOTH failure modes — fragmentation
 * (cheap) AND the correctness-fatal COLLISION / mode-collapse that a naive within-task metric reports as
 * perfect stability. And the SOTA/(a)-vs-(b) split: format-closure (constrained → typed) is the trivial
 * half; the free-text arm fails on FORMAT, so netting format out (crossArmAgreement) is required to speak to
 * the semantic half.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIntake } = require('../../lib/providers');
const E = require('../../lib/authoring/learning/emittability');

// ── the signature schema (two closed enums) ─────────────────────────────────────────────────────────
const FACTS = {
	bugClass: { enum: ['logic', 'concurrency', 'memory', 'config', 'dependency', 'io'] },
	severity: { enum: ['low', 'medium', 'high'] },
};
const REQUIRED = ['bugClass', 'severity'];

// two latent tasks, 3 paraphrases each, each paraphrase carrying the cues a real classifier keys on.
const GROUPS_INPUT = [
	{ taskId: 'config-high', inputs: [
		'The app crashes in production because the DATABASE_URL config is unset.',
		'Production boot fails — the DATABASE_URL environment variable is missing.',
		'Prod deploy dies at launch since nobody set the DATABASE_URL config value.' ] },
	{ taskId: 'concurrency-high', inputs: [
		'Two threads increment the shared counter with no lock, so counts come out wrong.',
		'A data race: concurrent workers write the counter unsynchronized and lose updates.',
		'Under load the counter is wrong because parallel threads race on it without a mutex.' ] },
];

// ── stub `ask`s of designed behavior (the `user` is the interpolated ${rawText} = the input) ──────────
// A constrained-decoding stub: ALWAYS a valid-enum JSON, classified by robust cues → within-task stable.
function classify( user ) {
	const t = user.toLowerCase();
	const bugClass = /database|env|config|unset|missing/.test(t) ? 'config'
		: /thread|race|lock|concurrent|counter|mutex|parallel/.test(t) ? 'concurrency' : 'logic';
	const severity = /crash|production|prod|fail|die|wrong|lose|lost|oom/.test(t) ? 'high' : 'medium';
	return JSON.stringify({ bugClass, severity });
}
const constrainedAsk = async ( { user } ) => classify(user);
// a noisy constrained arm: flips ONE concurrency paraphrase to a different (still valid) class.
const noisyAsk = async ( { user } ) => (/no lock/.test(user) ? JSON.stringify({ bugClass: 'logic', severity: 'high' }) : classify(user));
// mode-collapse: ignores the input, always the same tuple (valid enum, within-task "perfect", cross-task fatal).
const collapseAsk = async () => JSON.stringify({ bugClass: 'config', severity: 'high' });
// unconstrained free-text: out-of-vocab synonyms → canon MISS → untyped (the FORMAT failure).
const freeTextAsk = async ( { user } ) => JSON.stringify({ bugClass: /thread|race/.test(user) ? 'threading bug' : 'configuration problem', severity: 'critical', prose: 'x' });

// drive the REAL Intake::type provider (engine-free, matches tests/unit/intake.test.js)
function runnerFor( ask ) {
	const { Intake } = createIntake({ ask });
	const concept = { _name: 'Intake', _schema: { prompt: { user: '${rawText}', facts: FACTS, prose: 'note' }, intake: { required: REQUIRED } } };
	const graph = { getRef: ( r, s ) => s._[r], traceProvider: null };
	return ( text ) => new Promise(( res ) => Intake.type(graph, concept, { _: { rawText: text } }, null, ( e, f ) => res({
		status: f.IntakeStatus, digest: f.IntakeFactsDigest, facts: { bugClass: f.bugClass, severity: f.severity },
	})));
}
async function arm( ask ) {
	const run = runnerFor(ask);
	const groups = [];
	for ( const g of GROUPS_INPUT ) {
		const results = [];
		for ( const text of g.inputs ) results.push(await run(text));
		groups.push({ taskId: g.taskId, results });
	}
	return groups;
}

test('constrained arm: all typed, within-task stable, cross-task collision-free (H=C=V=1, κ=1)', async () => {
	const groups = await arm(constrainedAsk);
	const prof = E.profile(groups, { fields: ['bugClass', 'severity'] });
	assert.equal(prof.meanTypedRate, 1, 'constrained → every input typed (format closure)');
	assert.equal(prof.meanCollisionProb, 1, 'within-task: all paraphrases share one digest');
	assert.equal(prof.pool.homogeneity, 1, 'cross-task: no two tasks share a digest (collision-free)');
	assert.equal(prof.pool.vMeasure, 1);
	assert.equal(prof.fleiss.kappa, 1, 'chance-corrected agreement is perfect and NON-vacuous');
	assert.equal(prof.fleiss.vacuous, false);
});

test('MODE COLLAPSE: within-task looks perfect but the profiler CATCHES the collision (H=0, κ vacuous)', async () => {
	const groups = await arm(collapseAsk);
	const prof = E.profile(groups);
	assert.equal(prof.meanCollisionProb, 1, 'the trap: naive within-task agreement is perfect …');
	assert.equal(prof.pool.homogeneity, 0, '… but homogeneity is 0 — both tasks collide on one digest');
	assert.equal(prof.pool.vMeasure, 0);
	assert.equal(prof.fleiss.vacuous, true, 'the vacuousness alarm fires');
	assert.equal(prof.fleiss.kappa, null, 'κ refuses a verdict: agreement is indistinguishable from chance');
});

test('unconstrained free-text arm: FORMAT failure → untyped, no digest (the (a) half, netted out later)', async () => {
	const groups = await arm(freeTextAsk);
	const prof = E.profile(groups);
	assert.equal(prof.meanTypedRate, 0, 'out-of-vocab synonyms miss the enum → untyped');
	// every result is the ⊥ class → within-task "agreement" is 1 on ⊥, but nothing is memoizable.
	assert.equal(prof.perTask.every(( t ) => t.numClasses === 1), true, 'all ⊥');
	assert.equal(groups.every(( g ) => g.results.every(( r ) => r.digest == null)), true, 'no reusable digest minted');
});

test('noisy constrained arm: fragmentation WITHOUT collision (collisionProb<1 but homogeneity stays 1)', async () => {
	const groups = await arm(noisyAsk);
	const prof = E.profile(groups);
	assert.ok(prof.meanCollisionProb < 1, 'one flipped paraphrase fragments a task');
	const conc = prof.perTask.find(( t ) => t.taskId === 'concurrency-high');
	assert.ok(Math.abs(conc.collisionProb - 1 / 3) < 1e-9, 'concurrency task: [conc,conc,logic] → 1/3');
	assert.equal(prof.pool.homogeneity, 1, 'fragmentation is cheap (calls), NOT a collision (correctness)');
});

test('crossArmAgreement nets FORMAT out: constrained vs free-text compared only on both-typed inputs', async () => {
	const [cg] = [await arm(constrainedAsk)];
	const fg = await arm(freeTextAsk);
	// align per input across the two arms (flatten in the same order)
	const flat = ( gs ) => gs.flatMap(( g ) => g.results);
	const c = E.crossArmAgreement(flat(cg), flat(fg));
	assert.equal(c.aTypedRate, 1);
	assert.equal(c.bTypedRate, 0);
	assert.equal(c.nBothTyped, 0, 'free-text never in-vocab → the semantic comparison is empty (only format differs)');
	assert.equal(c.agreeFraction, null, 'so this pair speaks ONLY to format closure, not the semantic (b) half');
});
