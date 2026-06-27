/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * DERIVATION CACHE × METHOD/INSTANCE — an ADDITIVE way to use the engine that benefits from the rest. We do
 * NOT change the problem-paths grammar; we WRAP its existing providers with the content-addressed cache
 * (`lib/providers/cache.js`) and flow several record-INSTANCES through the same warm METHOD. The payoff the
 * study (§5) predicts, MEASURED: instance #1 warms the cache (pays the model), instance #2 with the SAME
 * typed structure replays at ~ZERO model calls (the method is cheap to run per instance), and a genuinely
 * DIFFERENT instance correctly MISSES (no false replay — the cache keys on the canonical justification).
 *
 *   node examples/poc/cache-instances.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { providers, conceptTree, pathSteps } = require('./problem-paths.js');
const { createProviderCache } = require('../../lib/providers/cache.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
const stateOf = ( g, id ) => { const e = g.getEtty(id); return e ? e._.state : undefined; };
const kindOf  = ( g, id ) => { const e = g.getEtty(id); return e ? e._.kind : undefined; };

// the "method" content — deterministic numeric bisection; every provider call is COUNTED (a stand-in for a
// model call), so the measurement is the per-instance model cost.
function countingContent() {
	const n = { plan: 0, select: 0, resolve: 0, summarize: 0, total: 0 };
	const C = {
		plan: async ( { from, to } ) => { n.plan++; n.total++; return to - from <= 1 ? { atomic: true } : { mids: [{ state: Math.floor((from + to) / 2) }] }; },
		score: async () => 0,                                            // (scoring is inside select; counted there)
		resolve: async ( { from, to } ) => { n.resolve++; n.total++; return `${from}→${to}`; },
		summarize: async ( steps ) => { n.summarize++; n.total++; return `plan(${steps.length})`; }
	};
	C.n = n;
	return C;
}

// per-provider key fns: each digests EXACTLY the inputs that provider reads (the canonical justification),
// using FACTS (states/kinds/steps) not object ids — so a fresh instance with the same structure hits.
const keys = {
	'P::plan': ( g, c, s ) => { const seg = s._; const o = stateOf(g, seg.originNode), t = stateOf(g, seg.targetNode); if ( o === undefined || t === undefined ) return null; return { o, t, d: seg.depth || 0, ok: kindOf(g, seg.originNode), tk: kindOf(g, seg.targetNode) }; },
	'P::select': ( g, c, s ) => { const seg = s._; if ( !seg.alts ) return null; return { o: stateOf(g, seg.originNode), t: stateOf(g, seg.targetNode), mids: seg.alts.map(( a ) => a.mid) }; },
	'P::resolve': ( g, c, s ) => { const seg = s._; const o = g.getEtty(seg.originNode), t = g.getEtty(seg.targetNode); if ( !o || !t ) return null; return { o: o._.state, t: t._.state, prev: o._.reached, win: o._.trail || [], ok: o._.kind, tk: t._.kind }; },
	'P::summarize': ( g, c, s ) => { const start = findNode(g, 'isStart'), goal = findNode(g, 'isGoal'); return { steps: pathSteps(g, start, goal) }; }
};
function findNode( g, flag ) { for ( const id in g._objById ) { const e = g._objById[id]._etty._; if ( e && e.Node && e[flag] ) return id; } return null; }

async function runInstance( problem, label ) {
	const seed = { lastRev: 0,
		nodes: [{ _id: 'S', Node: true, state: problem.start, isStart: true, reached: 'start' }, { _id: 'G', Node: true, state: problem.goal, isGoal: true }],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'solve' }] };
	const g = new Graph(seed, { label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	await nextStable(g);
	return pathSteps(g, 'S', 'G');
}

// run COLD «0→16» → WARM «0→16» (same instance) → NEW «100→116» (different) through ONE warm method.
async function scenario() {
	const C = countingContent();
	const cache = createProviderCache();
	// the WARM METHOD: the existing problem-paths providers, wrapped with the cache (additive — the grammar
	// is untouched). The store is SHARED across instances → instance #2 benefits from instance #1.
	Graph._providers = cache.wrapFragment(providers(C, { maxDepth: 64, alts: 1 }), keys);

	const b1 = C.n.total; const steps1 = await runInstance({ start: 0, goal: 16 }, 'inst-1'); const cold = C.n.total - b1;
	const b2 = C.n.total; const steps2 = await runInstance({ start: 0, goal: 16 }, 'inst-2'); const warm = C.n.total - b2;
	const b3 = C.n.total; const steps3 = await runInstance({ start: 100, goal: 116 }, 'inst-3'); const diff = C.n.total - b3;
	return { cold, warm, diff, steps1, steps2, steps3, stats: cache.stats, entries: cache.size() };
}

async function main() {
	out('\nDERIVATION CACHE × METHOD/INSTANCE — one warm method, several record-instances flowing through it\n');
	const r = await scenario();
	out(`① instance «0→16» COLD:  ${r.cold} model calls   (${r.steps1.length} steps)   cache: ${r.stats.misses} miss / ${r.stats.hits} hit`);
	out(`② instance «0→16» WARM:  ${r.warm} model calls   (${r.steps2.length} steps)   ← the SAME method, replayed`);
	out(`③ instance «100→116» NEW: ${r.diff} model calls   (${r.steps3.length} steps)   ← a DIFFERENT instance (negative control)`);
	out(`\n  ⇒ warm/cold = ${r.warm}/${r.cold} model calls  → the method runs the 2nd identical instance ${r.cold > 0 ? Math.round((1 - r.warm / r.cold) * 100) : 0}% cheaper`);
	out(`  ⇒ the different instance still costs ${r.diff} calls — the cache keys on the JUSTIFICATION, it does not blindly replay`);
	out(`  cache totals: ${r.stats.hits} hits, ${r.stats.misses} misses, ${r.stats.bypass} bypass, ${r.entries} entries\n`);
}

module.exports = { countingContent, keys, scenario };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
