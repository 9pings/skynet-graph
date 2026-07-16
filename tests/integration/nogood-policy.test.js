'use strict';
/**
 * Learned-negative (nogood) sound-skip policy on the real engine (experiment B). Two
 * expensive trial concepts cast per segment; a cheap upstream Nogood::guard turns the
 * learned store into typed skip flags so a provably-dead trial is not re-run on later
 * same-context segments. DECISIVE: the surviving useful set is bit-for-bit identical with
 * and without the policy — it removes only wasted exploration, never a conclusion.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createNogood, recordNogood, guardTrial, nogoodGuardConcept } = require('../../lib/providers');

console.log = console.info = console.warn = () => {};

// ground truth: which (kind,trial) is productive (score 1) vs a dead end (score 0).
const SCORE = { travel: { TrialA: 1, TrialB: 0 }, stay: { TrialA: 0, TrialB: 1 }, dist: { TrialA: 0, TrialB: 0 } };
const KINDS = ['travel', 'stay', 'dist'];
const TRIALS = ['TrialA', 'TrialB'];
const cfg = { label: 'nogood', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

function trialConcept(name, withPolicy) {
	const base = {
		_id: name, _name: name, require: ['Trial', 'kind'], provider: ['Exp::' + name],
		childConcepts: { ['Keep' + name.slice(5)]: { _id: 'Keep' + name.slice(5), _name: 'Keep' + name.slice(5), require: [name], ensure: ['$' + name + 'Score>=1'] } }
	};
	return withPolicy ? guardTrial(base, { trial: name }) : base;
}

function buildTree(withPolicy) {
	const kids = { TrialA: trialConcept('TrialA', withPolicy), TrialB: trialConcept('TrialB', withPolicy) };
	if (withPolicy) kids.NogoodGuard = nogoodGuardConcept({ require: ['Trial', 'kind'] });
	return { common: { childConcepts: { Trial: { _id: 'Trial', _name: 'Trial', require: ['Trial'], childConcepts: kids } } } };
}

async function runVariant(withPolicy, repeats) {
	const counters = { TrialA: 0, TrialB: 0 };
	const makeTrial = (name) => (graph, concept, scope, argz, cb) => {
		counters[name]++;                                       // the expensive cost we minimize
		const kind = scope._.kind, score = (SCORE[kind] && SCORE[kind][name]) || 0;
		const muts = [{ $_id: '_parent', [name]: true, [name + 'Score']: score }];
		if (score === 0) muts.push(recordNogood({ ctxKey: kind, trial: name }));   // learn the negative
		cb(null, muts);
	};
	Graph._providers = Object.assign({ Exp: { TrialA: makeTrial('TrialA'), TrialB: makeTrial('TrialB') } }, createNogood());

	const g = new Graph({ lastRev: 0, nodes: [{ _id: 'mem', nogoods: [] }, { _id: 'na' }, { _id: 'nb' }], segments: [] }, cfg, buildTree(withPolicy));
	await nextStable(g);

	const dist = [];
	for (let r = 0; r < repeats; r++) for (const k of KINDS) dist.push(k);   // interleaved: 1st pays, rest can skip

	const perSegUseful = [], storeSizes = [];
	let divergent = false;
	for (let i = 0; i < dist.length; i++) {
		const id = 'seg' + i;
		g.pushMutation({ _id: id, Trial: true, Segment: true, originNode: 'na', targetNode: 'nb', kind: dist[i] }, id, true);
		await nextStable(g);
		const f = g._objById[id]._etty._;
		perSegUseful.push(TRIALS.filter((t) => f['Keep' + t.slice(5)]).join('+') || '(none)');
		storeSizes.push((g._objById['mem']._etty._.nogoods || []).length);
		if (f.divergent && f.divergent.length) divergent = true;
	}
	return { expensive: counters.TrialA + counters.TrialB, perSegUseful, storeSizes, divergent };
}

test('nogood policy cuts wasted trials to the floor while preserving the useful set bit-for-bit', async () => {
	const REPEATS = 4;
	const baseline = await runVariant(false, REPEATS);
	const policy = await runVariant(true, REPEATS);

	// analytic floor: productive pairs (travel:A, stay:B) run every occurrence = 2*REP;
	// dead pairs (travel:B, stay:A, dist:A, dist:B) run once each under policy = 4.
	assert.equal(baseline.expensive, (2 + 4) * REPEATS, 'baseline runs every trial every time (24)');
	assert.equal(policy.expensive, 2 * REPEATS + 4, 'policy runs dead trials once each (12)');
	assert.ok(policy.expensive < baseline.expensive, 'efficiency: fewer expensive invocations');

	// DECISIVE: the surviving useful set is identical per segment
	assert.deepEqual(policy.perSegUseful, baseline.perSegUseful, 'useful conclusions unchanged bit-for-bit');

	// monotone, append-only store (never shrinks), plateaus at the 4 dead pairs
	for (let i = 1; i < policy.storeSizes.length; i++) assert.ok(policy.storeSizes[i] >= policy.storeSizes[i - 1], 'store is monotone');
	assert.equal(policy.storeSizes[policy.storeSizes.length - 1], 4, 'plateaus at 4 distinct dead (kind,trial) pairs');

	// the nogood targets a PROVABLY-dead trial, not a legitimate self-destabilizing re-trial
	assert.equal(baseline.divergent, false);
	assert.equal(policy.divergent, false);
});
