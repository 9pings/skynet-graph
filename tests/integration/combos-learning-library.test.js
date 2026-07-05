'use strict';
/**
 * Combos C3 — the LEARNING METHOD LIBRARY skeleton gate verification (roadmap P2 / design doc §3).
 *
 * A DETERMINISTIC integration test (no GPU, no network): a canned `signature` + a call-counting `forge`
 * are injected exactly like the proven smoke (scratchpad/smoke-learnlib.js). It locks in
 * `lib/combos/learning-library.js#createLearningLibrary` behavior AND doubles as the combo's product gates:
 *
 *   1  élision curve  — a recurrent typed stream climbs MATCH→RECALL→FORGE; repeats elide the forge.
 *   2  restart        — a fresh process on the SAME disk-backed store replays a warm method at 0 calls.
 *   3  ship (.sgc)    — a warm library packs to a portable bundle a different deployment loads + replays;
 *                       a CROSS-VERSION load refuses (added:0) and the receiver re-forges (never a stale hit).
 *   4  drift recovery — drift() re-derives the violated method (not stale); a 2nd drift pins it to the
 *                       ESCALATE floor (the well-founded K1 bottom of the mount-rank).
 *   5  no forge       — createLearningLibrary without opts.forge throws (the expensive path is required).
 *   6  facade         — reachable via require(lib/index.js).combos.createLearningLibrary (same function).
 *
 * The combo requires the engine bricks internally; `lib/graph/index.js` defaults __SERVER__ to server, but
 * we set it explicitly (as the smoke does) so the file boots standalone regardless of load order.
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createLearningLibrary } = require('../../lib/combos/learning-library.js');

// ── the typed K1 signature: STRUCTURE = method class (mount/deopt key), CONTENT = the derived diff. ──────
const signature = ( p ) => ({ structure: { oKind: p.oKind, tKind: p.tKind }, content: { variant: p.variant } });

// ── a call-counting forge/reForge pair (the "expensive path"); n exposes the invocation counters. ───────
function mkForge() {
	const n = { forge: 0, reForge: 0 };
	return {
		n,
		forge: async ( p ) => {
			n.forge++;
			return {
				result : `do(${p.oKind}->${p.tKind}|${p.variant})`,
				cost   : 1,
				signals: { reliability: 0.9, depth: 1, readOnlyFrontier: true }
			};
		},
		reForge: async ( p ) => {
			n.reForge++;
			return { result: `do(${p.oKind}->${p.tKind}|${p.variant})*`, cost: 1 };
		}
	};
}

// The recurrent stream: A-B|v1 (forge) · A-B|v1 (match) · A-B|v2 (recall-partial) · C-D|v1 (forge) · A-B|v3 (recall-partial).
const STREAM = [
	{ oKind: 'A', tKind: 'B', variant: 'v1' },
	{ oKind: 'A', tKind: 'B', variant: 'v1' },
	{ oKind: 'A', tKind: 'B', variant: 'v2' },
	{ oKind: 'C', tKind: 'D', variant: 'v1' },
	{ oKind: 'A', tKind: 'B', variant: 'v3' }
];
const AB_V1 = { oKind: 'A', tKind: 'B', variant: 'v1' };
const CD_V1 = { oKind: 'C', tKind: 'D', variant: 'v1' };

// Build a WARM library on a fresh disk-backed store, run the recurrent stream through it, and return the
// live combo + its forge counter + the observed arms + the forge count captured RIGHT AFTER the stream
// (later drift solves increment the counter — capture it before then). Each caller owns + cleans its dir.
async function makeWarm() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ll-'));
	const file = path.join(dir, 'lib.json');
	const F = mkForge();
	const ll = createLearningLibrary({ signature, forge: F.forge, reForge: F.reForge, store: file, maxDeopt: 2 });
	const arms = [];
	for ( const p of STREAM ) { const r = await ll.solve(p); arms.push(r.arm); }
	return { dir, file, F, ll, arms, streamForges: F.n.forge };
}

// ── 1 · Élision curve — the recurrent stream amortizes the forge (2 forges for 5 problems) ──────────────
test('1 élision: the recurrent typed stream climbs MATCH→RECALL→FORGE and elides repeats', async () => {
	const w = await makeWarm();
	try {
		assert.deepEqual(w.arms, ['forge', 'match', 'recall-partial', 'forge', 'recall-partial'],
			'the arms climb the cost ladder: cold forge, exact match, then partial recall on the shared skeleton');
		assert.equal(w.streamForges, 2, 'exactly 2 forges warmed the library for 5 problems (3 elided)');

		const s = w.ll.stats();
		assert.equal(s.forge, 2, 'stats.forge = 2 (the two distinct method classes were forged once each)');
		assert.equal(s.match, 1, 'stats.match = 1 (the exact repeat replayed at 0 calls)');
		assert.equal(s.recallPartial, 2, 'stats.recallPartial = 2 (the two variant repeats re-forged only the diff)');
		assert.equal(s.recallFull, 0, 'no full-recall replay in this stream');
		assert.equal(s.escalate, 0, 'nothing escalated in the warm stream');
	} finally {
		fs.rmSync(w.dir, { recursive: true, force: true });
	}
});

// ── 2 · Restart persistence — a fresh process on the SAME store file replays at 0 calls ─────────────────
test('2 restart: a fresh combo on the same disk-backed store replays a warm method at 0 forges', async () => {
	const w = await makeWarm();
	try {
		// A COLD process: a brand-new combo (fresh forge counter) pointed at the SAME store file.
		const F2 = mkForge();
		const ll2 = createLearningLibrary({ signature, forge: F2.forge, reForge: F2.reForge, store: w.file });
		const after = await ll2.solve(AB_V1);

		assert.equal(after.arm, 'match', 'the disk-backed method is re-hydrated → exact MATCH on restart');
		assert.equal(after.cost, 0, 'the replay costs 0 (no model call)');
		assert.equal(F2.n.forge, 0, 'the fresh process forged NOTHING — the library survived the restart');
	} finally {
		fs.rmSync(w.dir, { recursive: true, force: true });
	}
});

// ── 3 · Ship (.sgc) — a warm library packs into a portable bundle a fresh deployment loads + replays ────
test('3 ship: pack() → a portable .sgc a receiver loads and replays at 0 forges (version-gated)', async () => {
	const w = await makeWarm();
	try {
		// SAME-VERSION: an empty deployment (in-memory, no store) loads the v1 pack under v1 → replays.
		const F3 = mkForge();
		const dep = createLearningLibrary({ signature, forge: F3.forge, reForge: F3.reForge });
		const loaded = dep.load(w.ll.pack({ name: 'demo', version: 'v1' }), { version: 'v1' });
		assert.ok(loaded.added > 0, 'the receiver hydrated ' + loaded.added + ' methods from the .sgc bundle');

		const s = await dep.solve(AB_V1);
		assert.equal(s.arm, 'match', 'the shipped method replays as an exact MATCH in the receiver');
		assert.equal(s.cost, 0, 'the shipped replay costs 0');
		assert.equal(F3.n.forge, 0, 'the receiver forged NOTHING — it replayed the shipped library');

		// CROSS-VERSION: the same v1 pack loaded under v2 → the gate REFUSES (added:0/skipped>0); re-forge.
		const F4 = mkForge();
		const dep2 = createLearningLibrary({ signature, forge: F4.forge, reForge: F4.reForge });
		const stale = dep2.load(w.ll.pack({ name: 'demo', version: 'v1' }), { version: 'v2' });
		assert.equal(stale.added, 0, 'the version gate injected NOTHING across a version mismatch');
		assert.ok(stale.skipped > 0, 'the mismatched entries were skipped (' + stale.skipped + '), never replayed');

		const s2 = await dep2.solve(AB_V1);
		assert.equal(s2.arm, 'forge', 'the cross-version receiver RE-FORGES (a stale method is never replayed)');
		assert.equal(F4.n.forge, 1, 'exactly one fresh forge — the sound re-derivation, not a stale match');
	} finally {
		fs.rmSync(w.dir, { recursive: true, force: true });
	}
});

// ── 4 · Drift recovery — drift() re-derives; a 2nd drift pins the method to the ESCALATE floor ──────────
test('4 drift: drift re-derives the violated method; a 2nd drift descends to the ESCALATE floor', async () => {
	const w = await makeWarm();   // maxDeopt:2 → the floor is reached after 2 deopts
	try {
		// First drift → invalidate the C-D method (cache + recall) + one deopt; the next solve RE-DERIVES.
		w.ll.drift(CD_V1);
		const d1 = await w.ll.solve(CD_V1);
		assert.equal(d1.arm, 'forge', 'after a drift the violated method is re-forged (not a stale replay)');

		// Second drift → deoptCount hits maxDeopt (2) → the method is pinned to the ESCALATE floor.
		w.ll.drift(CD_V1);
		const d2 = await w.ll.solve(CD_V1);
		assert.equal(d2.regime, 'escalate', 'a method deopted to the K1 floor stays in the LLM (escalate regime)');
	} finally {
		fs.rmSync(w.dir, { recursive: true, force: true });
	}
});

// ── 5 · No forge — the expensive path is REQUIRED (the combo needs a forge to boot) ─────────────────────
test('5 no forge: createLearningLibrary without opts.forge throws', () => {
	assert.throws(() => createLearningLibrary({ signature }), /needs opts\.forge/i,
		'no forge → the combo never boots (the expensive path is required)');
});

// ── 6 · Facade — reachable via require(lib/index.js).combos.createLearningLibrary (same function) ────────
test('6 facade: Graph.combos.createLearningLibrary is the live wiring', () => {
	const facade = require('../../lib/index.js');
	assert.equal(typeof facade.combos, 'object', 'the facade exposes a combos namespace');
	assert.equal(facade.combos.createLearningLibrary, createLearningLibrary,
		'the facade createLearningLibrary is the same function as the module export');
});
