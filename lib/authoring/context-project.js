/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * context-project — GRAPH-NATIVE CONTEXT PROJECTION (the R1 §2 "contexte par nœud", ZERO-CORE). A big roadmap
 * does not fit one context window, so no node ever sees the whole task: each part reads its BOUNDED neighbourhood
 * from the graph's STRUCTURE and completes its own prompt. Kill-gated on the real engine (the study
 * `WIP/experiments/2026-07-08-graph-context-completion/` — reactive-pool.js the reference, recursive.js multi-level).
 *
 * THE MECHANISM (all by structure, no orchestrator):
 *   • the roadmap is seeded as SEGMENTS + a POOL ref by the parent (versionable key-values): `available` (produced
 *     resources), `wait_<res>` (who awaits <res>), `val_<res>` (the value). A part reads its inputs from the pool.
 *   • a dependency is a COUNTER GATE `ensure:'$got.length == $expected'` — a producer posts its resource to the
 *     pool and PUSHes its name into each waiter's `got`; the waiter casts when it has all of them. Arity-agnostic,
 *     one gate. The ORDER EMERGES from the data-flow (a consumer casts strictly after its producers).
 *   • RECURSIVE: a step with `sub` is a COMPOSITE — once its inputs are ready it seeds a SUB-pool + its sub-steps,
 *     DOWN-PROJECTS its resolved inputs into the sub-pool (bounded context for the children), and wires the
 *     sub-plan's TERMINAL leaf (the one that produces the composite's resource) to REPORT UP to the parent pool.
 *   • NO RUNTIME DEADLOCK: propagation is MONOTONE + deterministic, so a stuck part is a DÉCOUPAGE BUG (a resource
 *     awaited with no producer, or a cycle), caught OFFLINE by `guardPlan` (coverage + footprintCycles, recursive).
 *     A mis-split never hangs (the engine goes quiescent) and never silently builds with a missing input (a leaf
 *     gates on ALL its needs; only the down-projected ones are pre-satisfied) — it is REFUSED before seeding.
 *   • STATELESS / VERSIONABLE → COLD-REBOOTABLE: serialize → new Graph → identical state, 0 re-fire (a completed
 *     roadmap is a fixpoint). Follows the mutation-sequencing discipline (every change through the taskflow).
 *
 * USABLE À NU (domain-agnostic): the host supplies a `roadmap` of `{ id, needs, produces, sub? }` and a `serve`
 * (the bounded work — a deterministic stub, or the C6 ladder / an LLM in production). `plan-loop.js` wires this as
 * its REAL projection (each leaf served WITH its completed bounded context, in emergent order) in place of the
 * abstract per-leaf map.
 *
 *   const { createContextProjection, guardPlan } = require('skynet-graph/lib/authoring/context-project');
 *   const proj = createContextProjection({ serve: async (leaf) => callModel(leaf.prompt) });
 *   const { order, results, refusal } = await proj.run(roadmap, ctx);
 */
const Graph = require('../graph/index.js');
const { nextStable } = require('./supervise.js');
const { footprintCycles } = require('./contract.js');

// ── guardPlan — the OFFLINE deadlock guard (recursive). A level is coherent iff every `need` has a producer at
// that level OR is inherited (down-projected from a composite's inputs), and the data-flow is acyclic. The ONLY
// place a "deadlock" can live is a bad split; this converts a silent starve into a typed refusal BEFORE seeding. ──
function guardPlan( roadmap, inherited ) {
	inherited = inherited || [];
	const producers = new Set(roadmap.map(( s ) => s.produces ).concat(inherited));
	const uncovered = [], cycles = [];
	const methodOf = ( s ) => ({ name: s.id, contract: { read: (s.needs || []).filter(( n ) => !inherited.includes(n) ), write: [s.produces], effect: 'effect' } });
	cycles.push(...footprintCycles(roadmap.map(methodOf)));
	for ( const s of roadmap ) {
		for ( const n of (s.needs || []) ) if ( !producers.has(n) ) uncovered.push({ step: s.id, need: n });
		if ( s.sub ) {
			if ( !s.sub.some(( c ) => c.produces === s.produces ) ) uncovered.push({ step: s.id, need: '(no sub-terminal produces ' + s.produces + ')' });
			const sub = guardPlan(s.sub, s.needs);                        // the composite's inputs are available DOWN in the sub-plan
			uncovered.push(...sub.uncovered); cycles.push(...sub.cycles);
		}
	}
	return { ok: uncovered.length === 0 && cycles.length === 0, uncovered, cycles };
}

// ── the concept map: a leaf STEP (counter gate → serve → post + notify [+ report up]) and a COMPOSITE DECOMPOSE
// (counter gate on inputs → seed the sub-plan). One-shot casts guarded by the `_name` marker (re-fire guard). ──
const CONCEPT_MAP = { common: { childConcepts: {
	Task: { _id: 'Task', _name: 'Task', require: 'Segment', childConcepts: {
		Step:      { _id: 'Step',      _name: 'Step',      require: ['Task', 'isStep'],      ensure: ['$got.length == $expected'], provider: ['CtxProj::step'] },
		Decompose: { _id: 'Decompose', _name: 'Decompose', require: ['Task', 'isComposite'], ensure: ['$got.length == $expected'], provider: ['CtxProj::decompose'] },
	} }
} } };

