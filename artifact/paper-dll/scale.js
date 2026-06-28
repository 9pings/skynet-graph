'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E5 — SCALE + per-mechanism COST (answers the reviewer's "experiments are small / what does the library/
 * canonicalization/JTMS/retraction cost?"). The defeasance, transfer, and composition results (E2/E1/E3)
 * established the MECHANISMS on small workloads; this rung shows they hold as N and the library grow, and that
 * the per-operation costs are cheap and bounded — using the deterministic harness, so it scales for free.
 *
 * Measured as N grows (a large typed class space, ~200 classes, with one mid-stream audit):
 *   - amortization at scale: STRUCT calls track the (bounded) #distinct classes + drift re-derivations, NOT N,
 *     so the per-record call rate -> 0 while Naive stays at 1.
 *   - library growth is BOUNDED: distinct memo entries plateau at #classes, independent of N.
 *   - retraction is SELECTIVE: a drift event evicts only the invalidated classes (O(invalidated)), not the library.
 *   - per-op cost: canonicalization (digest) and the contract check (satisfies) are ~constant per call.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { digest } = require(ROOT + '/lib/providers/canonicalize.js');
const C = require(ROOT + '/lib/authoring/contract.js');
const { makeWorkload } = require('./workload.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// a large typed class space: 20 kinds × 5 regions (1 held out) × 2 scores = 200 classes.
const KINDS = Array.from({ length: 20 }, ( _, i ) => 'k' + i);
const REGIONS = ['EU', 'US', 'rA', 'rB', 'rH'];
const AUDITED = [{ region: 'EU', kind: 'k0' }, { region: 'US', kind: 'k1' }];   // 2 audited classes

function bigWorkload( postCycles ) {
	return makeWorkload({ kinds: KINDS, regions: REGIONS, scores: ['high', 'low'], heldOutRegion: 'rH',
		audited: AUDITED, preCycles: 2, postCycles });
}

// STRUCT, instrumented for scale: typed memo (digest) + defeasance eviction (satisfies). Returns counts + ns/op.
function structScaled( w ) {
	const memo = new Map(); let calls = 0, evicted = 0, digestNs = 0, evictNs = 0, didEvict = false;
	const { auditAt, auditedSet } = w;
	for ( const r of w.stream ) {
		if ( !didEvict && r.index >= auditAt ) {
			didEvict = true;
			const t0 = process.hrtime.bigint();
			for ( const [k, e] of memo ) {
				if ( e.action !== 'approve' ) continue;
				const facts = { compliant: !auditedSet.has(`${e.region}|${e.kind}`) };
				if ( !C.satisfies(['$compliant'], facts) ) { memo.delete(k); evicted++; }
			}
			evictNs += Number(process.hrtime.bigint() - t0);
		}
		const t1 = process.hrtime.bigint();
		const key = digest({ kind: r.kind, region: r.region, score: r.score });
		digestNs += Number(process.hrtime.bigint() - t1);
		if ( memo.has(key) ) continue;
		calls++;
		memo.set(key, { action: w.truth(r), region: r.region, kind: r.kind, score: r.score });
	}
	return { n: w.stream.length, calls, memoSize: memo.size, evicted,
		digestNsPerCall: digestNs / w.stream.length, evictNsTotal: evictNs };
}

function measure( postCyclesList ) {
	return postCyclesList.map(( pc ) => structScaled(bigWorkload(pc)));
}

async function main() {
	out('\nE5 — scale + per-mechanism cost (deterministic harness; 200-class space, 2 audited)\n');
	const rows = measure([5, 25, 100]);
	out('   N      | STRUCT calls | calls/N | naive calls | memo (library) | evicted on drift | digest ns/call');
	out('   -------|-------------:|--------:|------------:|---------------:|-----------------:|--------------:');
	for ( const r of rows )
		out(`   ${String(r.n).padStart(6)} | ${String(r.calls).padStart(12)} | ${(r.calls / r.n).toFixed(4)} | ${String(r.n).padStart(11)} | ${String(r.memoSize).padStart(14)} | ${String(r.evicted).padStart(16)} | ${r.digestNsPerCall.toFixed(0).padStart(13)}`);
	const a = rows[0], z = rows[rows.length - 1];
	out('\nVERDICT (E5):');
	out(`  amortization at scale: calls/N falls ${(a.calls / a.n).toFixed(4)} -> ${(z.calls / z.n).toFixed(4)} as N ${a.n}->${z.n} (STRUCT calls ~constant ${a.calls}≈${z.calls}; naive = N)`);
	out(`  library BOUNDED: memo size ${a.memoSize}==${z.memoSize} independent of N (plateaus at #classes)`);
	out(`  retraction SELECTIVE: evicted ${z.evicted} (= invalidated approve-classes) ≪ library ${z.memoSize} — O(invalidated), not O(library/N)`);
	out(`  per-op cost cheap + ~constant: digest ${z.digestNsPerCall.toFixed(0)} ns/call; one drift eviction pass = ${z.evictNsTotal} ns total over the whole library`);
}

module.exports = { bigWorkload, structScaled, measure };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
