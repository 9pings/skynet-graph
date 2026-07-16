'use strict';
/**
 * COMBINE WIRED INTO THE COMBO LADDER — the 2nd composition operator exposed like blend (owner NEXT, 2026-07-06).
 * `combine-methods-setop.test.js` proved `combineMethods` at the BRICK level (distil two grammars → combine →
 * mount a diamond) but drove it DIRECTLY (a hand-keyed provider, never through dispatch/index). `blendMethods`
 * is reachable through the master-loop FORGE arm as an opt-in rung (`opts.blend`, learning-library.js). This
 * test closes the named gap "câbler combineMethods dans le combo/proxy (l'exposer comme blend l'est via
 * opts.blend)": a SET-OP task solved through `createLearningLibrary` COMPOSES two already-distilled operand
 * grammars at 0 model calls (the combine rung) instead of a fresh multi-step forge, mounts as a real diamond,
 * and amortizes on repeat. Deterministic, self-contained (in-memory records → the real adapter, no fs / model).
 *
 * THE FINDINGS IT LOCKS (critique §3 — understand the mechanism, not a green vacuum):
 *   • the rung fires on the FORGE arm at cost 0 (a fresh forge would cost ≥1) → operand grammars are REUSED for
 *     free to synthesize set-op methods (K operand classes cover > K set-op query types — the blend payoff, on
 *     the parallel/set-op half of Spider's composition);
 *   • the exact-repeat amortizes to a 0-call MATCH (the master-loop cache), like any solved problem;
 *   • the RE-KEY is LOAD-BEARING (soundness): the combined method covers the SET-OP class, so it is bucketed by
 *     the set-op signature — a PLAIN operand task never false-hits the heavier diamond method. The NEG control
 *     shows that WITHOUT the outer-class re-key the combined method collides with the LEFT operand's bucket.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { methodTrace } = require('../../plugins/learning/lib/mine.js');
const { createLearningLibrary } = require('../../plugins/learning/combo.js');
const { goldGate } = require('../../lib/authoring/forge/stock.js');
const { getAdapter, loadDataset } = require('../../lib/authoring/forge/dataset-adapter.js');
const { combineMethods } = require('../../plugins/learning/lib/adapt.js');
const libMod = require('../../plugins/learning/lib/library.js');
const { libraryKey } = require('../../plugins/learning/lib/crystallize.js');
const { instantiate, ctxFromScope } = require('../../lib/authoring/core/abstract.js');
const { injectMarker, guardKey } = require('../../plugins/learning/lib/combinator.js');
console.log = console.info = console.warn = () => {};

const TREE = { childConcepts: { Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'taskKind'], ensure: ['!$Planned'], provider: ['Plan::plan'] } } };
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'combine-rung', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
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

// distil ONE class method from RAW spider records: adapter → live graph → trace → crystallizeFrom → gold-gate.
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
	const gate = goldGate({ modelShapes: recs.map(( r ) => r.goldShape ), goldSteps: recs[0].goldShape, crystallized: !!res.admitted });
	return gate.admitted ? res.candidate : null;
}
const distilFrom = ( sig, rawRecords ) => distil(sig, loadDataset(getAdapter('spider'), { records: rawRecords })[sig]);

// mount the combined candidate at a fresh site (Decompose combinator instantiates its template) → the graph.
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

const FILTER_A = [
	{ db_id: 'concert_singer', question: 'countries of singers older than 40', query: "SELECT country FROM singer WHERE age > 40" },
	{ db_id: 'concert_singer', question: 'names of French singers', query: "SELECT name FROM singer WHERE country = 'France'" },
];
const AGG = [
	{ db_id: 'concert_singer', question: 'average age', query: 'SELECT avg(age) FROM singer' },
	{ db_id: 'concert_singer', question: 'total capacity', query: 'SELECT sum(capacity) FROM stadium' },
];

// build a learning library whose FORGE arm can COMBINE: the host's `opts.combine` owns the decomposition (which two
// operand methods + which set-op), symmetric to opts.target/dispatchFacts. It returns the two pre-distilled operand
// candidates + the op from the task facts; the fallthrough host forge returns a plain operand method at cost 1.
function makeCombo( left, right ) {
	let forgeCalls = 0;
	const combo = createLearningLibrary({
		learning: true,
		// exact cache key: a set-op task and a plain task differ (setop in the structure); two identical set-op
		// tasks collide → amortize. content empty (deterministic).
		signature: ( p ) => ({ structure: { taskKind: p.taskKind, setop: p.setop || null }, content: {} }),
		// the class the task dispatches for — a set-op task keys by ['setop'] (its own bucket), a plain by ['taskKind'].
		target     : ( p ) => (p.setop ? { signatureKeys: ['setop'] } : { signatureKeys: ['taskKind'] }),
		dispatchFacts: ( p ) => (p.setop ? { Segment: true, setop: p.setop } : { Segment: true, taskKind: p.taskKind }),
		// THE COMBINE RUNG (opt-in) — before a fresh forge, if the task is a set-op, combine the two operand
		// grammars in parallel + join with the op (0 model calls). outerClass re-keys the result to the set-op class.
		combine: function ( scopeFacts, lib ) {
			if ( !scopeFacts.setop ) return null;
			return { left: left, right: right, op: scopeFacts.setop, outerClass: { signatureKeys: ['setop'] } };
		},
		// fallthrough forge (the plain-operand path): returns a valid filter>select method at cost 1.
		forge: async function () { forgeCalls++; return { candidate: left, calls: 1 }; }
	});
	return { combo: combo, forgeCalls: () => forgeCalls };
}

test('the combine rung — a set-op task COMBINES two distilled grammars through the combo FORGE arm at 0 calls (vs a fresh forge)', async () => {
	const left = await distilFrom('filter>select', FILTER_A);
	const right = await distilFrom('aggregate>select', AGG);
	assert.ok(left && right, 'both operand grammars distilled + gold-gated');

	const { combo, forgeCalls } = makeCombo(left, right);
	const r = await combo.solve({ taskKind: 'filter>select|intersect', setop: 'intersect' });

	assert.equal(r.arm, 'forge', 'the set-op task went to the FORGE arm (its exact cache was cold)');
	assert.equal(r.cost, 0, 'but it composed for FREE — 0 model calls (a fresh forge would cost ≥1)');
	assert.equal(forgeCalls(), 0, 'the host forge was NOT called — the rung short-circuited it');
	assert.deepEqual(r.result.combinedFrom, ['Crystal_filter_select', 'Crystal_aggregate_select'], 'provenance = both operand grammars');
	assert.equal(r.result.setop, 'intersect');
	assert.ok(r.result.contractDerived, 'the combined contract is DERIVED (union of both branches)');

	// the composed method MOUNTS as a real diamond on the engine.
	const g = await mountCombined(r.result, 'filter>select|intersect');
	const o = ( id ) => g._objById[id] && g._objById[id]._etty._;
	assert.equal(o('Z').setop, 'intersect', 'the outer segment carries the set-op');
	assert.ok(o('Z_L_m0') && o('Z_R_m0'), 'BOTH branches mounted (left + right sub-queries)');
	assert.ok(o('Z_c'), 'the combine node mounted');
	const incoming = Object.values(g._objById).filter(( x ) => x._etty && x._etty._.Segment && x._etty._.targetNode === 'Z_c' ).map(( x ) => x._etty._._id );
	assert.equal(incoming.length, 2, 'the diamond — the combine node has TWO incoming edges');
	assert.ok(g.getRevisions().length < 100, 'bounded — no apply-cap runaway');
});

test('amortization — the SAME set-op task then hits the master cache at 0 calls; and a DIFFERENT op reuses the operands for free', async () => {
	const left = await distilFrom('filter>select', FILTER_A);
	const right = await distilFrom('aggregate>select', AGG);
	const { combo } = makeCombo(left, right);

	const first = await combo.solve({ taskKind: 'filter>select|intersect', setop: 'intersect' });
	assert.equal(first.arm, 'forge');
	const second = await combo.solve({ taskKind: 'filter>select|intersect', setop: 'intersect' });
	assert.equal(second.arm, 'match', 'the identical set-op task now hits the exact cache');
	assert.equal(second.cost, 0, '0 model calls (amortized)');

	// a DIFFERENT set-op over the SAME two operands also composes for free (K operand grammars → many set-op methods).
	const except = await combo.solve({ taskKind: 'filter>select|except', setop: 'except' });
	assert.equal(except.cost, 0, 'a distinct op (except) reuses the same operands at 0 calls');
	assert.equal(except.result.setop, 'except');
});

test('NEG — no operands / not a set-op → the rung does NOT fire (clean fall-through to the host forge)', async () => {
	const left = await distilFrom('filter>select', FILTER_A);
	const right = await distilFrom('aggregate>select', AGG);
	const { combo, forgeCalls } = makeCombo(left, right);

	// a PLAIN operand task (no setop) → opts.combine returns null → the host forge runs (cost 1, no combinedFrom).
	const plain = await combo.solve({ taskKind: 'filter>select' });
	assert.equal(plain.arm, 'forge');
	assert.equal(plain.cost, 1, 'the host forge ran (the rung did not fire on a non-set-op task)');
	assert.equal(forgeCalls(), 1);
	assert.ok(!plain.result.combinedFrom, 'not a combined method — a plain forge result');
});

test('the RE-KEY is load-bearing (soundness) — the combined method is bucketed by the SET-OP class, not the LEFT operand bucket', async () => {
	const left = await distilFrom('filter>select', FILTER_A);
	const right = await distilFrom('aggregate>select', AGG);

	const leftKey = libMod.frontierOf(left) && (left.libraryKey || libraryKey(libMod.frontierOf(left), left.signatureKeys || []));

	// WITHOUT an outerClass → inherits the LEFT operand's key → collides with the plain filter>select bucket (a
	// plain operand task could false-hit the heavier diamond method). This is the unsound path the rung avoids.
	const naive = combineMethods(left, right, 'intersect');
	const naiveKey = naive.libraryKey || libraryKey(libMod.frontierOf(naive), naive.signatureKeys || []);
	assert.equal(naiveKey, leftKey, 'no re-key → the combined method collides with the LEFT operand bucket (the false-hit risk)');

	// WITH the outer set-op class → re-keyed to a DISTINCT bucket → never confused with a plain operand task.
	const rekeyed = combineMethods(left, right, 'intersect', { signatureKeys: ['setop'] });
	assert.deepEqual(rekeyed.signatureKeys, ['setop'], 'the combined method dispatches on the set-op signature');
	const rekeyedKey = rekeyed.libraryKey || libraryKey(libMod.frontierOf(rekeyed), rekeyed.signatureKeys || []);
	assert.notEqual(rekeyedKey, leftKey, 're-keyed → a SEPARATE bucket from the LEFT operand (no false-hit)');

	// prove it end-to-end (the false-hit is REACHABLE, not just inferred from key equality): a PLAIN operand
	// dispatch over the NAIVE combined DOES surface the heavier diamond method (the bug) — over the RE-KEYED one it
	// does NOT. Same dispatch target both times; only the re-key differs.
	const plainTarget = { signatureKeys: left.signatureKeys, frontier: libMod.frontierOf(left) }, plainFacts = { Segment: true, taskKind: 'filter>select' };
	const naiveLib = libMod.makeLibrary(); libMod.indexMethod(naiveLib, naive);
	assert.ok(libMod.dispatch(naiveLib, plainTarget, plainFacts).candidates.some(( e ) => e.candidate.combinedFrom ),
		'WITHOUT re-key: a plain operand dispatch FALSE-HITS the combined set-op method (the unsound path)');
	const rekeyedLib = libMod.makeLibrary(); libMod.indexMethod(rekeyedLib, rekeyed);
	assert.ok(!libMod.dispatch(rekeyedLib, plainTarget, plainFacts).candidates.some(( e ) => e.candidate.combinedFrom ),
		'WITH re-key: a plain operand dispatch never surfaces the combined method (sound)');
});
