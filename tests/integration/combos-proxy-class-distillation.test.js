'use strict';
/**
 * TYPED INTAKE per-CLASSE IN FRONT OF C6 — DISTILLATION, NOT JUST THE KEY (owner NEXT, 2026-07-06).
 * `makeTypedIntakeKey` (8d370e9) made one frontier ANSWER cover a typed class. This closes the named gap
 * "intake typé per-CLASSE devant C6 (distillation, pas juste la clé)": the proxy's stock holds distilled class
 * METHODS (the grammar-stock unit — executable, engine-mountable), and the typed intake is the prose FRONT DOOR
 * into that method space. The alignment is two existing seams + one 2-line option — zero new combo logic:
 *   • `makeTypedIntakeKey({ classOf })` mints the CLASS NAME (e.g. 'avg|1', the dataset-adapter class) instead
 *     of the opaque digest — same Invariant-2 gate (classOf is consulted only on a `typed` projection);
 *   • `packStock(admitted, { structureKey: 'q' })` packs the distilled grammar in the PROXY's own default
 *     signature space ({q: <class>}) — so `proxy.load(bundle)` puts each class method straight into the
 *     exact-replay path a prose query's typed key hits.
 *
 * THE CIRCUIT IT LOCKS (each stage a gate + a control):
 *   T1 a prose query of a DISTILLED class is served the class METHOD from local stock at 0 frontier calls —
 *      and the method MOUNTS on the real engine (it is an executable decomposition, not a cached string);
 *   T2 per-class ENRICHMENT: an uncovered class escalates ONCE (gold-gated by opts.verify), then a DIFFERENT
 *      prose instance of the same class is served local (the frontier answer covered the CLASS, not the query);
 *   T3 soundness: OOV prose (attribute out of the declared vocab) → untyped → NO class key → escalates, never
 *      collapses onto a class method; and a verify-REJECTED frontier decomposition is served but NOT cached
 *      (the next same-class query re-escalates — no stock pollution).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { methodTrace } = require('../../plugins/learning/lib/mine.js');
const { createLearningLibrary } = require('../../plugins/learning/combo.js');
const { createProxyCache, makeTypedIntakeKey } = require('../../lib/combos/proxy-cache.js');
const { goldGate, packStock } = require('../../lib/authoring/forge/stock.js');
const { getAdapter, loadDataset } = require('../../lib/authoring/forge/dataset-adapter.js');
const { instantiate, ctxFromScope } = require('../../lib/authoring/core/abstract.js');
const { injectMarker, guardKey } = require('../../plugins/learning/lib/combinator.js');
console.log = console.info = console.warn = () => {};

// ── the declared domain: WikiSQL-shaped classes {agg}|{nConds} (the dataset-adapter class space) ──────────────
const FACTS = {
	agg  : { enum: ['none', 'count', 'max', 'min', 'sum', 'avg'] },
	conds: { enum: ['1', '2'] }
};
const classOf = ( f ) => f.agg + '|' + f.conds;

// the intake extractor STUB (stands in for the live 9B — the real extraction is proven in the 07-06 GPU cell):
// deterministic keyword → declared facts. OOV attributes (e.g. "variance") map to nothing → untyped.
const localAsk = async ({ user }) => {
	const q = String(user).toLowerCase();
	const agg = /\bhow many\b|\bcount\b/.test(q) ? 'count' : /\baverage\b|\bmean\b/.test(q) ? 'avg'
		: /\bhighest\b|\bmaximum\b/.test(q) ? 'max' : /\bvariance\b|\bmedian\b/.test(q) ? 'variance'
		: /\bwhat\b|\bwhich\b/.test(q) ? 'none' : null;
	const conds = (q.match(/\bwhere\b|\bwith\b|\bfrom\b|\bin\b/g) || []).length >= 2 ? '2' : '1';
	return JSON.stringify(agg ? { agg, conds } : { conds });
};

// ── distil class methods from in-memory WikiSQL-shaped records (the blend-distilled-grammar pattern) ──────────
const TREE = { childConcepts: { Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'taskKind'], ensure: ['!$Planned'], provider: ['Plan::plan'] } } };
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'class-distill', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
const node = ( id ) => ({ _id: id });
const RECORDS = [
	{ question: 'What is the average age of dogs in the shelter?', table_id: 't1', sql: { sel: 1, agg: 5, conds: [[0, 0, 'x']] } },
	{ question: 'What is the average salary of pilots in the fleet?', table_id: 't1', sql: { sel: 2, agg: 5, conds: [[1, 0, 'y']] } },
	{ question: 'Which city is in the north region?', table_id: 't1', sql: { sel: 0, agg: 0, conds: [[2, 0, 'z']] } },
	{ question: 'Which team is in the east division?', table_id: 't1', sql: { sel: 1, agg: 0, conds: [[0, 0, 'w']] } }
];

async function distil( sig, recs ) {
	const plans = {};
	recs.forEach(( r, i ) => { r.recId = sig + '#' + i; plans[r.recId] = r; });
	Graph._providers = Object.assign({}, Graph._providers, { Plan: { plan: function ( g, c, scope, argz, cb ) {
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
	} } });
	const nodes = [], segments = [];
	recs.forEach(( r, i ) => { nodes.push(node('S' + i), node('G' + i)); segments.push({ _id: 'E' + i, originNode: 'S' + i, targetNode: 'G' + i, taskKind: sig, recId: r.recId }); });
	const mt = methodTrace();
	const g = new Graph({ lastRev: 0, nodes, segments }, CFG, { common: TREE });
	mt.listen(g);
	await nextStable(g);
	const lib = createLearningLibrary({ learning: true, signature: ( p ) => ({ structure: { taskKind: p.taskKind }, content: {} }),
		target: () => null, dispatchFacts: ( p ) => ({ Segment: true, taskKind: p.taskKind }), forge: async () => null });
	const res = lib.crystallizeFrom(mt.records, { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL, equivKeys: ['Planned'], idFor: () => 'Crystal_' + sig.replace(/[^a-z]/gi, '_') });
	const gate = goldGate({ modelShapes: recs.map(( r ) => r.goldShape ), goldSteps: recs[0].goldShape, crystallized: !!res.admitted });
	assert.ok(gate.admitted, 'distillation admitted for ' + sig);
	return res.candidate;
}

// distil the two seed classes from the records through the REAL wikisql adapter (records path, no fs).
async function distilledBundle() {
	const byClass = loadDataset(getAdapter('wikisql'), { records: RECORDS });
	const avg1 = await distil('avg|1', byClass['avg|1']);
	const none1 = await distil('none|1', byClass['none|1']);
	// pack in the PROXY's default signature space: structure = { q: <class> } — the two seams meet here.
	return packStock([{ sig: 'avg|1', candidate: avg1 }, { sig: 'none|1', candidate: none1 }], { name: 'class-grammar', version: 'v1', structureKey: 'q' });
}

// a fresh proxy in front of a call-counted frontier that answers with a CLASS decomposition (typed steps).
function makeProxy( opts ) {
	const frontier = { calls: 0, byQuery: [] };
	const FRONTIER_DECOMPO = { 'count|1': ['filter', 'aggregate', 'select'], 'count|2': ['filter', 'filter', 'aggregate', 'select'] };
	const tk = makeTypedIntakeKey({ localAsk, facts: FACTS, classOf });
	const px = createProxyCache(Object.assign({
		semanticKey: tk.semanticKey,
		frontierAsk: async ( q ) => {
			frontier.calls++; frontier.byQuery.push(q);
			const p = await tk.project(q);
			const cls = p.key || 'unknown';
			return { steps: (opts && opts.corruptFrontier) ? ['select'] : (FRONTIER_DECOMPO[cls] || ['select']), forClass: cls };
		},
		// the GOLD-GATE seam: the frontier's decomposition must match the class's gold shape, else serve-don't-cache.
		verify: async ( q, ans ) => {
			const p = await tk.project(q);
			const gold = p.key && FRONTIER_DECOMPO[p.key];
			return !!(gold && ans && ans.steps && ans.steps.join('>') === gold.join('>'));
		}
	}, opts && opts.px), { tk, frontier });
	return { px, tk, frontier };
}

// mount a served class method at a fresh engine site (the method is EXECUTABLE, not a string).
async function mountServed( cand, taskKind ) {
	const tpl = Object.values(cand.templatesBySig)[0];
	Graph._providers = Object.assign({}, Graph._providers, { Creative: { Decompose: function ( g, c, scope, argz, cb ) {
		const ctx = ctxFromScope(scope, { frontier: { origin: 'originNode', target: 'targetNode' } });
		const gr = ctx && instantiate(tpl, ctx);
		return cb(null, gr ? injectMarker(gr, ctx.base, 'Decompose') : { $_id: '_parent', Decompose: true, [guardKey('Decompose')]: true });
	} } });
	const D = { _id: 'Decompose', _name: 'Decompose', require: ['Segment', 'taskKind', 'toDecompose'], ensure: ['!$' + guardKey('Decompose')], provider: ['Creative::Decompose'] };
	const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] }, CFG, { common: { childConcepts: { Decompose: D } } });
	await nextStable(g);
	await new Promise(( res ) => g.pushMutation({ _id: 'Z', Segment: true, originNode: 'X', targetNode: 'Y', taskKind, toDecompose: true }, null, undefined, undefined, undefined, () => res()));
	await nextStable(g);
	return g;
}

test('T1 — a prose query of a DISTILLED class is served the class METHOD locally (0 frontier calls) and it mounts on the engine', async () => {
	const bundle = await distilledBundle();
	const { px, frontier } = makeProxy();
	const ld = px.load(bundle, { version: 'v1' });
	assert.ok(ld.exactReplaySafe && ld.exactReplayed === 2, 'the .sgc grammar loaded into the exact-replay path (2 class methods)');

	// two DIFFERENT prose phrasings, same typed class avg|1 → BOTH served the distilled method at 0 frontier calls.
	const r1 = await px.answer('What is the average age of the dogs?');
	const r2 = await px.answer('What is the mean salary of a pilot?');
	assert.equal(frontier.calls, 0, 'ZERO frontier calls — the distilled grammar covers the class');
	assert.equal(r1.source, 'local'); assert.equal(r2.source, 'local');
	assert.ok(r1.answer && r1.answer.templatesBySig, 'the served payload IS the class METHOD (a crystallized candidate)');
	assert.equal(r1.answer, r2.answer, 'both prose instances collapse onto the SAME class method');

	// the served method is EXECUTABLE: it mounts a 2-step chain (filter → aggregate/select) on the real engine.
	const g = await mountServed(r1.answer, 'avg|1');
	const mounted = Object.values(g._objById).filter(( x ) => x._etty && x._etty._.Segment && x._etty._.parentSeg === 'Z');
	assert.ok(mounted.length >= 2, 'the class method mounted as a real decomposition (' + mounted.length + ' child segments)');
	assert.ok(g.getRevisions().length < 100, 'bounded');
});

test('T2 — per-class ENRICHMENT: an uncovered class escalates ONCE (gold-gated), then a different prose instance is served local', async () => {
	const bundle = await distilledBundle();
	const { px, frontier } = makeProxy();
	px.load(bundle, { version: 'v1' });

	// 'count|1' is NOT in the distilled bundle → the first prose instance escalates to the frontier.
	const r1 = await px.answer('How many dogs are in the shelter?');
	assert.equal(r1.source, 'frontier');
	assert.equal(frontier.calls, 1);
	assert.deepEqual(r1.answer.steps, ['filter', 'aggregate', 'select'], 'the frontier answered the CLASS decomposition (gold-gated by verify)');

	// a DIFFERENT prose instance of the SAME class → served local: the frontier answer covered the CLASS.
	const r2 = await px.answer('How many pilots are in the fleet?');
	assert.equal(r2.source, 'local', 'the class is now covered — a different instance is served from stock');
	assert.equal(frontier.calls, 1, 'the frontier was called EXACTLY once for the whole class');
});

test('T3 — soundness: OOV prose never collapses onto a class; a verify-rejected frontier answer is served but NOT cached', async () => {
	const bundle = await distilledBundle();

	// (a) OOV attribute ("variance" ∉ agg enum) → untyped → null key → exact-key escalate, never a class method.
	const { px, tk, frontier } = makeProxy();
	px.load(bundle, { version: 'v1' });
	const p = await tk.project('What is the variance of the age of dogs?');
	assert.equal(p.status, 'untyped'); assert.equal(p.key, null, 'Invariant-2: no reusable key for OOV prose');
	const r = await px.answer('What is the variance of the age of dogs?');
	assert.equal(r.source, 'frontier', 'OOV escalates');
	assert.ok(!(r.answer && r.answer.templatesBySig), 'never served a distilled class method for an OOV query');
	assert.equal(frontier.calls, 1);

	// (b) a WRONG frontier decomposition (≠ gold) is REJECTED by verify → served to the user, NOT cached:
	//     the next same-class query re-escalates (no stock pollution — the distillation gate in the proxy).
	const bad = makeProxy({ corruptFrontier: true });
	bad.px.load(bundle, { version: 'v1' });
	const b1 = await bad.px.answer('How many dogs are in the shelter?');
	assert.equal(b1.source, 'frontier'); assert.equal(b1.arm, 'escalate', 'verify rejected the distillation (served uncached)');
	const b2 = await bad.px.answer('How many cats are in the shelter?');
	assert.equal(b2.source, 'frontier', 'same class re-escalates — the rejected decomposition never entered the stock');
	assert.equal(bad.frontier.calls, 2);
});
