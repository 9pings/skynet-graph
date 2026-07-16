'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * P2-mesure (roadmap Phase 2) — the SHIPPED combo `Graph.combos.createLearningLibrary` is a COST-IDENTICAL
 * drop-in for the DLL-E2 paper's hand-coded STRUCT arm, on the real engine's productized API. This is the
 * deterministic regression that locks the measured finding (the GPU run lives in doc/WIP; the numbers there
 * match these). It reuses the DEPOSITED paper harness (artifact/paper-dll/*, frozen) unchanged and adds ONE
 * arm — STRUCT-COMBO — built from the shipped combo, then asserts, HONESTLY SCOPED (confront 2026-07-05):
 *
 *   (1) PARITY   — STRUCT-COMBO reproduces the Map STRUCT corner EXACTLY (calls, acc=1, driftAcc=1, maxCtx):
 *                  the shipped cache+`drift` primitives == the paper's Map+delete, at identical cost. (The
 *                  defeasance SWEEP — re-assert each cached approval's post — stays HOST code in BOTH arms,
 *                  exactly as arms.js#struct; the combo supplies amortization + selective eviction, not the sweep.)
 *   (2) NEG-CTRL — without the eviction pass, STRUCT-COMBO goes STALE on drift (driftAcc<1): eviction is load-bearing.
 *   (3) RESTART  — a FILE-backed combo store replays the warm library at 0 calls in a fresh instance (a Map cannot).
 *   (4) SHIP     — `.sgc` pack → a fresh deployment loads → replays 0-call; a version-mismatch re-forges (never stale).
 *   (5) PARTIAL  — the ladder's genuine advantage over a cache: on a MULTI-STEP forge, a same-class/new-content
 *                  case is served by RETRIEVE partial-reforge at cost 1 (reuse skeleton, re-forge the diff) < full.
 *
 * SCOPE (honest): on the 1-call-forge approval workload the ladder degenerates to MATCH+FORGE (a typed-key cache
 * with selective delete) — RETRIEVE/learning/escalate never fire; (5) exercises the ladder advantage separately.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
const { ARMS, auditKey } = require(ROOT + '/artifact/paper-dll/arms.js');
const E = require(ROOT + '/artifact/paper-dll/workload.js');
const H = require(ROOT + '/artifact/paper-dll/harness.js');
const { createLearningLibrary } = require(ROOT + '/plugins/learning/combo.js');
const { createFileStore, saveSgc, loadSgc } = require(ROOT + '/lib/authoring/core/store.js');
const { packMethods, loadMethods } = require(ROOT + '/plugins/learning/lib/method-pack.js');
const C = require(ROOT + '/lib/authoring/core/contract.js');

const classKey = ( r ) => `${r.kind}|${r.region}|${r.score}`;
const SIGNATURE = ( r ) => ({ structure: { kind: r.kind, region: r.region, score: r.score }, content: {} });

// the STRUCT arm, built on the SHIPPED combo. Same iface as artifact/paper-dll/arms.js. opts.evict=false =
// the neg-control (skip the defeasance sweep). opts.store = file path / Map. opts.combo = reuse an instance.
async function structCombo( stream, env, opts ) {
	opts = opts || {};
	const c = { calls: 0, tokens: 0, maxContext: 0 };
	const activeAudit = env.workload.activeAuditAt;
	const forge = async ( r ) => {
		const { action, len } = await env.model({ record: r, knownAudited: activeAudit(r.index) });
		c.calls++; c.tokens += Math.ceil(len / 4); if ( len > c.maxContext ) c.maxContext = len;
		return { result: action, cost: 1 };
	};
	const store = opts.store != null ? (typeof opts.store === 'string' ? createFileStore(opts.store) : opts.store) : new Map();
	const combo = opts.combo || createLearningLibrary({ signature: SIGNATURE, forge: forge, store: store });
	const actions = [], seen = new Map();
	const { auditAt, auditedSet } = env.workload;
	let evicted = false;
	for ( const r of stream ) {
		if ( !evicted && r.index >= auditAt && opts.evict !== false ) {   // the defeasance sweep (host code, as in arms.js#struct)
			evicted = true;
			for ( const [k, e] of seen ) {
				if ( e.action !== 'approve' ) continue;
				if ( !C.satisfies(['$compliant'], { compliant: !auditedSet.has(auditKey(e.record)) }) ) { combo.drift(e.record); seen.delete(k); }
			}
		}
		const res = await combo.solve(r);
		actions[r.index] = res.result;
		seen.set(classKey(r), { record: r, action: res.result });
	}
	return { name: 'STRUCT-COMBO', calls: c.calls, tokens: c.tokens, maxContext: c.maxContext, actions, combo };
}

const build = () => E.makeWorkload({ kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'], heldOutRegion: 'APAC',
	audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }], preCycles: 2, postCycles: 3 });
const runPaper = async ( w, name ) => { const env = { workload: w, model: H.makeModel('stub') };
	const res = await ARMS[name](w.stream, env); return Object.assign({}, res, H.score(res.actions, w)); };
const runCombo = async ( w, opts ) => { const env = { workload: w, model: H.makeModel('stub') };
	const res = await structCombo(w.stream, env, opts); return Object.assign({}, res, H.score(res.actions, w)); };

// ── (0) the #34 instrumentation guard first: NAIVE must be perfect under the stub ──────────────────
test('instrumentation sound (NAIVE perfect under the stub)', async () => {
	const st = await H.selfTest(build());
	assert.equal(st.ok, true, st.reason);
});

// ── (1) PARITY — the shipped combo reproduces the Map STRUCT corner EXACTLY ────────────────────────
test('STRUCT-COMBO reproduces the Map STRUCT corner (cost-identical: calls, acc, driftAcc, maxCtx)', async () => {
	const w = build();
	const map = await runPaper(w, 'STRUCT'), combo = await runCombo(w);
	assert.equal(combo.acc, 1, 'STRUCT-COMBO is correct overall');
	assert.equal(combo.driftAcc, 1, 'STRUCT-COMBO recovers on drift (selective eviction via combo.drift)');
	assert.equal(combo.calls, map.calls, 'same call count as the Map STRUCT (identical amortization + selective eviction)');
	assert.equal(combo.maxContext, map.maxContext, 'same bounded per-call context');
	assert.ok(combo.calls < w.meta.n, 'amortized: fewer calls than NAIVE would need (=N)');
});

// ── (2) NEG-CTRL — without the eviction sweep, STRUCT-COMBO goes stale (eviction is load-bearing) ──
test('neg-control: STRUCT-COMBO without the eviction sweep goes stale on drift', async () => {
	const w = build();
	const withE = await runCombo(w), noE = await runCombo(w, { evict: false });
	assert.equal(withE.driftAcc, 1);
	assert.ok(noE.driftAcc < 1, 'no-evict serves the stale pre-audit approval (the defeasance is load-bearing, non-vacuous)');
});

// ── (3) RESTART — a file-backed combo store replays the warm library at 0 calls in a fresh instance ──
test('restart: a file-backed combo store replays the warm library at 0 calls', async () => {
	const w = build();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-combo-'));
	const cacheFile = path.join(dir, 'lib.json');
	const pre = w.stream.slice(0, w.auditAt);
	await structCombo(pre, { workload: w, model: H.makeModel('stub') }, { store: cacheFile });   // warm
	const replay = await structCombo(pre, { workload: w, model: H.makeModel('stub') }, { store: cacheFile });   // fresh instance, same file
	assert.equal(replay.calls, 0, 'the warm library survived → 0 model calls in the fresh instance');
	fs.rmSync(dir, { recursive: true, force: true });
});

// ── (4) SHIP — .sgc pack → a fresh deployment replays 0-call; a version-mismatch re-forges ─────────
test('.sgc ship: a fresh deployment replays 0-call; version-mismatch re-forges (never stale)', async () => {
	const w = build();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-ship-'));
	const warm = await structCombo(w.stream.slice(0, w.auditAt), { workload: w, model: H.makeModel('stub') });
	const sgcFile = path.join(dir, 'p2.sgc');
	saveSgc(packMethods(warm.combo.loop, { name: 'p2', version: 'v1' }), sgcFile);
	const receiverCalls = async ( version ) => {
		let calls = 0;
		const rec = createLearningLibrary({ signature: SIGNATURE,
			forge: async ( r ) => { calls++; return { result: (await H.makeModel('stub')({ record: r, knownAudited: new Set() })).action, cost: 1 }; } });
		const ld = loadMethods(loadSgc(sgcFile), rec.loop, { version });
		for ( const r of w.stream.slice(0, w.auditAt) ) await rec.solve(r);
		return { calls, ld };
	};
	const same = await receiverCalls('v1');
	assert.equal(same.calls, 0, 'the shipped library replays at 0 calls in the fresh deployment');
	const cross = await receiverCalls('v2');
	assert.ok(cross.ld.skipped > 0, 'the version-mismatched entries are skipped (never silently replayed)');
	assert.ok(cross.calls >= 1, 'the cross-version receiver RE-FORGES (re-derive, not a stale replay)');
	fs.rmSync(dir, { recursive: true, force: true });
});

// ── (5) PARTIAL — the ladder advantage over a cache: multi-step forge → partial-reforge cost 1 < full ──
test('ladder advantage: a same-class/new-content case is partial-reforged at cost 1 (< full forge)', async () => {
	const FULL = 5, meter = { forge: 0, reForge: 0 };
	const sig = ( p ) => ({ structure: { cls: p.cls }, content: { variant: p.variant } });
	const combo = createLearningLibrary({ signature: sig,
		forge  : async ( p ) => { meter.forge++;   return { result: `do(${p.cls}|${p.variant})`,  cost: FULL }; },
		reForge: async ( p ) => { meter.reForge++; return { result: `do(${p.cls}|${p.variant})*`, cost: 1 }; } });
	const r0 = await combo.solve({ cls: 'X', variant: 'v1' });   // FORGE (full)
	const r1 = await combo.solve({ cls: 'X', variant: 'v1' });   // MATCH (0)
	const r2 = await combo.solve({ cls: 'X', variant: 'v2' });   // same class, new content → RETRIEVE partial
	assert.equal(r0.arm, 'forge'); assert.equal(r0.cost, FULL);
	assert.equal(r1.arm, 'match'); assert.equal(r1.cost, 0);
	assert.equal(r2.arm, 'recall-partial', 'a same-class/new-content case takes the RETRIEVE partial arm');
	assert.equal(r2.cost, 1, 'it re-forges ONLY the differing content (cost 1), not a full re-forge');
	assert.equal(meter.forge, 1, 'the expensive forge ran exactly once');
	assert.equal(meter.reForge, 1, 'the cheap partial re-forge ran exactly once');
});
