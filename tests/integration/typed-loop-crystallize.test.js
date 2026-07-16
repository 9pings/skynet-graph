'use strict';
/**
 * typed-loop on the REAL engine — the mechanics the NEXT-#1 fidelity experiment stands on, each demanded by
 * the 2026-07-02 Laurie confront (verdicts A+B) and proven deterministically BEFORE any GPU spend:
 *   1. recursion: stamped verdicts → eval fires at the ROOT only; expand per NeedsSplit level; answers = leaves.
 *   2. K1 PASS on a HETEROGENEOUS trace (B): the premise captures stepKind → per-class signatures discriminate.
 *   3. K1 NEGATIVE (the loop.js prose control): same episodes, prose providers → signatureDetermined falls.
 *   4. THE ZERO-FIRE MOUNT GATE (A): a 2-level COMPOSITE mounted as ONE mutation → eval 0, expand 0, answer =
 *      leaf-count exactly; a single-level mount pays exactly 1 expand for the uncovered level (FLAT's floor).
 * Deterministic (injected content fns), GPU-free.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { crystallizeStructural } = require('../../lib/authoring/learning/crystallize.js');
const { makeTypedDecomposeProviders, typedLoopConceptTree, mountTemplate, TYPED_PROSE_KEYS } = require('../../lib/authoring/core/typed-loop.js');
const { makeDecomposeProviders, loopConceptTree } = require('../../lib/authoring/core/loop.js');
const { blendMethods, segmentSlots, hitTemplate } = require('../../lib/authoring/learning/adapt.js');
console.log = console.info = console.warn = () => {};

const KINDS = { enum: ['retrieve', 'transform', 'validate', 'emit'] };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, originNode: o, targetNode: t }, extra);

// the deterministic "model": structure is a function of the TYPED stepKind; prose varies per episode (realistic).
// etl → [retrieve (re-splits), emit] · retrieve → [validate, emit] · anything else → atomic leaves only.
function contentFns( counters ) {
	return {
		stepKinds: KINDS, maxDepth: 2,
		evalFn  : ( s ) => { counters.eval++; return { atomic: false }; },
		expandFn: ( s ) => {
			counters.expand++;
			const steps = s._.stepKind === 'etl'
				? [{ stepKind: 'retrieve', atomic: false }, { stepKind: 'transform' }, { stepKind: 'emit' }]
				: [{ stepKind: 'validate' }, { stepKind: 'emit' }];
			return steps.map(( st, i ) => Object.assign({ description: 'ep-' + s._._id + '-step-' + i }, st));
		},
		answerFn: ( s ) => { counters.answer++; return 'ans-' + s._._id; },
	};
}
// NB: root tasks carry stepKind:'etl' — the intake-typed signature key (out of the enum on purpose at the ROOT
// level: canonValue only gates the CHILDREN the model emits; the root key comes typed from intake).

async function bootTask( providers, seedSegs ) {
	Graph._providers = Object.assign({}, providers);
	const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: seedSegs },
		{ label: 't', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: typedLoopConceptTree() });
	await nextStable(g);
	return g;
}

test('recursive emergent depth: STAMPED verdicts → eval fires at the ROOT only; expand per level; answers = leaves', async () => {
	const counters = { eval: 0, expand: 0, answer: 0 };
	const g = await bootTask(makeTypedDecomposeProviders(contentFns(counters)), [seg('T1', 'X', 'Y', { stepKind: 'etl' })]);
	const root = g.getEtty('T1')._;
	assert.deepEqual(root.expandedInto, ['T1_s0', 'T1_s1', 'T1_s2']);
	const kid0 = g.getEtty('T1_s0')._;
	assert.equal(kid0.stepKind, 'retrieve');
	assert.equal(kid0.EvalComplexity, true);                                      // stamped, not derived
	assert.deepEqual(kid0.expandedInto, ['T1_s0_s0', 'T1_s0_s1']);                // the emergent re-split
	assert.ok(g.getEtty('T1_s0_s0')._.answer);
	// the accounting the experiment counts: eval = ROOT ONLY (children stamped); expand = 2 levels; answers = 4 leaves
	assert.equal(counters.eval, 1);
	assert.equal(counters.expand, 2);
	assert.equal(counters.answer, 4);
});

const EPISODES = { lastRev: 0,
	nodes   : [node('S1'), node('G1'), node('S2'), node('G2')],
	segments: [seg('T1', 'S1', 'G1', { stepKind: 'etl' }), seg('T2', 'S2', 'G2', { stepKind: 'etl' })] };

async function learnEtl() {
	const counters = { eval: 0, expand: 0, answer: 0 };
	return crystallizeStructural({
		episodeTree: typedLoopConceptTree(),
		seed: JSON.parse(JSON.stringify(EPISODES)),
		providers: makeTypedDecomposeProviders(contentFns(counters)),
		equivKeys: ['Expand'], proseKeys: TYPED_PROSE_KEYS, all: true,
		idFor: ( m ) => 'Crystal_' + (((m.instances[0] || {}).premise || {}).stepKind || m.concept),
		declaredFrontier: { origin: { field: 'originNode' }, target: { field: 'targetNode' } },
	});
}
const candFor = ( res, kind ) => (res.candidates.find(( c ) => c.candidate && hitTemplate(c.candidate, { Task: true, NeedsSplit: true, stepKind: kind })) || {}).candidate;

test('K1 PASS on a HETEROGENEOUS trace: one candidate per structure class, the premise carries stepKind', async () => {
	const res = await learnEtl();
	assert.equal(res.admitted, true, res.reason);
	// TWO structure classes crystallized from ONE heterogeneous trace: mining buckets by skeleton (mine.js shapeKey)
	assert.equal(res.candidates.filter(( c ) => c.admitted ).length, 2);
	const etl = candFor(res, 'etl'), ret = candFor(res, 'retrieve');
	assert.ok(etl && ret, 'the etl level AND the retrieve level each crystallized');
	assert.ok(etl.signatureKeys.includes('stepKind'), 'the discriminator reached the signature (Laurie B)');
	assert.notEqual(etl.schema._id, ret.schema._id);
	// prose stripped, typed structure + STAMPED guards in the templates
	for ( const cand of [etl, ret] )
		for ( const tpl of Object.values(cand.templatesBySig) )
			for ( const o of tpl ) {
				assert.ok(!('description' in (o || {})), 'varying prose must NOT crystallize');
				if ( o && o.Segment ) assert.equal(o.EvalComplexity, true, 'the stamped guard rides the template');
			}
});

test('K1 NEGATIVE (the loop.js prose control): the SAME episodes do NOT crystallize — signatureDetermined falls', async () => {
	const counters = { eval: 0, expand: 0, answer: 0 };
	const fns = contentFns(counters);
	const res = await crystallizeStructural({
		episodeTree: JSON.parse(JSON.stringify(loopConceptTree)),
		seed: JSON.parse(JSON.stringify(EPISODES)),
		providers: makeDecomposeProviders(Object.assign({}, fns, {                 // loop.js: prose on the children
			expandFn: ( s ) => fns.expandFn(s).map(( st ) => ({ name: st.stepKind, description: st.description })) })),
		equivKeys: ['Expand'], idFor: () => 'CrystalProse',
		declaredFrontier: { origin: { field: 'originNode' }, target: { field: 'targetNode' } },
	});
	assert.equal(res.admitted, false);
	const expand = res.methods.find(( m ) => m.concept === 'Expand' );
	assert.ok(expand && expand.signatureDetermined === false,
		'the prose patch must break signature-determinism (same typed premise → differing patches)');
});

test('THE ZERO-FIRE MOUNT GATE: a 2-level composite mounts at eval 0 / expand 0 / answer == leaf-count', async () => {
	const res = await learnEtl();
	assert.equal(res.admitted, true, res.reason);
	const host = candFor(res, 'etl'), donor = candFor(res, 'retrieve');           // genuinely DISTINCT methods (donor≠host)
	assert.ok(host && donor);
	const etlSig = hitTemplate(host, { Task: true, NeedsSplit: true, stepKind: 'etl' });

	// ── FLAT's floor: mount the etl LEVEL only → exactly 1 expand (the uncovered retrieve level), eval 0 ──
	// a mount-hit task is CREATED WITH its mounted structure in ONE mutation (else boot-stabilization races
	// the mount and the providers fire first — the elision claim would be false on a live graph).
	const cFlat = { eval: 0, expand: 0, answer: 0 };
	{
		Graph._providers = Object.assign({}, makeTypedDecomposeProviders(contentFns(cFlat)));
		const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] },
			{ label: 'flat', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
			{ common: typedLoopConceptTree() });
		const m = mountTemplate(host.templatesBySig[etlSig], { rootId: 'F1', origin: 'X', target: 'Y', create: true, facts: { stepKind: 'etl' } });
		assert.ok(m, 'the level template grounds');
		g.pushMutation(m);
		await nextStable(g);
		assert.equal(cFlat.eval, 0, 'root eval subsumed by the mount stamp');
		assert.equal(cFlat.expand, 1, 'exactly the uncovered level pays');
		assert.equal(cFlat.answer, 4, 'content is paid everywhere (leaves)');
	}

	// ── the COMPOSITE (blendMethods donor≠host at the NeedsSplit slot) mounts BOTH levels at ZERO fires ──
	const slot = segmentSlots(host.templatesBySig[etlSig])[0];                     // the retrieve child slot
	const composite = blendMethods(host, donor, { atSegment: slot });
	assert.ok(composite, 'the H2-gated graft succeeds');
	assert.notEqual(composite.composeVerdict, 'unsound');
	const cComp = { eval: 0, expand: 0, answer: 0 };
	{
		Graph._providers = Object.assign({}, makeTypedDecomposeProviders(contentFns(cComp)));
		const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] },
			{ label: 'comp', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
			{ common: typedLoopConceptTree() });
		const m = mountTemplate(composite.templatesBySig[etlSig], { rootId: 'F2', origin: 'X', target: 'Y', create: true, facts: { stepKind: 'etl' } });
		assert.ok(m, 'the composite template grounds');
		g.pushMutation(m);
		await nextStable(g);
		// THE GATE (Laurie A): zero structural fires, content exactly at the leaves — else the campaign is noise.
		assert.equal(cComp.eval, 0, 'EvalComplexity must never fire on a mounted composite');
		assert.equal(cComp.expand, 0, 'Expand must never fire on a mounted composite');
		assert.equal(cComp.answer, 4, 'answers exactly at the leaf positions');
		const root = g.getEtty('F2')._;
		assert.equal(root.Expand, true);
		const kid0 = g.getEtty(root.expandedInto[0])._;
		assert.ok(kid0.expandedInto && kid0.expandedInto.length === 2, 'the grafted level is materialized');
		assert.ok(g.getEtty(kid0.expandedInto[0])._.answer, 'grafted leaves are answered (content, paid)');
		assert.ok(g.getRevisions().length < 60, 'bounded — no re-fire runaway');
	}
});
