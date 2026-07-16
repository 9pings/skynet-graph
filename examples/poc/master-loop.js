'use strict';
/*
 * MASTER LOOP — the always-on supervisor loop, end-to-end (M1+M2). Runs a recurrent typed stream through the
 * cost-ladder MATCH→RETRIEVE(recall)→FORGE→ESCALATE, with the mount policy picking the regime, disk
 * persistence (the library survives a restart), and a drift event (partial-collapse + deopt). All ZERO-CORE.
 *
 *   node examples/poc/master-loop.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
const { createMasterLoop } = require(ROOT + '/plugins/learning/lib/master-loop.js');
const { createMountController } = require(ROOT + '/lib/authoring/core/mount.js');
const { createFileStore, saveSgc, loadSgc } = require(ROOT + '/lib/authoring/core/store.js');
const { packMethods, loadMethods } = require(ROOT + '/plugins/learning/lib/method-pack.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

const signature = ( p ) => ({ structure: { oKind: p.oKind, tKind: p.tKind }, content: { variant: p.variant } });
function lib() {
	const n = { forge: 0, reForge: 0 };
	return { n,
		forge: async ( p ) => { n.forge++; return { result: `do(${p.oKind}->${p.tKind}|${p.variant})`, cost: 1, signals: { reliability: 0.9, depth: 1, readOnlyFrontier: true } }; },
		reForge: async ( p ) => { n.reForge++; return { result: `do(${p.oKind}->${p.tKind}|${p.variant})*`, cost: 1 }; } };
}

async function main() {
	out('\nMASTER LOOP — always-on supervisor (MATCH→RETRIEVE→FORGE→ESCALATE) + persistence + drift\n');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-loop-'));
	const cacheFile = path.join(dir, 'lib.json');
	const L = lib();
	const loop = createMasterLoop({ signature, forge: L.forge, reForge: L.reForge, cache: createFileStore(cacheFile), mount: createMountController({ thresholds: { maxDeopt: 2 } }) });

	const stream = [
		{ oKind: 'A', tKind: 'B', variant: 'v1' }, { oKind: 'A', tKind: 'B', variant: 'v1' },   // forge, match
		{ oKind: 'A', tKind: 'B', variant: 'v2' },                                              // recall-partial
		{ oKind: 'C', tKind: 'D', variant: 'v1' }, { oKind: 'A', tKind: 'B', variant: 'v3' }    // forge, recall-partial
	];
	out('stream:');
	for ( const p of stream ) { const r = await loop.solve(p); out(`   ${p.oKind}->${p.tKind}|${p.variant}: ${r.arm.padEnd(14)} regime=${r.regime}  cost=${r.cost}`); }
	out(`\n   ladder: ${JSON.stringify(loop.stats)}`);
	out(`   ⇒ ${loop.stats.forge} full forges for ${stream.length} problems (match/recall amortized the rest)`);

	// ── RESTART: a fresh loop re-hydrates the persisted library → replays at 0 calls.
	const L2 = lib();
	const loop2 = createMasterLoop({ signature, forge: L2.forge, reForge: L2.reForge, cache: createFileStore(cacheFile), mount: createMountController() });
	const after = await loop2.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	out(`\n   RESTART (fresh process, same file): A->B|v1 → ${after.arm} cost=${after.cost}  (the warm library survived; forges this process=${L2.n.forge})`);

	// ── SHIP (M3): pack the library as a portable .sgc → a DIFFERENT deployment loads it → replays at 0 calls.
	const sgcFile = path.join(dir, 'travel.sgc');
	saveSgc(packMethods(loop, { name: 'travel', version: 'v1' }), sgcFile);
	const L3 = lib();
	const dep2 = createMasterLoop({ signature, forge: L3.forge, reForge: L3.reForge });   // a fresh, EMPTY deployment
	const ship = loadMethods(loadSgc(sgcFile), dep2, { version: 'v1' });
	const s1 = await dep2.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	out(`   SHIP (.sgc → another deployment): loaded ${ship.added} methods; A->B|v1 → ${s1.arm} cost=${s1.cost}  (forges in the receiver=${L3.n.forge})`);
	// version mismatch is REFUSED (B8) — a stale library never silently replays.
	const L4 = lib();
	const dep3 = createMasterLoop({ signature, forge: L4.forge, reForge: L4.reForge });
	const bad = loadMethods(loadSgc(sgcFile), dep3, { version: 'v2' });
	const s2 = await dep3.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	out(`   SHIP cross-version (pkg v1 → host v2): loaded=${bad.added} skipped=${bad.skipped}; A->B|v1 → ${s2.arm}  (re-forged, not stale)`);

	// ── DRIFT: a premise of C->D changed → re-derive (not stale replay); a 2nd drift pins it to ESCALATE.
	loop.drift({ oKind: 'C', tKind: 'D', variant: 'v1' });
	const d1 = await loop.solve({ oKind: 'C', tKind: 'D', variant: 'v1' });
	loop.drift({ oKind: 'C', tKind: 'D', variant: 'v1' });
	const d2 = await loop.solve({ oKind: 'C', tKind: 'D', variant: 'v1' });
	out(`\n   DRIFT C->D: re-solve → ${d1.arm} (re-derived, not stale); after a 2nd drift → ${d2.arm} (K1 floor)`);
	fs.rmSync(dir, { recursive: true, force: true });
	out('\nVERDICT: one standing controller — amortizes a recurrent stream, survives restart, re-derives on drift, floors a thrashing method.\n');
}
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
