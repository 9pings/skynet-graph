/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * plan-loop — C7, the HIERARCHICAL PLAN LOOP (design `WIP/2026-07-07-design-r1-plan-loop.md`; kill-gated R1:
 * KG-R1a the channel + KG-R1b the fixpoint). A task LONGER THAN THE CONTEXT is decomposed into typed leaves,
 * each leaf sees only a PROJECTED digest (never the whole task), leaves are served by the cost ladder, the plan
 * is driven to a BALANCED fixpoint (rebalance brick), and reassembly is VERIFIED — a leaf whose required facts
 * are missing is REFUSED (never a silent wrong), and reassembly reads nothing uncovered (never a claim-of-absence).
 *
 * THIN assembly (the combo doctrine — no new logic; a missing piece goes into a brick):
 *   decompose (injected: typed-loop)  →  project + leaf pre-contract  →  serveLeaf (injected: the C6 ladder,
 *   match→retrieve→forge→ESCALADE frontier — kill-gate finding: escalation is LOAD-BEARING on hard/novel leaves,
 *   C-local alone is model-capability-bound)  →  rebalancePlan (E2∘E1∘E3∘E4)  →  checkReassembly (checkCompose).
 *
 * Both heavy stages are INJECTED so the combo stays usable "à nu" and testable without a model: production wires
 *   decompose = typed-loop's recursive typed decompose,   serveLeaf = createProxyCache(...).solve  (the C6 ladder).
 *
 *   const { createPlanLoop } = require('skynet-graph').combos;   // or Graph.combos.createPlanLoop
 *   const loop = createPlanLoop({ decompose, serveLeaf });
 *   const { answer, converged, refused, reassembly } = await loop.run(task, ctx);
 */
const { rebalancePlan, checkReassembly } = require('../authoring/rebalance.js');
const { createContextProjection } = require('../authoring/context-project.js');
const { stableStringify } = require('../providers/cache.js');

const tok = ( s ) => Math.ceil(String(s == null ? '' : s).length / 4);

// leaf pre-contract (default): a typed request is COMPLETE iff no required field is null/'' (a severed digest
// amputates one → refused AT PROJECTION, before any serve). Shallow + one level into a `filters` array. ──
function defaultComplete( request ) {
	if ( !request || typeof request !== 'object' ) return false;
	for ( const k of Object.keys(request) ) {
		const v = request[k];
		if ( v === null || v === '' ) return false;
		if ( Array.isArray(v) ) for ( const f of v ) if ( f && typeof f === 'object' )
			for ( const kk of Object.keys(f) ) if ( f[kk] === null || f[kk] === '' ) return false;
	}
	return true;
}

