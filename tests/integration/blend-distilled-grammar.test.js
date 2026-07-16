'use strict';
/**
 * CONCEPTS COMBINE — on the grammars DISTILLED THROUGH THE DATASET-ADAPTER pipeline (owner track (c),
 * 2026-07-06). `blend-methods.test.js` proved the blend operator on HAND-AUTHORED crystallizeStructural
 * fixtures; this test closes the named gap "reste à l'exercer sur les grammaires du dataset" — it distils
 * two typed grammars through the REAL brick chain (dataset-adapter → engine trace → crystallizeFrom →
 * goldGate), then blends them, and mounts the composite on the real engine. Deterministic (gold-forge
 * planner, no model), self-contained (in-memory records, no fs / no external corpus). ZERO-CORE.
 *
 * THE FINDING IT LOCKS (critique protocol §3 — understand the mechanism, do not report a green vacuum):
 *   • the distilled grammars DO combine — blendMethods grafts a donor grammar's body into a host grammar's
 *     step slot → a SOUND depth-2 method that mounts (0 model calls, contract-checked). The mechanism is
 *     dataset-real, not just fixture-real.
 *   • BUT the blend operator is NESTING: the host's `filter` step becomes a SUBQUERY (filter→select). That
 *     is a genuine SQL construct — yet WikiSQL's flat, single-table gold NEVER contains a nested subquery,
 *     so the blended method serves NO WikiSQL gold class (no oracle, no demand). A MEANINGFUL composition
 *     (a query whose gold method IS a blend) needs a RECURSIVE grammar (Spider subqueries/JOINs), not a
 *     flat one. This test asserts BOTH: the mechanism fires AND the flat corpus offers it no target.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { methodTrace } = require('../../plugins/learning/lib/mine.js');
const { createLearningLibrary } = require('../../plugins/learning/combo.js');
const { goldGate } = require('../../lib/authoring/forge/stock.js');
const { getAdapter, loadDataset } = require('../../lib/authoring/forge/dataset-adapter.js');
const { blendMethods, methodDepth, segmentSlots } = require('../../plugins/learning/lib/adapt.js');
const { instantiate, ctxFromScope, BASE } = require('../../lib/authoring/core/abstract.js');
const { injectMarker, guardKey } = require('../../plugins/learning/lib/combinator.js');
console.log = console.info = console.warn = () => {};

// ── the model-driven structural Plan provider (grammar-stock.js's, deterministic gold-forge = a perfectly
//    consistent planner: it emits the gold shape). Builds a crystallizable N-step typed chain. ──────────────
const TREE = { childConcepts: { Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'taskKind'], ensure: ['!$Planned'], provider: ['Plan::plan'] } } };
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'blend-distill', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const node = ( id ) => ({ _id: id });

function makePlanProvider( plans ) {
	return { plan: function ( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode;
		const rec = plans[scope._.recId];
		const steps = rec.goldShape.slice();                     // deterministic: the planner emits the gold shape
		const tpl = [{ $_id: '_parent', Plan: true, Planned: true, nSteps: steps.length }];
		let prev = o;
		steps.forEach(function ( kind, i ) {
			const last = i === steps.length - 1, tnode = last ? t : base + '_m' + i;
			if ( !last ) tpl.push({ _id: tnode, Node: true, state: kind });
			tpl.push({ _id: base + '_s' + i, Segment: true, originNode: prev, targetNode: tnode, parentSeg: base, state: kind });
			prev = tnode;
		});
		rec._modelSteps = steps;
		cb(null, tpl);
	} };
}

// distil ONE class method from its records: live graph → trace → crystallizeFrom → gold-gate. Returns the candidate.
const stockLib = () => createLearningLibrary({ learning: true, signature: ( p ) => ({ structure: { taskKind: p.taskKind }, content: {} }),
	target: () => null, dispatchFacts: ( p ) => ({ Segment: true, taskKind: p.taskKind }), forge: async () => null });

async function distil( sig, recs ) {
	const plans = {};
	recs.forEach(( r, i ) => { r.recId = sig + '#' + i; plans[r.recId] = r; });
	Graph._providers = Object.assign({}, Graph._providers, { Plan: makePlanProvider(plans) });
	const nodes = [], segments = [];
	recs.forEach(( r, i ) => { nodes.push(node('S' + i), node('G' + i)); segments.push({ _id: 'E' + i, originNode: 'S' + i, targetNode: 'G' + i, taskKind: sig, recId: r.recId }); });
	const mt = methodTrace();
	const g = new Graph({ lastRev: 0, nodes, segments }, CFG, { common: TREE });
	mt.listen(g);
	await nextStable(g);
	const lib = stockLib();
	const res = lib.crystallizeFrom(mt.records, { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL, equivKeys: ['Planned'], idFor: () => 'Crystal_' + sig.replace('|', '_') });
	const gate = goldGate({ modelShapes: recs.map(( r ) => r._modelSteps || [] ), goldSteps: recs[0].goldShape, crystallized: !!res.admitted });
	return { sig, admitted: gate.admitted, goldMatch: gate.goldMatch, modelShape: gate.modelShape, goldShape: gate.goldShape, candidate: gate.admitted ? res.candidate : null };
}

// mount a candidate's template at a fresh site via a Decompose combinator (instantiate + self-flag). Returns the graph.
async function mountCandidate( cand, baseId ) {
	const tpl = Object.values(cand.templatesBySig)[0];
	const provider = function ( g, c, scope, argz, cb ) {
		const ctx = ctxFromScope(scope, { frontier: { origin: 'originNode', target: 'targetNode' } });
		const gr = ctx && instantiate(tpl, ctx);
		return cb(null, gr ? injectMarker(gr, ctx.base, 'Decompose') : { $_id: '_parent', Decompose: true, [guardKey('Decompose')]: true });
	};
	Graph._providers = Object.assign({}, Graph._providers, { Creative: { Decompose: provider } });
	const D = { _id: 'Decompose', _name: 'Decompose', require: ['Segment', 'taskKind', 'toDecompose'], ensure: ['!$' + guardKey('Decompose')], provider: ['Creative::Decompose'] };
	const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] }, { label: 'mt', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: { childConcepts: { Decompose: D } } });
	await nextStable(g);
	await new Promise(( res ) => g.pushMutation({ _id: baseId, Segment: true, originNode: 'X', targetNode: 'Y', taskKind: 'count|2', toDecompose: true }, null, undefined, undefined, undefined, () => res()));
	await nextStable(g);
	return g;
}

// ── the in-memory dataset — WikiSQL-shaped records fed through the REAL wikisql adapter (its `records` path,
//    no fs). agg index: ['none','max','min','count','sum','avg']; class = {agg}|{nConds}. ──────────────────────
const TABLES = { t1: { id: 't1', header: ['player', 'team', 'position', 'points'] } };
const RECORDS = [
	// none|1  (agg 0, 1 cond)   → gold [filter, select]
	{ question: 'What position does the Butler player play?', table_id: 't1', sql: { sel: 2, agg: 0, conds: [[1, 0, 'Butler']] } },
	{ question: 'Which team is player X on?', table_id: 't1', sql: { sel: 1, agg: 0, conds: [[0, 0, 'X']] } },
	// count|2 (agg 3=count, 2 conds) → gold [filter, filter, aggregate, select]
	{ question: 'How many guards are on the Butler team?', table_id: 't1', sql: { sel: 0, agg: 3, conds: [[1, 0, 'Butler'], [2, 0, 'guard']] } },
	{ question: 'How many centers are on the Duke team?', table_id: 't1', sql: { sel: 0, agg: 3, conds: [[1, 0, 'Duke'], [2, 0, 'center']] } },
];

test('distilled dataset grammars COMBINE — blend a host + donor distilled THROUGH the dataset-adapter into a sound depth-2 method', async () => {
	const byClass = loadDataset(getAdapter('wikisql'), { records: RECORDS, aux: { tables: TABLES }, perClass: 2 });
	assert.deepEqual(Object.keys(byClass).sort(), ['count|2', 'none|1'], 'the adapter bucketed the two coverage classes');

	const host = await distil('count|2', byClass['count|2']);   // [filter, filter, aggregate, select]
	const donor = await distil('none|1', byClass['none|1']);    // [filter, select]
	assert.ok(host.admitted && host.candidate, 'count|2 grammar distilled + gold-gated (0 false)');
	assert.ok(donor.admitted && donor.candidate, 'none|1 grammar distilled + gold-gated (0 false)');
	assert.equal(host.modelShape, 'filter>filter>aggregate>select', 'host shape matches gold');
	assert.equal(donor.modelShape, 'filter>select', 'donor shape matches gold');
	assert.equal(methodDepth(host.candidate), 1, 'the distilled grammars are FLAT (depth-1) — WikiSQL is single-table');
	assert.equal(methodDepth(donor.candidate), 1);

	// BLEND — graft the donor grammar's body into the host's FIRST step slot (its first filter). 0 model calls.
	const blended = blendMethods(host.candidate, donor.candidate);
	assert.ok(blended, 'the two DISTILLED grammars blend (the mechanism is dataset-real, not just fixture-real)');
	assert.equal(blended.composeVerdict, 'sound', 'the graft is contract-checked SOUND (not a blind union)');
	assert.deepEqual(blended.blendedFrom, ['Crystal_count_2', 'Crystal_none_1'], 'provenance recorded (both distilled ids)');
	assert.equal(methodDepth(blended), 2, 'the blend is depth-2 — the host filter step is now itself decomposed');
	assert.deepEqual(blended.signatureKeys, host.candidate.signatureKeys, 'the OUTER interface stays the host’s (dispatches like count|2)');

	// the composite MOUNTS on the real engine as a 2-level decomposition (the distilled blend is engine-real).
	const g = await mountCandidate(blended, 'Z');
	const o = ( id ) => g._objById[id] && g._objById[id]._etty._;
	assert.ok(o('Z_m0') && o('Z_m1') && o('Z_m2'), 'the host chain mounted (filter→filter→aggregate→select mids)');
	assert.ok(o('Z_s0_m0'), 'the donor sub-query mounted UNDER the first filter slot — a genuine 2-level blend');
	assert.equal(o('Z_s0_s0').originNode, 'X', 'sub-path re-bound to the outer origin');
	assert.equal(o('Z_s0_s1').targetNode, 'Z_m0', 'sub-path re-bound to the host mid (X→sub→Z_m0)');
	assert.ok(g.getRevisions().length < 100, 'bounded — no apply-cap runaway');
	assert.ok(!g._objById['S0'] && !g._objById['E0'], 'no distillation-episode id-space leaked (sound)');
});

test('the FINDING — the blend is NESTING (a subquery); WikiSQL’s flat gold offers it NO target (needs a recursive dataset)', async () => {
	const byClass = loadDataset(getAdapter('wikisql'), { records: RECORDS, aux: { tables: TABLES }, perClass: 2 });
	const host = await distil('count|2', byClass['count|2']);
	const donor = await distil('none|1', byClass['none|1']);
	const blended = blendMethods(host.candidate, donor.candidate);

	// every WikiSQL gold shape is FLAT (a single ordered step list, no step is itself a sub-decomposition). The
	// blended count|2 body is depth-2 — so it does NOT match count|2's flat gold, and no other WikiSQL class asks
	// for a nested subquery. The composite is a capability with NO oracle/demand in this corpus.
	const goldShapes = Object.values(byClass).flat().map(( r ) => r.goldShape );
	for ( const gs of goldShapes ) assert.ok(gs.every(( s ) => ['filter', 'aggregate', 'select'].includes(s) ), 'every WikiSQL gold step is a leaf kind (flat) — no nesting in the gold');
	assert.ok(methodDepth(blended) > methodDepth(host.candidate), 'the blend adds a level the flat gold never contains');
	assert.equal(host.goldShape, 'filter>filter>aggregate>select', 'count|2 gold is flat depth-1, NOT the depth-2 blend → no WikiSQL query targets the composite');

	// NEG control — the finding is not vacuous: a host with NO graftable step slot cannot blend at all.
	const leaf = { schema: { _id: 'Leaf', contract: { post: [] } }, signatureKeys: ['taskKind'], templatesBySig: { x: [{ $_id: '_parent', Leaf: true, $$_id: BASE }] } };
	assert.equal(segmentSlots(Object.values(leaf.templatesBySig)[0]).length, 0, 'a slot-less grammar has no graftable step');
	assert.equal(blendMethods(leaf, donor.candidate), null, 'no step slot → no blend (the mechanism is not firing spuriously)');
});
