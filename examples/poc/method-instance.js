/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * METHOD / INSTANCE — fork-per-case driver (study §5, rung 2). The graph BUILDS a reusable METHOD (a concept
 * tree); external DB records FLOW through it as INSTANCES (cases). The synthesis the study argues:
 *
 *   - ONE warm METHOD       = the concept tree + a SHARED, versioned derivation cache (rung G).
 *   - each INSTANCE         = `method.fork(seed = record)` — its OWN world (single-world JTMS forces this:
 *                             one retraction must not purge a sibling case's facts, B7). The case binds its
 *                             external record via a bagRef (read-once structural SNAPSHOT, rung 1).
 *   - B8 method-version pin = the fork snapshots `_conceptMap` at fork time; the cache key folds a method
 *                             VERSION token, so a live method patch never serves a stale template to a new
 *                             instance (and never reinterprets a fork already in flight).
 *   - C1/B2 cache key       = folds the canonical bagRef SNAPSHOT (the record's structural fields) — two
 *                             cases with the same typed structure replay; a different one correctly misses.
 *
 * MEASURED: the per-instance provider ("model") cost falls toward ZERO as the cache warms — the crystallization
 * payoff at scale (the study's promise, beyond the 2-instance cache-instances.js demo). A method patch (B8)
 * resets the cost (the new method is genuinely different work); a structurally-novel record pays in full.
 *
 *   node examples/poc/method-instance.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createProviderCache } = require('../../lib/providers/cache.js');

const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// -- the external "DB": each record is a case to process; its STRUCTURAL fields drive the method. ----------
const DB = {};
const bagRefManagers = { db: { test: /^db:(.+)$/, int: { get( id, cb ) { cb(null, DB['db:' + id]); } } } };

// -- the METHOD content: an expensive 2-step derivation over the bound record. Each provider call is COUNTED
//    (a stand-in for a model call) so the per-instance cost is measurable. The providers read ONLY the bound
//    record's structural fields (kind, size) — the canonical justification the cache keys on. -------------
function countingMethod() {
	const n = { analyze: 0, derive: 0, total: 0 };
	const M = {
		// step 1: classify the record (expensive). reads the CANONICAL structural fields (kind, tier). Sets its
		// OWN self-flag (c._name) so the concept marks itself cast (else it re-fires to the apply-cap).
		analyze( g, c, scope, argz, cb ) {
			n.analyze++; n.total++;
			const rec = g.getRef('binding:', scope._._id) || {};
			cb(null, { $_id: '_parent', analysis: (rec.kind || '?') + ':' + (rec.tier || '?'), [c._name]: true });
		},
		// step 2: derive a result from the analysis (expensive). reads the analysis fact.
		derive( g, c, scope, argz, cb ) {
			n.derive++; n.total++;
			cb(null, { $_id: '_parent', result: 'plan<' + scope._.analysis + '>', [c._name]: true });
		}
	};
	M.n = n;
	return M;
}

const tree = { common: { childConcepts: {
	Analyze: { _id: 'Analyze', _name: 'Analyze', require: ['binding'], provider: ['M::analyze'],
		childConcepts: { Derive: { _id: 'Derive', _name: 'Derive', require: ['analysis'], provider: ['M::derive'] } } }
} } };

// per-provider cache keys = the CANONICAL justification (K1): the cache keys on the snapped/typed structural
// fields, NOT incidental ones (the record's raw `size` varies case-to-case but is NOT structural → excluded;
// else every record would miss). This is what makes the same structural CLASS replay (C1/B2 + the K1 barrier).
//  - analyze folds the canonical bagRef snapshot {kind, tier}.
//  - derive folds the analysis fact it reads.
const keys = {
	'M::analyze': ( g, c, s ) => { const rec = s.getRef('binding:'); return rec ? { kind: rec.kind, tier: rec.tier } : null; },
	'M::derive': ( g, c, s ) => ( s._.analysis != null ? { analysis: s._.analysis } : null )
};

// run ONE record-instance as a fork of the warm method; return its result + the provider calls it cost.
async function runCase( method, rec, costRef ) {
	DB['db:' + rec.id] = { kind: rec.kind, tier: rec.tier, size: rec.size };   // record: canonical {kind,tier} + incidental size
	const before = costRef.total;
	const seed = { lastRev: 0, bagRefs: { ['db:' + rec.id]: { count: 1 } },
		nodes: [{ _id: 'case', binding: 'db:' + rec.id }], segments: [] };
	const child = method.fork(seed, { label: 'case:' + rec.id });
	await nextStable(child);
	const result = child.getEtty('case')._.result;
	child.destroy();                                                // the instance world is discarded; the METHOD persists
	return { result, cost: costRef.total - before };
}

async function scenario() {
	const M = countingMethod();
	let methodEpoch = 1;                                            // B8: the method version token (bumped on a patch)
	const cache = createProviderCache({ version: () => 'v' + methodEpoch });
	Graph._providers = cache.wrapFragment({ M }, keys);            // the warm method's providers, cache-wrapped

	// the METHOD holder: a minimal graph carrying the concept tree; instances fork from it (inherit _conceptMap).
	const method = new Graph({ lastRev: 0, nodes: [], segments: [] },
		{ label: 'method', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers, logLevel: 'error' }, tree);
	await nextStable(method);

	// a STREAM of record-cases: 5 of the SAME structural class {A,small} (with DIFFERENT incidental sizes — they
	// must still replay), then a structurally-DIFFERENT one {B,big}.
	const stream = [
		{ id: 1, kind: 'A', tier: 'small', size: 3 }, { id: 2, kind: 'A', tier: 'small', size: 5 }, { id: 3, kind: 'A', tier: 'small', size: 8 },
		{ id: 4, kind: 'A', tier: 'small', size: 2 }, { id: 5, kind: 'A', tier: 'small', size: 9 },   // same class, varied size
		{ id: 6, kind: 'B', tier: 'big', size: 50 }                                                   // structurally novel
	];
	const costs = [];
	for ( const rec of stream ) costs.push(await runCase(method, rec, M.n));

	// B8: patch the method live (bump the version) -> a NEW instance of the same {A,small} class must re-pay
	// (the cache key folds the method version; v1 templates are NOT served under v2).
	methodEpoch++;                                                  // (a real patchConcept would bump a concept-lib digest)
	const afterPatch = await runCase(method, { id: 7, kind: 'A', tier: 'small', size: 4 }, M.n);

	const methodObjs = Object.keys(method._objById).length;        // the method world stays clean (forks destroyed)
	return { costs, afterPatch, stats: cache.stats, methodObjs };
}

async function main() {
	out('\nMETHOD / INSTANCE — one warm method, N record-cases forked through it (fork-per-case)\n');
	const r = await scenario();
	out('per-instance provider ("model") calls, streaming 5×{A,small} then 1×{B,big}:');
	r.costs.forEach(( c, i ) => out(`   case ${i + 1}: ${c.cost} calls   result=${c.result}` + (i === 0 ? '   ← COLD (warms the method)' : (i < 5 ? '   ← WARM (same structure, replayed)' : '   ← NOVEL structure (pays)'))));
	out(`\n   ⇒ cost decays ${r.costs[0].cost} → ${r.costs[1].cost} → … as the method warms (the crystallization payoff at scale)`);
	out(`   ⇒ the structurally-novel case still costs ${r.costs[5].cost} (the cache keys on the JUSTIFICATION — no false replay)`);
	out(`\nB8 — after a live method patch (version bump), a same-structure case re-pays: ${r.afterPatch.cost} calls (a v1 template is never served under v2)`);
	out(`\n   method world objects after all cases: ${r.methodObjs} (each instance lived + died in its own fork — B7 isolation)`);
	out(`   cache totals: ${r.stats.hits} hits, ${r.stats.misses} misses, ${r.stats.bypass} bypass\n`);
}

module.exports = { countingMethod, tree, keys, scenario, bagRefManagers, DB };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
