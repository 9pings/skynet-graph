/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — a typed-domain corpus that is a DAG OF KINDS, not a linear chain. This is where the
 * problem-paths grammar's BEST-PATH machinery (Plan→Select→Adopt) and BACKTRACK (Reselect) finally do
 * real work IN A DOMAIN: there are GENUINELY ALTERNATIVE typed routes from the start kind to the goal
 * kind, the search must CHOOSE the best one, and when the chosen route hits a domain FEASIBILITY wall it
 * must BACKTRACK to the next-best route. The linear corpus (`problem-domain.js`) could never exercise
 * this — one route, nothing to choose, nothing to back out of.
 *
 * The domain: ONLINE DATABASE SCHEMA MIGRATION (current schema → migrated schema). Three real strategies,
 * each a typed route through intermediate states:
 *   - DOWNTIME      current → maintenance → migrated          (2 hops, cheapest — but needs a downtime window)
 *   - EXPAND/CONTRACT current → dualwrite → backfilled → migrated  (3 hops, always safe, online)
 *   - BLUE/GREEN    current → shadow → migrated               (2 hops, but expensive: a full clone)
 * Each directed kind-edge has ONE named operator (the deterministic move). A domain heuristic scores a
 * route by its remaining cost (cheaper = preferred) — so the greedy pick is DOWNTIME. Under a
 * `zeroDowntime` SLA the downtime cutover is INFEASIBLE → the route dead-ends → the grammar backtracks to
 * the next-best route (EXPAND/CONTRACT). Composition (the corpus-doc's point (d)): a known transition
 * resolves deterministically (0 LLM); an UNKNOWN move (untyped endpoint / missing operator) escalates to
 * the injected LLM on that one segment only.
 *
 * Faithful to `doc/WIP/orientations-corpus-concepts.md`: the R2 guard (rules ORCHESTRATE the search /
 * the LLM only fills genuine gaps) and the K1 barrier (states typed by a discrete `kind` ENUM, never
 * prose — every move keys on `originKind → targetKind`).
 *
 *   DETERMINISTIC (downtime allowed → greedy picks the cheap route; zero LLM):
 *     node examples/poc/problem-domain-dag.js
 *   DETERMINISTIC (zero-downtime SLA → greedy route dead-ends, backtrack to expand/contract; zero LLM):
 *     SLA=zero-downtime node examples/poc/problem-domain-dag.js
 *   HYBRID (an untyped START the LLM must bridge into the vocabulary; thinking off):
 *     MODE=llm LLM_NO_THINK=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-q2-vram node examples/poc/problem-domain-dag.js
 */
global.__SERVER__ = true;
const { solve } = require('./problem-paths.js');
const { makeAsk } = require('../../lib/providers/llm.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- the DOMAIN: a kind-DAG of migration states + one named operator per directed edge ----
const KINDS = ['current', 'maintenance', 'dualwrite', 'backfilled', 'shadow', 'migrated'];
const LABEL = {
	current    : 'the live schema v1, app reads and writes v1',
	maintenance: 'the app is offline in a maintenance window',
	dualwrite  : 'the v2 column exists; the app writes BOTH v1 and v2',
	backfilled : 'the v2 column is backfilled for every existing row',
	shadow     : 'a cloned database is being migrated off to the side',
	migrated   : 'the live schema is v2, app reads and writes v2'
};
// the named operators — one per directed kind-edge (the human vocabulary of MOVES, deterministic).
// `op` = the named action; `w` = its real domain COST (effort/risk), so the route heuristic reflects
// reality: a full CLONE and a whole-table BACKFILL are heavy; entering a window or a cutover are light.
const OPS = {
	'current>maintenance' : { op: 'EnterMaintenance: schedule a maintenance window and take the app offline', w: 1 },
	'maintenance>migrated': { op: 'ApplyAndCutover: run the ALTER in the window and bring the app back up on v2', w: 1 },
	'current>dualwrite'   : { op: 'AddColumnAndDualWrite: add the nullable v2 column and write both v1 and v2', w: 1 },
	'dualwrite>backfilled': { op: 'Backfill: backfill the v2 column for all existing rows in batches', w: 2 },
	'backfilled>migrated' : { op: 'CutoverAndDropOld: switch reads to v2, then drop the v1 column', w: 1 },
	'current>shadow'      : { op: 'CloneAndMigrate: clone the database and migrate the shadow copy', w: 5 },
	'shadow>migrated'     : { op: 'SwapOver: swap the app over to the migrated shadow database', w: 1 }
};
// total route weights → downtime(2) < expand/contract(4) < blue/green(6): the realistic preference order.
// feasibility: the downtime cutover is INFEASIBLE when a zero-downtime SLA is in force.
const NEEDS_DOWNTIME = { 'maintenance>migrated': true };

// ---- the kind-DAG, derived from OPS — adjacency + a WEIGHTED remaining-cost heuristic (Dijkstra) ----
const ADJ = {};
Object.keys(OPS).forEach((k) => { const [a, b] = k.split('>'); (ADJ[a] = ADJ[a] || []).push([b, OPS[k].w]); });
// cheapest total operator WEIGHT from kind `a` to kind `b` over the operator graph (Infinity if unreachable).
function costTo( a, b ) {
	if ( a === b ) return 0;
	const dist = { [a]: 0 }, done = {};
	for (;;) {
		let x = null; for ( const k in dist ) if ( !done[k] && (x == null || dist[k] < dist[x]) ) x = k;   // small DAG → linear extract-min is fine
		if ( x == null ) break;
		done[x] = 1;
		for ( const [y, w] of (ADJ[x] || []) ) if ( dist[y] == null || dist[x] + w < dist[y] ) dist[y] = dist[x] + w;
	}
	return dist[b] != null ? dist[b] : Infinity;
}
const idx = ( k ) => KINDS.indexOf(k);

/**
 * The domain CONTENT — it grounds the generic DAG search. `opts.zeroDowntime` turns on the SLA that makes
 * the downtime route dead-end (so the grammar must backtrack). `opts.llm` is the injected escalation
 * (deterministic stub in tests, a real model in the demo); `opts.feasible` lets a test/LLM override
 * feasibility per edge. `stats` counts genuine LLM escalations + deterministic moves + dead-ends.
 */
function makeDagDomainContent( opts ) {
	opts = opts || {};
	const llm = opts.llm;
	const stats = { calls: 0, deterministic: 0, deadends: 0, routesProposed: 0 };
	// per-edge feasibility: default = needs-downtime edges are infeasible iff zeroDowntime; an injected
	// `feasible(edgeKey, ctx)` (e.g. a real LLM verdict) overrides it.
	const isFeasible = ( key, ctx ) => {
		if ( opts.feasible ) return opts.feasible(key, ctx);
		return !(NEEDS_DOWNTIME[key] && opts.zeroDowntime);
	};

	const C = {
		// DECOMPOSE: a direct kind-edge is atomic; a compound gap proposes the ALTERNATIVE typed routes
		// (the neighbours of origin that can still reach the goal), best-first by remaining cost.
		plan: async ( ctx ) => {
			const o = ctx.originKind, t = ctx.targetKind;
			if ( idx(o) < 0 ) {                                           // UNTYPED origin → bridge into the vocabulary
				if ( idx(t) < 0 ) return null;                            // both untyped → nothing the corpus can ground
				if ( t === 'current' ) return { atomic: true };          // the bridge hop itself → the LLM brings it to the entry
				return { mids: [{ state: LABEL.current, kind: 'current' }] };  // route via the chain entry, then the DAG takes over
			}
			if ( idx(t) < 0 ) return null;                                // untyped goal → let Resolve escalate
			if ( OPS[o + '>' + t] ) return { atomic: true };             // a known direct transition
			// the alternative ROUTES: each neighbour k of o (a first hop) from which the goal is still reachable.
			// route cost = the first-hop operator weight + the cheapest remaining cost to the goal.
			const routes = (ADJ[o] || []).map(([k]) => k).filter((k) => costTo(k, t) < Infinity)
				.map((k) => ({ kind: k, state: LABEL[k], cost: OPS[o + '>' + k].w + costTo(k, t) }))
				.sort((a, b) => a.cost - b.cost);                        // best-first so a slice keeps the best
			if ( !routes.length ) return null;                           // no in-vocabulary route → escalate
			stats.routesProposed = Math.max(stats.routesProposed, routes.length);
			return { mids: routes };
		},
		// SELECT: rank a route by its (negative) TOTAL cost — first-hop operator weight + remaining cost to
		// the goal — so the greedy pick is the genuinely cheapest route (cheaper route = higher score).
		score: async ( ctx ) => {
			if ( ctx.kind == null ) return 0;
			const first = OPS[ctx.originKind + '>' + ctx.kind], rest = costTo(ctx.kind, 'migrated');
			return (first && rest < Infinity) ? -(first.w + rest) : -99;
		},
		// RESOLVE: an adjacent known transition is its named operator (deterministic) — UNLESS it is
		// infeasible in the current context, in which case it DEAD-ENDS (Stuck) and the grammar backtracks.
		// An unknown move (missing operator / untyped endpoint) ESCALATES to the injected LLM.
		resolve: async ( ctx ) => {
			const o = ctx.originKind, t = ctx.targetKind, key = o + '>' + t;
			if ( OPS[key] ) {
				if ( !isFeasible(key, ctx) ) { stats.deadends++; return { stuck: true, why: key + ' is infeasible (zero-downtime SLA in force)' }; }
				stats.deterministic++; return { step: OPS[key].op };
			}
			stats.calls++;                                               // genuine gap → the LLM bridges this one segment
			const step = llm ? await llm({ from: ctx.from, to: ctx.to, prev: ctx.prev, originKind: o, targetKind: t })
				: `(no operator and no LLM for ${key})`;
			return { step: typeof step === 'string' ? step : (step && step.step) };
		},
		summarize: async ( steps ) => `Migration plan (${steps.length} steps): ` + steps.join('  →  ')
	};
	C.stats = stats;
	return C;
}

// ---- the LLM escalation client (real model), for untyped/gap segments only ----
function makeLLMEscalation() {
	const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-q2-vram' });
	return async ( ctx ) => (await ask({ system: 'Describe concretely, in ONE sentence, how to move from the START state to the GOAL state of a database schema migration. Continue from the previous step; do not repeat it.', user: `PREVIOUS: ${ctx.prev}\nSTART: ${ctx.from}\nGOAL: ${ctx.to}`, maxTokens: 200 })).trim();
}

async function main() {
	const mode = process.env.MODE || 'stub';
	const zeroDowntime = process.env.SLA === 'zero-downtime';
	out(`\nFLAGSHIP problem-domain-dag — online DB schema migration as a kind-DAG  (mode=${mode}${zeroDowntime ? ', SLA=zero-downtime' : ''})`);
	out(`  kinds: ${KINDS.join(', ')}`);
	out(`  routes: DOWNTIME(current→maintenance→migrated)  EXPAND/CONTRACT(current→dualwrite→backfilled→migrated)  BLUE/GREEN(current→shadow→migrated)\n`);

	// in-vocabulary: the corpus carries every move → the engine searches the DAG at ZERO LLM cost.
	out(`① «current» ⟶ «migrated»   ${zeroDowntime ? '(zero-downtime SLA: the cheap downtime route dead-ends → backtrack)' : '(downtime allowed: greedy picks the cheapest route)'}`);
	const C = makeDagDomainContent({ zeroDowntime, llm: makeLLMEscalation() });
	const r = await solve({ start: LABEL.current, startKind: 'current', goal: LABEL.migrated, goalKind: 'migrated' }, C, { maxDepth: 16, alts: 3, label: 'dag-det' });
	out(`   path (${r.steps.length} steps):`); r.steps.forEach((s, i) => out(`     ${i + 1}. ${s}`));
	out(`   → LLM escalations: ${C.stats.calls}   deterministic moves: ${C.stats.deterministic}   dead-ends backtracked: ${C.stats.deadends}`);
	out(`   SOLUTION (in-graph): ${r.solution}\n`);

	if ( mode === 'llm' ) {
		out('② hybrid  «a Rails app on an old Postgres schema, nightly ETL jobs depend on it»  ⟶  «migrated»   (LLM bridges the untyped start)');
		const Chy = makeDagDomainContent({ zeroDowntime, llm: makeLLMEscalation() });
		const r2 = await solve({ start: 'a Rails app on an old Postgres schema, nightly ETL jobs depend on it', goal: LABEL.migrated, goalKind: 'migrated' }, Chy, { maxDepth: 16, alts: 3, label: 'dag-hybrid' });
		out(`   path (${r2.steps.length} steps):`); r2.steps.forEach((s, i) => out(`     ${i + 1}. ${s}`));
		out(`   → LLM escalations: ${Chy.stats.calls}   deterministic moves: ${Chy.stats.deterministic}`);
		out(`\n   SOLUTION (in-graph):\n   ${r2.solution}\n`);
	}
}

module.exports = { makeDagDomainContent, KINDS, LABEL, OPS, costTo };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