// default prompt completion — the bounded neighbourhood: the ancestor statement + the resolved inputs + the goal to produce.
function defaultComplete( leaf ) {
	const inputs = Object.keys(leaf.inputs).map(( k ) => k + '=' + leaf.inputs[k] );
	return 'GOAL ' + leaf.statement + (inputs.length ? ' · USE ' + inputs.join(',') : ' · (root)')
		+ (leaf.reportsUp ? ' · REPORT-UP ' + leaf.produces : '') + ' · PRODUCE ' + leaf.produces;
}

// build the seed for the TOP level (a parent énoncé + a pool ref by it, pre-populated with the wait index).
// `givens` ({ key: value }, optional) = the task's BASE FACTS (givens.js front-door): seeded as already-available
// `val_<key>` pool entries, and every step's given-needs are PRE-SATISFIED (counted in `got` like a down-projected
// input) — the same inherited semantics as a composite's down-projection, applied at the top level.
function buildSeed( roadmap, statement, givens ) {
	givens = givens || {};
	const pool = { _id: 'POOL', _isPool: true, available: Object.keys(givens) };
	Object.keys(givens).forEach(( g ) => { pool['val_' + g] = givens[g]; });
	roadmap.forEach(( s ) => { pool['wait_' + s.produces] = pool['wait_' + s.produces] || []; });
	roadmap.forEach(( s ) => (s.needs || []).filter(( n ) => !(n in givens) ).forEach(( n ) => { (pool['wait_' + n] = pool['wait_' + n] || []).push(s.id); }) );
	const nodes = [{ _id: 'nRoot', Node: true }, pool];
	const segments = [{ _id: 'PARENT', Segment: true, originNode: 'nRoot', targetNode: 'nRoot', statement: statement, pool: 'POOL' }];
	roadmap.forEach(( s ) => {
		nodes.push({ _id: 'a_' + s.id, Node: true }, { _id: 'b_' + s.id, Node: true });
		const seg = { _id: s.id, Segment: true, originNode: 'a_' + s.id, targetNode: 'b_' + s.id, parentSeg: 'PARENT',
			pool: 'POOL', needs: s.needs || [], produces: s.produces, expected: (s.needs || []).length,
			got: (s.needs || []).filter(( n ) => n in givens ) };
		if ( s.slot ) seg.slot = s.slot;                             // carry the method-slot (higher-order need) to the leaf — inert data, like `sub`
		if ( s.sub ) { seg.isComposite = true; seg.sub = s.sub; } else seg.isStep = true;
		segments.push(seg);
	});
	return { lastRev: 0, nodes, segments };
}

// enumerate every id in the roadmap tree (top + all sub levels) — for collecting results incl. runtime sub-steps.
function allSteps( roadmap ) { return roadmap.flatMap(( s ) => [s].concat(s.sub ? allSteps(s.sub) : []) ); }

