'use strict';
/**
 * method-pack (lib/authoring/learning/method-pack.js) — the `.sgc` CRYSTALLIZED-METHOD package (M3). Round-trip +
 * derived typed schema; the load-bearing B8 VERSION GATE (a same-version package replays at 0 calls, a
 * cross-version one is REFUSED → the host re-forges); the typed VERIFY still rejects a structurally-foreign
 * packaged method across deployments; and the end-to-end cross-deployment ship (pack → .sgc file → fresh
 * host → 0 forges). Every claim carries a negative control. Pure host-side, ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { packMethods, unpackMethods, deriveMethodSchema, loadMethods } = require('../../lib/authoring/learning/method-pack');
const { createMasterLoop } = require('../../lib/authoring/learning/master-loop');
const { saveSgc, loadSgc } = require('../../lib/authoring/core/store');

const signature = ( p ) => ({ structure: { oKind: p.oKind, tKind: p.tKind }, content: { variant: p.variant } });

// a counting forge lib (like examples/poc/master-loop.js) — every full forge bumps n.forge.
function lib() {
	const n = { forge: 0, reForge: 0 };
	return { n,
		forge  : async ( p ) => { n.forge++;  return { result: `do(${p.oKind}->${p.tKind}|${p.variant})`,  cost: 1, signals: { reliability: 0.9, depth: 1, readOnlyFrontier: true } }; },
		reForge: async ( p ) => { n.reForge++; return { result: `do(${p.oKind}->${p.tKind}|${p.variant})*`, cost: 1 }; } };
}
function freshLoop() { const L = lib(); return { loop: createMasterLoop({ signature, forge: L.forge, reForge: L.reForge }), n: L.n }; }

// warm a deployment with two distinct method classes, return its loop.
async function warm() {
	const { loop, n } = freshLoop();
	await loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });   // forge
	await loop.solve({ oKind: 'C', tKind: 'D', variant: 'v1' });   // forge
	assert.equal(n.forge, 2, 'two cold forges warmed the library');
	return { loop, n };
}

test('packMethods → unpackMethods round-trips the entries + derives the typed schema', async () => {
	const { loop } = await warm();
	const bundle = packMethods(loop, { name: 'travel', version: 'v1', description: 'demo' });
	assert.equal(bundle.format, 'sgc');
	assert.equal(bundle.kind, 'methods');
	assert.equal(bundle.manifest.name, 'travel');
	assert.equal(bundle.manifest.version, 'v1');
	assert.equal(bundle.manifest.methodCount, 2);

	const back = unpackMethods(bundle, { hostVersion: 'v1' });
	assert.equal(back.methods.length, 2);
	assert.equal(back.versionPackage, 'v1');
	assert.equal(back.exactReplaySafe, true);
	// derived schema: the K1 structure discriminants + the derived content holes, both self-described.
	assert.deepEqual(back.schema.structureKeys, ['oKind', 'tKind']);
	assert.deepEqual(back.schema.contentKeys, ['variant']);
	assert.equal(back.schema.classes.length, 2, 'two distinct typed method classes (A->B, C->D)');

	// deriveMethodSchema is a pure fn of the entries
	const sch = deriveMethodSchema(bundle.methods);
	assert.deepEqual(sch.structureKeys, ['oKind', 'tKind']);

	// NEGATIVE CONTROL: a non-methods bundle is refused (corpus bundle, or a bare object).
	assert.throws(() => unpackMethods({ format: 'sgc', kind: 'corpus' }), /methods bundle/);
	assert.throws(() => unpackMethods({ foo: 1 }), /not an \.sgc/);
});

test('B8 version gate: same-version load replays at 0 forges; cross-version load is REFUSED → re-forge', async () => {
	const src = await warm();
	const bundle = packMethods(src.loop, { version: 'v1' });

	// ── SAME version → both replay paths hydrated; the recurrent problem replays at 0 model calls.
	const same = freshLoop();
	const rSame = loadMethods(bundle, same.loop, { version: 'v1' });
	assert.equal(rSame.exactReplaySafe, true);
	assert.equal(rSame.added, 2);
	assert.equal(rSame.exactReplayed, 2);
	const hit = await same.loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(hit.arm, 'match', 'exact cache hit after a same-version load');
	assert.equal(hit.cost, 0);
	assert.equal(same.n.forge, 0, 'the warm library survived the transfer — 0 forges in the receiving host');

	// ── CROSS version → NEITHER path hydrated; the host re-forges (no stale replay). The control.
	const cross = freshLoop();
	const rCross = loadMethods(bundle, cross.loop, { version: 'v2' });
	assert.equal(rCross.exactReplaySafe, false);
	assert.equal(rCross.added, 0, 'recall index NOT hydrated cross-version');
	assert.equal(rCross.exactReplayed, 0, 'exact cache NOT hydrated cross-version');
	assert.equal(rCross.skipped, 2);
	const miss = await cross.loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(miss.arm, 'forge', 'cross-version host re-forges (never a stale verbatim replay) — this is the B8 line');
	assert.equal(cross.n.forge, 1);

	// the gate is OPT-IN: if neither side declares a version, it is permissive (full hydration).
	const permissive = freshLoop();
	const noVer = packMethods(src.loop);                       // version defaults to '0.0.0'
	const rPerm = loadMethods(noVer, permissive.loop, {});     // host declares no version → permissive
	assert.equal(rPerm.exactReplaySafe, true);
	assert.equal(rPerm.exactReplayed, 2);
});

test('typed VERIFY still rejects a structurally-FOREIGN packaged method across deployments (no false replay)', async () => {
	const { loop } = await warm();                            // library has A->B and C->D
	const bundle = packMethods(loop, { version: 'v1' });
	const recv = freshLoop();
	loadMethods(bundle, recv.loop, { version: 'v1' });

	// a query with a DIFFERENT typed structure: recall may surface a fuzzy neighbour, but the exact typed
	// verify on the receiver REJECTS it (structure mismatch) → forge fresh, never a wrong replay.
	const foreign = await recv.loop.solve({ oKind: 'X', tKind: 'Y', variant: 'v1' });
	assert.equal(foreign.arm, 'forge', 'a structurally-foreign method is rejected by verify → forged, not replayed');
	assert.equal(recv.n.forge, 1);

	// NEGATIVE CONTROL: a query whose structure MATCHES a packaged class replays at 0 cost (the gate admits).
	const local = await recv.loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	assert.equal(local.cost, 0, 'a matching typed structure replays at 0 cost');
	assert.equal(recv.n.forge, 1, 'no extra forge for the matching class');
});

test('end-to-end: ship the library as a .sgc file across deployments → the receiver replays at 0 forges', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgc-methods-'));
	const file = path.join(dir, 'travel.sgc');

	// ── deployment 1: warm a library, pack it, write the .sgc file.
	const dep1 = await warm();
	const ok = saveSgc(packMethods(dep1.loop, { name: 'travel', version: '2.0.0' }), file);
	assert.equal(ok, true);
	assert.ok(fs.existsSync(file), 'the .sgc file is on disk');

	// ── deployment 2: a brand-new process/host re-reads the file and loads the library.
	const reread = loadSgc(file);
	assert.equal(reread.kind, 'methods');
	const dep2 = freshLoop();
	const r = loadMethods(reread, dep2.loop, { version: '2.0.0' });
	assert.equal(r.exactReplaySafe, true);

	const a = await dep2.loop.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
	const c = await dep2.loop.solve({ oKind: 'C', tKind: 'D', variant: 'v1' });
	assert.equal(a.cost, 0); assert.equal(c.cost, 0);
	assert.equal(dep2.n.forge, 0, 'the receiving deployment paid 0 model calls — the library moved, not just survived a restart');

	// a genuinely novel problem still pays (the library is not a blanket 0).
	const novel = await dep2.loop.solve({ oKind: 'E', tKind: 'F', variant: 'v1' });
	assert.equal(novel.arm, 'forge');
	assert.equal(dep2.n.forge, 1);

	// loadSgc fail-open on a corrupt/missing file.
	assert.equal(loadSgc(path.join(dir, 'nope.sgc')), null);
	fs.rmSync(dir, { recursive: true, force: true });
});
