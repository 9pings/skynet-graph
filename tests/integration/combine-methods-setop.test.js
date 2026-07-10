'use strict';
/**
 * THE SECOND COMPOSITION OPERATOR — set-op combination (owner NEXT after tracks a/b/c, 2026-07-06). Track (c)
 * proved NESTING composition (blendMethods: graft a donor into a host slot → a deeper single query = a SQL
 * subquery). Spider exposes a SECOND compositional structure the blend can't express: SET-OPS (`A INTERSECT B`,
 * 42/550 dev queries) — two INDEPENDENT sub-queries over the same source, joined by ∩/∪/−. `combineMethods` is
 * that operator: run two complete distilled grammars in PARALLEL from the same origin, converge at a `combine`
 * node, join with the set-op → a NEW method whose result = op(left,right), at 0 model calls. So a set-op query
 * class is covered by combining two distilled grammars — the SAME "K classes cover > K query types" amortization
 * as blend, on the other half of Spider's composition. Deterministic, self-contained (in-memory Spider records
 * through the real adapter, no fs / no model). ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { methodTrace } = require('../../lib/authoring/mine.js');
const { createLearningLibrary } = require('../../lib/combos/learning-library.js');
const { goldGate } = require('../../lib/authoring/stock.js');
const { getAdapter, loadDataset } = require('../../lib/authoring/dataset-adapter.js');
const { combineMethods, blendMethods, composeContract, methodDepth } = require('../../lib/authoring/adapt.js');
const { instantiate, ctxFromScope } = require('../../lib/authoring/abstract.js');
const { injectMarker, guardKey } = require('../../lib/authoring/combinator.js');
console.log = console.info = console.warn = () => {};

const TREE = { childConcepts: { Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'taskKind'], ensure: ['!$Planned'], provider: ['Plan::plan'] } } };
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'combine', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const node = ( id ) => ({ _id: id });

function makePlanProvider( plans ) {
	return { plan: function ( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode;
		const steps = plans[scope._.recId].goldShape.slice();
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
	return gate.admitted ? res.candidate : null;
}
// distil from RAW Spider records: map them through the adapter first (→ they carry .goldShape), then distil the class.
const distilFrom = ( sig, rawRecords ) => distil(sig, loadDataset(getAdapter('spider'), { records: rawRecords })[sig]);

async function mountCombined( cand, taskKind ) {
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
	await new Promise(( res ) => g.pushMutation({ _id: 'Z', Segment: true, originNode: 'X', targetNode: 'Y', taskKind: taskKind, toDecompose: true }, null, undefined, undefined, undefined, () => res()));
	await nextStable(g);
	return g;
}

// two simple filter>select feeder classes (the two operands of the INTERSECT query below).
const FILTER_A = [
	{ db_id: 'concert_singer', question: 'countries of singers older than 40', query: "SELECT country FROM singer WHERE age > 40" },
	{ db_id: 'concert_singer', question: 'names of French singers', query: "SELECT name FROM singer WHERE country = 'France'" },
];
const FILTER_B = [
	{ db_id: 'concert_singer', question: 'countries of singers younger than 30', query: "SELECT country FROM singer WHERE age < 30" },
	{ db_id: 'concert_singer', question: 'names of tall singers', query: "SELECT name FROM singer WHERE height > 180" },
];
const AGG = [
	{ db_id: 'concert_singer', question: 'average age', query: 'SELECT avg(age) FROM singer' },
	{ db_id: 'concert_singer', question: 'total capacity', query: 'SELECT sum(capacity) FROM stadium' },
];
// the real Spider set-op query the combination targets.
const SETOP_QUERY = 'SELECT country FROM singer WHERE age > 40 INTERSECT SELECT country FROM singer WHERE age < 30';

test('the adapter tags a real Spider set-op query (the class combineMethods covers)', () => {
	const m = getAdapter('spider').adapt({ db_id: 'concert_singer', question: 'countries with both an over-40 and an under-30 singer', query: SETOP_QUERY });
	assert.equal(m.setop, 'intersect');
	assert.equal(m.klass, 'filter>select|intersect', 'a distinct set-op class (would otherwise need its own forge)');
});

test('combineMethods — two distilled grammars COMBINE into a set-op method that MOUNTS a diamond on the real engine (0 forge)', async () => {
	const left = await distilFrom('filter>select', FILTER_A);        // A: filter>select
	const right = await distilFrom('filter>select', FILTER_B);       // B: filter>select
	assert.ok(left && right, 'both operand grammars distilled + gold-gated');

	const combined = combineMethods(left, right, 'intersect');
	assert.ok(combined, 'the two distilled grammars combine');
	assert.deepEqual(combined.combinedFrom, ['Crystal_filter_select', 'Crystal_filter_select'], 'provenance = both operand grammars');
	assert.equal(combined.setop, 'intersect');
	assert.ok(combined.contractDerived, 'the contract is DERIVED (union of both branches), not inherited');

	const g = await mountCombined(combined, 'filter>select|intersect');
	const o = ( id ) => g._objById[id] && g._objById[id]._etty._;
	assert.equal(o('Z').Combine, true, 'the outer segment became a Combine parent');
	assert.equal(o('Z').setop, 'intersect');
	assert.ok(o('Z_L_m0') && o('Z_R_m0'), 'BOTH branches mounted (left + right sub-queries)');
	assert.ok(o('Z_c'), 'the combine node mounted');
	// the DIAMOND: both branches converge at the combine node (a node with two incoming segments — legitimate).
	const incoming = Object.values(g._objById).filter(( x ) => x._etty && x._etty._.Segment && x._etty._.targetNode === 'Z_c' ).map(( x ) => x._etty._._id );
	assert.equal(incoming.length, 2, 'the combine node has TWO incoming edges — both branches converge');
	assert.equal(o('Z_out').setop, 'intersect', 'the set-op segment joins the combine node to the target');
	assert.equal(o('Z_out').targetNode, 'Y', 'and terminates at the outer target');
	assert.ok(g.getRevisions().length < 100, 'bounded — no apply-cap runaway');
	assert.ok(!g._objById['S0'] && !g._objById['E0'], 'no distillation-episode id-space leaked (sound)');
});

test('combineMethods — combines DIFFERENT-shape grammars too (generality): filter>select ∩ aggregate>select', async () => {
	const left = await distilFrom('filter>select', FILTER_A);
	const right = await distilFrom('aggregate>select', AGG);
	const combined = combineMethods(left, right, 'except');
	assert.ok(combined && combined.setop === 'except');
	const g = await mountCombined(combined, 'filter>select|except');
	const o = ( id ) => g._objById[id] && g._objById[id]._etty._;
	assert.equal(o('Z_L_m0').state, 'filter', 'left branch = filter');
	assert.equal(o('Z_R_m0').state, 'aggregate', 'right branch = aggregate (a different-shape operand)');
	assert.equal(o('Z_out').setop, 'except');
});

test('combine vs blend — the two operators are DISTINCT: combine is PARALLEL (no interface discharge), blend is SERIES (nesting)', async () => {
	const left = await distilFrom('filter>select', FILTER_A);
	const right = await distilFrom('aggregate>select', AGG);
	const combined = combineMethods(left, right, 'union');
	const blended = blendMethods(left, right);
	// blend NESTS the donor inside the host's filter slot → depth-2 (a subquery). combine PARALLELS → depth stays 1
	// at the outer level but adds a fork (both branches are depth-1 siblings + a combine step) — structurally different.
	assert.equal(methodDepth(blended), 2, 'blend = series/nesting → depth-2');
	// the combined method has BOTH branch bodies + a combine node under ONE parent (a fork), not a nested subquery.
	const tpl = Object.values(combined.templatesBySig)[0];
	const ids = tpl.map(( o ) => o.$$_id || o.$_id || o._id );
	assert.ok(ids.some(( i ) => /_L_/.test(i)) && ids.some(( i ) => /_R_/.test(i)), 'combine has TWO named branches (L and R) — a fork, not a nest');
	assert.ok(ids.some(( i ) => /_c$/.test(i)) && ids.some(( i ) => /_out$/.test(i)), 'and a combine node + set-op segment');

	// NEG — an empty method → null (no false combination).
	assert.equal(combineMethods({ templatesBySig: {} }, right, 'union'), null, 'empty left → null');
	assert.equal(combineMethods(left, { templatesBySig: {} }, 'union'), null, 'empty right → null');
});

test('composeContract — the combined contract is the UNION of both branches (both compute; the combine reads both)', () => {
	const a = { read: ['Segment'], write: ['A'], pre: [], post: ['A==true'], effect: 'pure' };
	const b = { read: ['Segment'], write: ['B'], pre: [], post: ['B==true'], effect: 'pure' };
	const c = composeContract(a, b);
	assert.deepEqual(c.write.sort(), ['A', 'B'], 'both branches write into the combined result');
	assert.deepEqual(c.post.sort(), ['A==true', 'B==true'], 'both posts conjoined (the runtime monitors both)');
});