function makeProviders( serve, complete, ctx, order ) {
	return { CtxProj: {
		// LEAF — read bounded inputs from own pool, SERVE (the injected bounded work), post to own pool + notify, report up if terminal.
		step: function ( graph, concept, scope, argz, cb ) {
			(async () => {
				const self = scope._, pool = graph.getEtty(self.pool)._;
				const inputs = {}; (self.needs || []).forEach(( n ) => { inputs[n] = pool['val_' + n]; });
				const leaf = { id: self._id, statement: graph.getEtty(self.parentSeg)._.statement, produces: self.produces,
					needs: self.needs || [], inputs: inputs, reportsUp: !!self.up_res, slot: self.slot };
				const prompt = complete(leaf);
				let value;
				try { value = await serve(Object.assign({ prompt: prompt }, leaf), ctx); }
				catch ( e ) { return cb(e); }
				order.push(self._id);
				const tpl = [ { $_id: '_parent', Step: true, prompt: prompt, out: value } ];
				tpl.push({ $$_id: self.pool, available: { __push: self.produces }, ['val_' + self.produces]: value });
				(pool['wait_' + self.produces] || []).forEach(( wid ) => tpl.push({ $$_id: wid, got: { __push: self.produces } }) );
				if ( self.up_res ) {                                                      // REMONTÉE — deliver to the parent pool + notify parent waiters
					tpl.push({ $$_id: self.up_pool, available: { __push: self.up_res }, ['val_' + self.up_res]: value });
					(self.up_wait || []).forEach(( wid ) => tpl.push({ $$_id: wid, got: { __push: self.up_res } }) );
				}
				cb(null, tpl);
			})();
		},
		// COMPOSITE — inputs ready → seed a SUB-pool ref by me + my sub-steps, DOWN-project my inputs, wire the terminal UP.
		decompose: function ( graph, concept, scope, argz, cb ) {
			const self = scope._, pool = graph.getEtty(self.pool)._, sub = self.sub, SUB = 'SUBPOOL_' + self._id;
			order.push(self._id + ':decompose');
			const subProducers = new Set(sub.map(( c ) => c.produces ));
			const downSet = new Set(self.needs || []);
			const subPool = { _id: SUB, _isPool: true, available: (self.needs || []).slice() };
			(self.needs || []).forEach(( n ) => { subPool['val_' + n] = pool['val_' + n]; });   // ← down-projection (bounded ctx for children)
			sub.forEach(( c ) => { subPool['wait_' + c.produces] = subPool['wait_' + c.produces] || []; });
			sub.forEach(( c ) => (c.needs || []).filter(( n ) => subProducers.has(n) ).forEach(( n ) => subPool['wait_' + n].push(c.id) ) );
			const tpl = [ { $_id: '_parent', Decompose: true, prompt: complete({ id: self._id, statement: graph.getEtty(self.parentSeg)._.statement, produces: self.produces, needs: self.needs || [], inputs: {}, reportsUp: false }) }, subPool ];
			sub.forEach(( c ) => {
				// a runtime-created node needs Node:true (else it lands as a generic record with no _outgoing → relink throws).
				tpl.push({ _id: 'a_' + c.id, Node: true }, { _id: 'b_' + c.id, Node: true });
				// gate on ALL needs; pre-fill `got` with the down-projected (already-satisfied) inputs → an uncovered
				// need stays in `expected` but never enters `got` (visible famine, not a silent build).
				const preGot = (c.needs || []).filter(( n ) => downSet.has(n) );
				const seg = { _id: c.id, Segment: true, originNode: 'a_' + c.id, targetNode: 'b_' + c.id, parentSeg: self._id,
					pool: SUB, needs: c.needs || [], produces: c.produces, expected: (c.needs || []).length, got: preGot.slice() };
				if ( c.slot ) seg.slot = c.slot;                                          // carry a nested method-slot down the recursion too
				if ( c.sub ) { seg.isComposite = true; seg.sub = c.sub; } else seg.isStep = true;   // deeper recursion supported
				if ( c.produces === self.produces ) {                                     // the TERMINAL → report UP to the parent pool
					seg.up_pool = self.pool; seg.up_res = self.produces; seg.up_wait = (pool['wait_' + self.produces] || []).slice();
				}
				tpl.push(seg);
			});
			cb(null, tpl);
		},
	} };
}

/**
 * createContextProjection(opts) — build a reusable projection.
 * @param opts.serve    async (leaf, ctx) => value  REQUIRED. leaf = { id, statement, produces, needs, inputs, prompt, reportsUp }.
 * @param opts.complete (leaf) => promptString      the bounded prompt (default: statement · USE inputs · PRODUCE).
 * @param opts.label    graph label.
 * @returns { run(roadmap, ctx), guardPlan, conceptMap, buildSeed }
 */
function createContextProjection( opts ) {
	opts = opts || {};
	if ( typeof opts.serve !== 'function' ) throw new Error('createContextProjection needs opts.serve(leaf,ctx) -> value');
	const complete = opts.complete || defaultComplete;
	const label = opts.label || 'context-projection';

	async function run( roadmap, ctx ) {
		const statement = (ctx && ctx.statement) || 'ROADMAP';
		const givens = (ctx && ctx.givens) || {};                                        // the task's base facts (givens.js) — inherited at the top level
		const guard = guardPlan(roadmap, Object.keys(givens));
		if ( !guard.ok ) return { order: [], results: {}, refusal: guard.cycles.length ? 'CYCLE' : 'UNCOVERED', guard, graph: null };
		const order = [];
		const saved = Graph._providers;                                                  // forge idiom: set globally, restore in finally
		Graph._providers = Object.assign({}, saved, makeProviders(opts.serve, complete, ctx, order));
		let g;
		try {
			g = new Graph(buildSeed(roadmap, statement, givens), { label: label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {} }, CONCEPT_MAP);
			await nextStable(g);
		} finally { Graph._providers = saved; }
		// collect completed contexts (stable roadmap order — NOT the async cast order — so the result is deterministic)
		const results = {};
		for ( const s of allSteps(roadmap) ) {
			const e = g.getEtty(s.id), f = e && e._;
			if ( f && f.Step === true ) results[s.id] = { kind: 'leaf', value: f.out, prompt: f.prompt, needs: s.needs || [], produces: s.produces };
			else if ( f && f.Decompose === true ) results[s.id] = { kind: 'composite', prompt: f.prompt, produces: s.produces };
			else results[s.id] = { kind: 'starved', needs: s.needs || [], produces: s.produces };   // a mis-split part that never gated (guardPlan should have caught it)
		}
		return { order, results, refusal: null, guard, graph: g };
	}

	return { run: run, guardPlan: guardPlan, conceptMap: CONCEPT_MAP, buildSeed: buildSeed, complete: complete };
}

module.exports = { createContextProjection, guardPlan, defaultComplete, buildSeed, CONCEPT_MAP, makeProviders, allSteps };
