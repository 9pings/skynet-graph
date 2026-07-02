'use strict';
/**
 * typed-loop on the REAL engine — the K1 claim that motivates the operator (NEXT #1 fidelity work):
 * a decompose-loop trace produced by the TYPED providers CRYSTALLIZES (admitted, prose stripped, steps typed),
 * while the SAME episodes through loop.js's PROSE providers do NOT (signatureDetermined=false — same typed
 * premise, varying prose patch). Plus the recursive emergent-depth mechanics + the structural/content call
 * accounting seam the fidelity experiment counts. Deterministic (injected content fns), GPU-free.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { crystallizeStructural } = require('../../lib/authoring/crystallize.js');
const { makeTypedDecomposeProviders, TYPED_PROSE_KEYS, loopConceptTree } = require('../../lib/authoring/typed-loop.js');
const { makeDecomposeProviders } = require('../../lib/authoring/loop.js');
console.log = console.info = console.warn = () => {};

const KINDS = { enum: ['retrieve', 'transform', 'validate', 'emit'] };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, originNode: o, targetNode: t }, extra);

// a deterministic "model": structure is a function of the TYPED taskKind; prose varies per episode (realistic).
function contentFns( counters ) {
	return {
		evalFn  : ( s ) => { counters.eval++; return { atomic: false }; },
		expandFn: ( s ) => {
			counters.expand++;
			const steps = s._.taskKind === 'etl'
				? [{ stepKind: 'retrieve' }, { stepKind: 'transform' }, { stepKind: 'emit' }]
				: [{ stepKind: 'retrieve' }, { stepKind: 'emit' }];
			// the varying free text a real model would produce — MUST stay per-instance, never crystallize
			return steps.map(( st, i ) => Object.assign({ description: 'ep-' + s._._id + '-step-' + i }, st));
		},
		answerFn: ( s ) => { counters.answer++; return 'ans-' + s._._id; },
	};
}

test('recursive emergent depth on the real engine: typed kids, per-level calls, depth floor', async () => {
	const counters = { eval: 0, expand: 0, answer: 0 };
	const fns = contentFns(counters);
	// only the FIRST child of the root re-splits (emergent, model-decided); depth floor at 2 stops the recursion
	fns.evalFn = ( s ) => { counters.eval++; return { atomic: !(s._._id === 'T1' || s._._id === 'T1_s0') }; };
	Graph._providers = Object.assign({}, Graph._providers || {}, makeTypedDecomposeProviders(Object.assign({ stepKinds: KINDS, maxDepth: 2 }, fns)));
	const g = new Graph({ lastRev: 0, nodes: [node('S'), node('G')], segments: [seg('T1', 'S', 'G', { taskKind: 'etl' })] },
		{ label: 't', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: JSON.parse(JSON.stringify(loopConceptTree)) });
	await nextStable(g);
	const root = g.getEtty('T1')._;
	assert.deepEqual(root.expandedInto, ['T1_s0', 'T1_s1', 'T1_s2']);
	const kid0 = g.getEtty('T1_s0')._;
	assert.equal(kid0.stepKind, 'retrieve');
	assert.equal(kid0.depth, 1);
	// the emergent re-split: T1_s0 has no taskKind → the stub's 2-step branch (structure is the MODEL's choice)
	assert.deepEqual(kid0.expandedInto, ['T1_s0_s0', 'T1_s0_s1']);
	const grand = g.getEtty('T1_s0_s0')._;
	assert.equal(grand.depth, 2);
	assert.equal(grand.stepKind, 'retrieve');
	assert.ok(grand.answer && grand.Answered);                                    // floored → Atomic → answered
	// call accounting (the experiment's currency): evals at depth<2 = T1 + 3 kids = 4 (grandkids floored, 0 eval);
	// expands = T1 + T1_s0 = 2 (structural); answers = the 4 leaves (T1_s1, T1_s2 + 2 grandkids) = content.
	assert.equal(counters.eval, 4);
	assert.equal(counters.expand, 2);
	assert.equal(counters.answer, 4);
});

const EPISODES = { lastRev: 0,
	nodes   : [node('S1'), node('G1'), node('S2'), node('G2')],
	segments: [seg('T1', 'S1', 'G1', { taskKind: 'etl' }), seg('T2', 'S2', 'G2', { taskKind: 'etl' })] };

test('K1 PASS: a TYPED decompose trace crystallizes — prose stripped, steps typed in the template', async () => {
	const counters = { eval: 0, expand: 0, answer: 0 };
	const res = await crystallizeStructural({
		episodeTree: JSON.parse(JSON.stringify(loopConceptTree)),
		seed: EPISODES, providers: makeTypedDecomposeProviders(Object.assign({ stepKinds: KINDS, maxDepth: 1 }, contentFns(counters))),
		equivKeys: ['Expand'], idFor: () => 'CrystalEtl', proseKeys: TYPED_PROSE_KEYS,
		declaredFrontier: { origin: { field: 'originNode' }, target: { field: 'targetNode' } },
	});
	assert.equal(res.admitted, true, res.reason);
	const tpl = Object.values(res.candidate.templatesBySig)[0];
	const kids = tpl.filter(( o ) => o && o.stepKind );
	assert.equal(kids.length, 3);                                                 // the typed structure crystallized
	assert.deepEqual(kids.map(( k ) => k.stepKind), ['retrieve', 'transform', 'emit']);
	assert.ok(tpl.some(( o ) => o && o.state === 'plan-retrieve'));               // typed plan-state on the mid node
	for ( const o of tpl ) {
		assert.ok(!('description' in (o || {})), 'varying prose must NOT crystallize');
		assert.ok(!('answer' in (o || {})), 'per-case answers must NOT crystallize');
	}
});

test('K1 NEGATIVE (the loop.js prose control): the SAME episodes do NOT crystallize — signatureDetermined falls', async () => {
	const counters = { eval: 0, expand: 0, answer: 0 };
	const fns = contentFns(counters);
	const res = await crystallizeStructural({
		episodeTree: JSON.parse(JSON.stringify(loopConceptTree)),
		seed: EPISODES,
		providers: makeDecomposeProviders(Object.assign({}, fns, {                 // loop.js: prose on the children
			expandFn: ( s ) => fns.expandFn(s).map(( st, i ) => ({ name: st.stepKind, description: st.description })) })),
		equivKeys: ['Expand'], idFor: () => 'CrystalProse',
		declaredFrontier: { origin: { field: 'originNode' }, target: { field: 'targetNode' } },
	});
	assert.equal(res.admitted, false);
	const expand = res.methods.find(( m ) => m.concept === 'Expand' );
	assert.ok(expand && expand.signatureDetermined === false,
		'the prose patch must break signature-determinism (same typed premise → differing patches)');
});
