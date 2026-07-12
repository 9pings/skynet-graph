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
 * DETERMINISM CAVEAT (measured, A3 monster harness): independent-ready leaves are served CONCURRENTLY, and the
 * COMPLETION order of in-flight serves is a race. Values are immune (each leaf's inputs come from its own gated
 * needs), but if a host's serve side-feeds OTHER leaves' prompts (e.g. a "DONE so far" summary channel), that
 * prompt content becomes completion-order-dependent and replays diverge. Fix at the host: serialize the serves
 * (`let q = Promise.resolve(); serve = (l) => (q = q.then(() => real(l)))`) — enqueue order is deterministic,
 * and a single local model host is serial anyway, so the mutex costs nothing.
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

// default prompt completion — the bounded neighbourhood: the ancestor statement + the resolved inputs + the goal
// to produce. An input whose key has a `ctx.labels` entry is rendered WITH its provenance label (the "cells" rule,
// givens.js#labelsOf — structured provenance only; measured: fixes mis-localization, never label prose).
function defaultComplete( leaf ) {
	const lbl = leaf.labels || {};
	const inputs = Object.keys(leaf.inputs).map(( k ) => k + '=' + leaf.inputs[k] + (lbl[k] ? ' (' + lbl[k] + ')' : '') );
	return 'GOAL ' + leaf.statement + (inputs.length ? ' · USE ' + inputs.join(',') : ' · (root)')
		+ (leaf.reportsUp ? ' · REPORT-UP ' + leaf.produces : '') + ' · PRODUCE ' + leaf.produces;
}

// deterministic prose title — the first sentence, truncated (never invented; A3 owner-spec roadmap).
function proseTitle( s, cap ) {
	const first = (String(s || '').match(/^[^.!?]*[.!?]/) || [String(s || '')])[0].trim();
	return first.length > cap ? first.slice(0, cap).trim() + '…' : first;
}

// ── stratComplete — the STRATIFIED leaf rendering, promoted from the A3 monster harness (opt-in via
// opts.complete; the default stays defaultComplete). Each LEVEL gets the regime measured best for it:
//   • leaves inside a composite (and flat levels)  = CONTEXT (the parent statement) + DONE (already-served
//     level siblings, `key = value (nl…)`) + TASK — the "chainsum" regime (A3: 58/80 vs base 50/80);
//   • leaves of a level that CONTAINS composites   = CONTEXT + the ROADMAP view (every level step with its
//     instruction and produced value `[done]`/`[todo]`, composites folded to their statement title, the
//     current step marked `>>x<< [YOU ARE HERE]` + a scope guard) — the integrator USES it (A3 NEG:
//     a lying roadmap breaks finals), calculation leaves ignore it, hence the stratification.
// The wording below is the CANONICAL FORM p0 — measured form-ROBUST by the K-paraphrases harness
// (`WIP/experiments/2026-07-12-k-paraphrases/`: 4 full re-wordings → sections mean 56.3/80 ± 1.5, min 55,
// vs base 50; integration mean 4.7/20 vs base 3, never below). The INFORMATION carries the gain, not the
// tokens — so the form is FROZEN (anti-butterfly: never re-phrase per task, never tune the wording).
// DONE/ROADMAP read level state at serve time → they require SERIALIZED serves (see the determinism
// caveat in the header) for replay-stable prompts.
function stratComplete( leaf ) {
	const lbl = leaf.labels || {};
	const inputs = Object.keys(leaf.inputs || {}).map(( k ) => k + ' = ' + leaf.inputs[k] + (lbl[k] ? ' (' + lbl[k] + ')' : '') );
	const parts = [];
	if ( leaf.statement ) parts.push('CONTEXT: ' + leaf.statement);
	const plan = leaf.plan || [];
	if ( leaf.level === 'top' && plan.some(( p ) => p.composite ) ) {                     // integration level → ROADMAP view
		const lines = ['PLAN:'];
		for ( const p of plan ) {
			const head = p.composite && p.statement ? p.key + ' ("' + proseTitle(p.statement, 72) + '")'
				: (p.current ? '>>' + p.key + '<<' : p.key) + (p.nl ? ' (' + String(p.nl).slice(0, 90) + ')' : '');
			lines.push('  ' + head + (p.value !== undefined ? ' = ' + p.value + ' [done]' : (p.current ? ' [YOU ARE HERE]' : ' [todo]')));
		}
		parts.push(lines.join('\n') + '\nYou are at the marked >>step<<. Solve ONLY that step; everything else is out of your scope.');
	} else if ( (leaf.done || []).length )
		parts.push('DONE: ' + leaf.done.map(( d ) => d.key + ' = ' + d.value + (d.nl ? ' (' + String(d.nl).split(/\s+/).slice(0, 8).join(' ') + ')' : '') ).join(' · '));
	parts.push('TASK: ' + (leaf.nl || 'produce ' + leaf.produces) + (inputs.length ? ' Given: ' + inputs.join(' ; ') + '.' : ''));
	return parts.join('\n');
}