// default answer fold — canonical {id: value | REFUSED}, sorted (deterministic; E4/refold semantics). ──
function defaultFold( leaves ) {
	const parts = [];
	for ( const lf of leaves ) for ( const id of leafWrites(lf) )
		parts.push([id, lf.refused ? 'REFUSED' : (lf.severed ? 'REFUSED' : String(lf.value == null ? '' : lf.value))]);
	parts.sort(( a, b ) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
	return parts.map(( [id, v] ) => id + '=' + v ).join(';');
}
const leafWrites = ( n ) => n.bundle ? n.bundle.map(( r ) => r.id ) : [n.request && n.request.id];

/**
 * createPlanLoop(opts)
 * @param opts.decompose  REQUIRED async (task, ctx) => [{ id, request, nl }]  — the typed leaves (typed-loop in
 *        production). May be DEGENERATE (redundant / disordered / an over-budget `{ bundle:[request,…] }`) — the
 *        fixpoint repairs it. `request` is the leaf's typed request (the fusion key + contract are derived from it).
 * @param opts.serveLeaf  REQUIRED async (leaf, ctx) => value  — the cost ladder (createProxyCache(...).solve).
 * @param opts.isComplete (request) => bool   — the leaf pre-contract (default: no null/'' required field).
 * @param opts.fold       (servedLeaves) => answer   — the report fold (default: canonical {id:value|REFUSED}).
 * @param opts.budget     node token budget (default 512) — a served digest over budget is an E2 scission target.
 * @param opts.cap        fixpoint round cap (default from the brick).
 */
function createPlanLoop( opts ) {
	opts = opts || {};
	if ( typeof opts.decompose !== 'function' ) throw new Error('createPlanLoop needs opts.decompose(task,ctx) -> [{id,request,nl}]');
	if ( typeof opts.serveLeaf !== 'function' ) throw new Error('createPlanLoop needs opts.serveLeaf(leaf,ctx) -> value');
	const budget = opts.budget || 512;
	const isComplete = opts.isComplete || defaultComplete;
	const fold = opts.fold || defaultFold;

	// the rebalance spec — derived entirely from the leaves' TYPED requests (no new logic) ──
	const spec = {
		isLeaf: ( n ) => n.kind === 'leaf',
		fusionKey: ( n ) => stableStringify(n.bundle ? n.bundle : n.request),
		overBudget: ( n ) => n.kind === 'leaf' && (!!n.bundle || tok(n.digest) > budget),
		split: ( n ) => (n.bundle || []).map(( r, i ) => ({ id: n.id + '_' + i, kind: 'leaf', request: r, nl: r.nl, refused: !isComplete(r), value: n.served && n.served[i] }) ),
		writes: leafWrites,
		reads: ( n ) => n.kind === 'root' ? (n.reads || []) : (n.readsExtra || []),
		refold: ( root, leaves ) => fold(leaves),
		contractOf: ( n ) => n.kind === 'root'
			? { name: n.id, contract: { read: (n.reads || []), write: ['__answer'], effect: 'pure' } }
			: { name: n.id, contract: { read: (n.readsExtra || []), write: leafWrites(n), effect: n.retract ? 'effect' : 'pure' } },
	};

	// serve the atomic leaves THROUGH the graph-native projection: build a roadmap from the leaves' footprint
	// (a leaf's produces = a unique per-leaf key; its needs = the readsExtra it shares with a producing sibling),
	// serve each leaf WITH its completed bounded context (upstream values relabelled to the figure key), in the
	// emergent dependency order. A cyclic footprint → the projection's `guardPlan` returns a TYPED refusal (the
	// intra-plan cycle detector) which run() surfaces — never a silent wedge, never a serve-despite-impossible-deps.
	// Mutates lf.value / lf.projectedPrompt in place; returns the refusal string or null. ──
	async function projectServe( atomic, producedKeys, task, ctx ) {
		const writeKeyOf = ( l ) => leafWrites(l)[0];
		const firstIdxOf = {}; atomic.forEach(( l, i ) => { const k = writeKeyOf(l); if ( k != null && !(k in firstIdxOf) ) firstIdxOf[k] = i; });
		const stepId = ( i ) => 'L' + i, byStep = {}, writeKeyByStep = {};
		atomic.forEach(( l, i ) => { byStep[stepId(i)] = l; writeKeyByStep[stepId(i)] = writeKeyOf(l); });
		const roadmap = atomic.map(( l, i ) => ({ id: stepId(i), produces: stepId(i),
			needs: (l.readsExtra || []).filter(( k ) => producedKeys.has(k) && firstIdxOf[k] !== i ).map(( k ) => stepId(firstIdxOf[k]) ) }) );
		const serve = async ( s, c ) => {
			const inputs = {}; for ( const k of Object.keys(s.inputs) ) inputs[writeKeyByStep[k] || k] = s.inputs[k];   // relabel producer-step id → figure key
			return await opts.serveLeaf(Object.assign({}, byStep[s.id], { inputs: inputs }), c);
		};
		const statement = typeof task === 'string' ? task : (( ctx && ctx.statement ) || JSON.stringify(task));
		const pr = await createContextProjection({ serve: serve }).run(roadmap, Object.assign({ statement: statement }, ctx));
		if ( pr.refusal ) return pr.refusal;                              // unresolvable structure (cycle) → surfaced, leaves unserved
		for ( const s of roadmap ) { const l = byStep[s.id]; l.value = pr.results[s.id].value; l.projectedPrompt = pr.results[s.id].prompt; }
		return null;
	}

	async function run( task, ctx ) {
		// 1. DECOMPOSE (typed) → leaves (possibly degenerate)
		const raw = await opts.decompose(task, ctx) || [];
		// 2. PROJECT + leaf PRE-CONTRACT (a severed/incomplete request → refused AT PROJECTION, never served-then-guessed)
		const leaves = raw.map(( n ) => Object.assign({ kind: 'leaf' }, n, { refused: !!n.bundle ? false : !isComplete(n.request) }) );
		// 3. SERVE. Bundles are pre-served per atom (a scission concern). Admissible ATOMIC leaves are served through
		//    the REAL context projection (lib/authoring/context-project): a leaf that reads another leaf's write is
		//    served AFTER it, with the upstream value completed into its bounded context (the R1 §2 "contexte par
		//    nœud" — no leaf sees the whole task). A decompose with NO intra-plan dependency degenerates to the
		//    direct serve (all leaves are independent roots) — that IS the no-dependency case of the same projection,
		//    kept as a fast path (redundant serves are cheap — the C6 cache dedupes).
		for ( const lf of leaves ) if ( lf.bundle ) {
			lf.served = []; for ( const r of lf.bundle ) lf.served.push(await opts.serveLeaf({ kind: 'leaf', request: r, nl: r.nl }, ctx));
		}
		const atomic = leaves.filter(( l ) => !l.bundle && !l.refused );
		const producedKeys = new Set(atomic.map(( l ) => leafWrites(l)[0] ).filter(( k ) => k != null ));
		const projected = atomic.some(( l ) => (l.readsExtra || []).some(( k ) => producedKeys.has(k) ) );
		let projRefusal = null;
		if ( !projected ) { for ( const lf of atomic ) lf.value = await opts.serveLeaf(lf, ctx); }
		else projRefusal = await projectServe(atomic, producedKeys, task, ctx);
		// 4. BUILD the plan + REBALANCE to the fixpoint (E2 split → E1 dedupe → E3 reorder → E4 refold)
		const producedIds = leaves.filter(( l ) => !l.refused ).flatMap(spec.writes).filter(Boolean);
		const root = { id: '__root', kind: 'root', reads: producedIds, value: null };
		const plan = { order: leaves.concat([root]) };
		const rb = rebalancePlan(plan, spec, { cap: opts.cap });
		// 5. VERIFIED REASSEMBLY (checkCompose sound + nothing uncovered)
		const producers = rb.plan.order.filter(spec.isLeaf);
		const reassembly = checkReassembly(root, producers, spec);
		return {
			answer: root.value, converged: rb.converged, refusal: projRefusal || rb.refusal,
			refused: producers.filter(( p ) => p.refused ).flatMap(spec.writes).filter(Boolean),
			reassembly, rounds: rb.rounds, monotone: rb.monotone, trace: rb.trace,
			leaves: producers.length, projected: projected,
		};
	}

	return { run: run, rebalance: rebalancePlan, spec: spec };
}

module.exports = { createPlanLoop: createPlanLoop, defaultComplete: defaultComplete, defaultFold: defaultFold };
