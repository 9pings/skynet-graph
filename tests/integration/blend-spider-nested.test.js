'use strict';
/**
 * THE (c)-MEANINGFUL PAYOFF — on Spider, a RECURSIVE query dataset, the blend has a REAL gold target (2026-07-06).
 * `blend-distilled-grammar.test.js` found that on FLAT WikiSQL the blend fires but serves 0 gold class (a nested
 * subquery is absent from a single-table corpus). Spider FIXES that: a nested query `SELECT … WHERE x op (SELECT
 * agg …)` is a real, frequent class (46/550 dev queries). Its method IS a blend — the outer skeleton (a
 * `filter>select`) with the subquery grammar (`aggregate>select`) grafted into the filter operand slot. So two
 * SIMPLE distilled grammars COMPOSE to cover the nested class at 0 forge — the real "maximiser le proxy": K
 * distilled classes cover MORE than K query classes (their compositions too). Deterministic (gold-forge planner),
 * self-contained (in-memory Spider-shaped records through the REAL spider adapter, no fs / no model). ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { methodTrace } = require('../../lib/authoring/mine.js');
const { createLearningLibrary } = require('../../lib/combos/learning-library.js');
const { goldGate } = require('../../lib/authoring/stock.js');
const { getAdapter, loadDataset, analyzeSpiderSQL, spiderGoldShape } = require('../../lib/authoring/dataset-adapter.js');
const { blendMethods, methodDepth } = require('../../lib/authoring/adapt.js');
const { instantiate, ctxFromScope } = require('../../lib/authoring/abstract.js');
const { injectMarker, guardKey } = require('../../lib/authoring/combinator.js');
console.log = console.info = console.warn = () => {};

const TREE = { childConcepts: { Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'taskKind'], ensure: ['!$Planned'], provider: ['Plan::plan'] } } };
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'blend-spider', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const node = ( id ) => ({ _id: id });

function makePlanProvider( plans ) {
	return { plan: function ( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode;
		const steps = plans[scope._.recId].goldShape.slice();   // deterministic gold-forge
		const tpl = [{ $_id: '_parent', Plan: true, Planned: true, nSteps: steps.length }];
		let prev = o;
		steps.forEach(function ( kind, i ) {
			const last = i === steps.length - 1, tnode = last ? t : base + '_m' + i;
			if ( !last ) tpl.push({ _id: tnode, Node: true, state: kind });
			tpl.push({ _id: base + '_s' + i, Segment: true, originNode: prev, targetNode: tnode, parentSeg: base, state: kind });
			prev = tnode;
		});
		cb(null, tpl);
	} };
}
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
	const res = stockLib().crystallizeFrom(mt.records, { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL, equivKeys: ['Planned'], idFor: () => 'Crystal_' + sig.replace(/[^a-z]/gi, '_') });
	const gate = goldGate({ modelShapes: recs.map(( r ) => r.goldShape), goldSteps: recs[0].goldShape, crystallized: !!res.admitted });
	return { sig, admitted: gate.admitted, candidate: gate.admitted ? res.candidate : null };
}

async function mountCandidate( cand ) {
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
	await new Promise(( res ) => g.pushMutation({ _id: 'Z', Segment: true, originNode: 'X', targetNode: 'Y', taskKind: 'nested', toDecompose: true }, null, undefined, undefined, undefined, () => res()));
	await nextStable(g);
	return g;
}

// the real nested Spider query the composition targets, and the two SIMPLE classes it decomposes into.
const NESTED_QUERY = 'SELECT song_name FROM singer WHERE age > (SELECT avg(age) FROM singer)';
const HOST_RECS = [   // plain filter>select (the outer skeleton class)
	{ db_id: 'concert_singer', question: 'songs by singers older than 20', query: "SELECT song_name FROM singer WHERE age > 20" },
	{ db_id: 'concert_singer', question: 'names of French singers', query: "SELECT name FROM singer WHERE country = 'France'" },
];
const DONOR_RECS = [  // aggregate>select (the subquery class)
	{ db_id: 'concert_singer', question: 'average age', query: 'SELECT avg(age) FROM singer' },
	{ db_id: 'concert_singer', question: 'total capacity', query: 'SELECT sum(capacity) FROM stadium' },
];

test('the nested Spider query decomposes into filter>select (outer) + aggregate>select (subquery) — the blend material', () => {
	const sp = getAdapter('spider');
	const m = sp.adapt({ db_id: 'concert_singer', question: 'q', query: NESTED_QUERY });
	assert.equal(m.klass, 'filter>select|n', 'the nested query is its OWN class (would otherwise need its own forge)');
	assert.deepEqual(m.goldShape, ['filter', 'select'], 'outer skeleton = the HOST class');
	assert.deepEqual(spiderGoldShape(analyzeSpiderSQL(m.subquery)), ['aggregate', 'select'], 'subquery = the DONOR class');
	// the two feeder classes ARE what the adapter buckets from simple queries:
	const by = loadDataset(sp, { records: HOST_RECS.concat(DONOR_RECS) });
	assert.ok(by['filter>select'] && by['aggregate>select'], 'both feeder classes exist as simple-query buckets');
});

test('BLEND covers the nested class at 0 forge — two distilled grammars compose into the subquery method (the real amortization)', async () => {
	const host = await distil('filter>select', loadDataset(getAdapter('spider'), { records: HOST_RECS })['filter>select']);
	const donor = await distil('aggregate>select', loadDataset(getAdapter('spider'), { records: DONOR_RECS })['aggregate>select']);
	assert.ok(host.admitted && host.candidate, 'filter>select grammar distilled + gold-gated');
	assert.ok(donor.admitted && donor.candidate, 'aggregate>select grammar distilled + gold-gated');
	assert.equal(methodDepth(host.candidate), 1);
	assert.equal(methodDepth(donor.candidate), 1);

	// graft the subquery grammar into the outer filter slot → the nested query's method, 0 model calls.
	const blended = blendMethods(host.candidate, donor.candidate);
	assert.ok(blended, 'the two distilled grammars blend');
	assert.equal(blended.composeVerdict, 'sound', 'contract-checked sound');
	assert.equal(methodDepth(blended), 2, 'depth-2 — the filter operand is now a subquery (aggregate>select)');
	assert.deepEqual(blended.blendedFrom, ['Crystal_filter_select', 'Crystal_aggregate_select'], 'provenance = the two feeder grammars');

	// UNLIKE WikiSQL, this composite IS a real gold class: the nested Spider query — so it is COVERED at 0 forge.
	const g = await mountCandidate(blended);
	const o = ( id ) => g._objById[id] && g._objById[id]._etty._;
	assert.ok(o('Z_m0'), 'outer filter mid mounted');
	assert.equal(o('Z_s0_m0').state, 'aggregate', 'the subquery aggregate step mounted UNDER the filter slot — the nested decomposition');
	assert.equal(o('Z_s0_s0').originNode, 'X', 'subquery re-bound to the outer origin');
	assert.equal(o('Z_s0_s1').targetNode, 'Z_m0', 'subquery feeds the outer filter mid (compute the aggregate, then filter on it)');
	assert.equal(o('Z_s1').state, 'select', 'the outer select still terminates the query');
	assert.ok(g.getRevisions().length < 100, 'bounded — no apply-cap runaway');

	// the payoff, stated: the nested class is served by composing 2 distilled grammars — no 3rd forge.
	const distilledClasses = new Set(['filter>select', 'aggregate>select']);
	const nestedClass = getAdapter('spider').adapt({ db_id: 'd', question: 'q', query: NESTED_QUERY }).klass;
	assert.ok(!distilledClasses.has(nestedClass), 'the nested class is NOT one of the 2 distilled classes…');
	assert.equal(methodDepth(blended), 2, '…yet it is covered by their blend at 0 forge (K classes cover > K query types)');
});