// build the seed for the TOP level (a parent énoncé + a pool ref by it, pre-populated with the wait index).
// `givens` ({ key: value }, optional) = the task's BASE FACTS (givens.js front-door): seeded as already-available
// `val_<key>` pool entries, and every step's given-needs are PRE-SATISFIED (counted in `got` like a down-projected
// input) — the same inherited semantics as a composite's down-projection, applied at the top level.
function buildSeed( roadmap, statement, givens ) {
	givens = givens || {};
	// _seed = the pre-satisfied entries (to tell "already available" from "produced so far" — leaf.done) ·
	// _plan = the level skeleton (id/key/nl/composite/statement — leaf.plan, the roadmap-view source). Inert data.
	const pool = { _id: 'POOL', _isPool: true, available: Object.keys(givens), _seed: Object.keys(givens),
		_plan: roadmap.map(( s ) => ({ id: s.id, key: s.produces, nl: s.nl || '', composite: !!s.sub, statement: s.statement || '' }) ) };
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
		if ( s.nl != null ) seg.nl = s.nl;                           // step instruction + level statement (strat rendering) — inert data too
		if ( s.statement != null ) seg.statement = s.statement;
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
				// the LEVEL state read on the structure (strat rendering; additive — hosts ignoring them see no change):
				// done = level entries produced so far (available beyond _seed, emergent order) · plan = the level
				// skeleton with current values + the own-step marker · level = top vs inside-a-composite.
				const seedSet = new Set(pool._seed || pool.available || []);
				const nlOf = {}; (pool._plan || []).forEach(( p ) => { nlOf[p.key] = p.nl; });
				const done = (pool.available || []).filter(( k ) => !seedSet.has(k) )
					.map(( k ) => ({ key: k, value: pool['val_' + k], nl: nlOf[k] || '' }) );
				const plan = (pool._plan || []).map(( p ) => Object.assign({}, p, { value: pool['val_' + p.key], current: p.id === self._id }) );
				const leaf = { id: self._id, statement: graph.getEtty(self.parentSeg)._.statement, produces: self.produces,
					needs: self.needs || [], inputs: inputs, reportsUp: !!self.up_res, slot: self.slot,
					nl: self.nl, level: self.parentSeg === 'PARENT' ? 'top' : 'sub', done: done, plan: plan,
					labels: (ctx && ctx.labels) || {} };
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
			const subPool = { _id: SUB, _isPool: true, available: (self.needs || []).slice(), _seed: (self.needs || []).slice(),
				_plan: sub.map(( c ) => ({ id: c.id, key: c.produces, nl: c.nl || '', composite: !!c.sub, statement: c.statement || '' }) ) };
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
				if ( c.nl != null ) seg.nl = c.nl;                                        // strat rendering metadata, inert
				if ( c.statement != null ) seg.statement = c.statement;
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
 * @param opts.serve    async (leaf, ctx) => value  REQUIRED. leaf = { id, statement, produces, needs, inputs, prompt,
 *        reportsUp, nl, level ('top'|'sub'), done ([{key,value,nl}] level results so far), plan (the level skeleton
 *        with values + the own-step marker) } — the structural fields feed strat rendering, hosts may ignore them.
 * @param opts.complete (leaf) => promptString      the bounded prompt (default: statement · USE inputs · PRODUCE;
 *        `stratComplete` exported = the stratified CONTEXT/DONE/ROADMAP rendering measured on the A3 monster
 *        harness + the K-paraphrases gate — opt-in, canonical form frozen).
 * @param opts.label    graph label.
 * Roadmap steps may carry `nl` (the step instruction) and — on composites — `statement` (the sub-level énoncé):
 * inert metadata, read by the strat rendering (a sub leaf's `statement` = its composite's, top = ctx.statement).
 * ctx.givens = { key: value } base facts (givens.js#seedOf) · ctx.labels = { key: label } provenance labels
 * (givens.js#labelsOf — structured provenance only), rendered by defaultComplete next to each labelled input.
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

module.exports = { createContextProjection, guardPlan, defaultComplete, stratComplete, buildSeed, CONCEPT_MAP, makeProviders, allSteps };
