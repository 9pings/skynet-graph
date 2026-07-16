'use strict';
/**
 * M2 — DISK-BACKED PERSISTENCE (2026-06-27): the warm library survives a "restart". A first master-loop
 * (process 1) forges + persists; a SECOND loop built from the SAME file (process 2, fresh cache) replays
 * the recurrent method at 0 model calls. Negative control: a novel problem in process 2 still pays.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createMasterLoop } = require('../../plugins/learning/lib/master-loop.js');
const { createMountController } = require('../../lib/authoring/core/mount.js');
const { createRecallIndex } = require('../../plugins/learning/lib/recall.js');
const { createFileStore, saveIndex, loadIndex } = require('../../lib/authoring/core/store.js');

const signature = ( p ) => ({ structure: { oKind: p.oKind, tKind: p.tKind }, content: { variant: p.variant } });
function counters() {
	const n = { forge: 0 };
	const forge = async ( p ) => { n.forge++; return { result: `M(${p.oKind}->${p.tKind}|${p.variant})`, cost: 1, signals: { reliability: 0.9, depth: 1, readOnlyFrontier: true } }; };
	return { n, forge };
}

test('the warm library survives a restart: a fresh process replays at 0 calls (cache persistence)', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-persist-'));
	const cacheFile = path.join(dir, 'cache.json');
	try {
		// ── process 1: forge two methods → persisted to disk.
		const c1 = counters();
		const loop1 = createMasterLoop({ signature, forge: c1.forge, cache: createFileStore(cacheFile), mount: createMountController() });
		await loop1.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
		await loop1.solve({ oKind: 'C', tKind: 'D', variant: 'v1' });
		assert.equal(c1.n.forge, 2);
		assert.ok(fs.existsSync(cacheFile), 'the library was persisted to disk');

		// ── process 2 ("restart"): a FRESH loop + fresh counters, re-hydrating the SAME file.
		const c2 = counters();
		const loop2 = createMasterLoop({ signature, forge: c2.forge, cache: createFileStore(cacheFile), mount: createMountController() });
		const a = await loop2.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
		const b = await loop2.solve({ oKind: 'C', tKind: 'D', variant: 'v1' });
		assert.equal(a.arm, 'match'); assert.equal(b.arm, 'match');
		assert.equal(c2.n.forge, 0, 'the restarted process replayed the warm library at 0 model calls');

		// NEGATIVE control: a genuinely novel problem still pays after the restart.
		const z = await loop2.solve({ oKind: 'E', tKind: 'F', variant: 'v1' });
		assert.equal(z.arm, 'forge'); assert.equal(c2.n.forge, 1);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the recall INDEX survives a restart: partial reuse works cross-process (index persistence)', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-persist-'));
	const idxFile = path.join(dir, 'index.json');
	try {
		// process 1: forge {A,B,v1} → save the index.
		const c1 = counters();
		const idx1 = createRecallIndex();
		const loop1 = createMasterLoop({ signature, forge: c1.forge, index: idx1, cache: new Map(), mount: createMountController() });
		await loop1.solve({ oKind: 'A', tKind: 'B', variant: 'v1' });
		saveIndex(idx1, idxFile);

		// process 2 (restart): load the index into a fresh loop with a fresh cache.
		const c2 = counters();
		const idx2 = createRecallIndex();
		assert.equal(loadIndex(idx2, idxFile), 1, 'the index re-hydrated from disk');
		const loop2 = createMasterLoop({ signature, forge: c2.forge, index: idx2, cache: new Map(), mount: createMountController() });
		// same structure, NEW content → recall-partial off the persisted method (skeleton survived the restart).
		const r = await loop2.solve({ oKind: 'A', tKind: 'B', variant: 'v2' });
		assert.equal(r.arm, 'recall-partial', 'the persisted method skeleton is reused across the restart');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
