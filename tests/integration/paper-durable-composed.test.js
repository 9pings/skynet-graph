'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the composition-under-drift wedge ON THE REAL DURABLE EXECUTOR (lib/durable/), the deterministic
 * regression for `artifact/paper-dll/durable-composed.js`. A 2-link chain decide→disburse compiled to a workflow
 * net and run as a token-flow over the CheckpointStore. Claims (each + a negative control): the chain amortizes
 * + cascades on drift (both links), a premise-less key compounds (neg control), the warm library survives a
 * RESTART at 0 calls (SQLite), and a half-done chain RESUMES with no lost/duplicated work.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.resolve(__dirname, '../..');
const D = require(ROOT + '/artifact/paper-dll/durable-composed.js');
const { makeComposedWorkload } = require(ROOT + '/artifact/paper-dll/composed-workload.js');
const { createMemoryCheckpointStore, createSqliteCheckpointStore } = require(ROOT + '/lib/durable/checkpoint-store.js');

const W = () => makeComposedWorkload({ kinds: ['loan', 'refund', 'wire'], regions: ['EU', 'US', 'APAC'],
	heldOutRegion: 'APAC', audited: [{ region: 'EU', kind: 'loan' }, { region: 'US', kind: 'wire' }], preCycles: 2, postCycles: 3 });
const model = D.makeModel({});   // deterministic stub (perfect oracle)

test('STRUCT-DUR: the chain amortizes + cascades on drift (both links recovered) on the durable executor', async () => {
	const w = W(), recs = D.durableRecords(w);
	const r = await D.runChain(createMemoryCheckpointStore(), 'r', recs, model, true);
	const s = D.score(r.byId, w);
	assert.equal(s.ok, s.n, 'end-to-end correct');
	assert.equal(s.drift1, 1, 'link 1 (decision) recovered on drift');
	assert.equal(s.drift2, 1, 'link 2 (disbursement) recovered — the JTMS-style cascade on the durable layer');
	assert.ok(r.calls < w.meta.n * 2, `amortized vs the ${w.meta.n * 2}-call naive chain (got ${r.calls})`);
});

test('NEG CONTROL: a premise-less key (STRUCT-DUR-FLAT) compounds — stale at BOTH links', async () => {
	const w = W(), recs = D.durableRecords(w);
	const s = D.score((await D.runChain(createMemoryCheckpointStore(), 'rf', recs, model, false)).byId, w);
	assert.equal(s.drift1, 0, 'stale at link 1 (the premise must be in the key)');
	assert.equal(s.drift2, 0, 'compounds: stale at link 2 too');
});

test('NEG CONTROL: a flat composed cache (BLOB) compounds on drift', async () => {
	const w = W(), recs = D.durableRecords(w);
	const s = D.score((await D.blobChain(recs, model)).byId, w);
	assert.ok(s.drift1 < 1 && s.drift2 < 1, 'the flat composed cache serves the stale chain at both links');
});

test('CROSS-RESTART: a fresh store on the same SQLite file replays the warm chain at 0 calls', async () => {
	const w = W(), recs = D.durableRecords(w);
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sg-dt-')), 'm.sqlite');
	const s1 = createSqliteCheckpointStore({ file }); const cold = await D.runChain(s1, 'm', recs, model, true); s1.close();
	const s2 = createSqliteCheckpointStore({ file }); const warm = await D.runChain(s2, 'm2', recs, model, true); s2.close();
	assert.ok(cold.calls > 0, 'process 1 paid cold');
	assert.equal(warm.calls, 0, 'process 2 (a fresh store, same file = a restart) replays the warm composed library at 0 calls');
	const sw = D.score(warm.byId, w);
	assert.equal(sw.ok, sw.n, 'and the replayed chain is correct');
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('CRASH-RESUME: a half-done chain resumes with no lost or duplicated work', async () => {
	const w = W(), recs = D.durableRecords(w);
	const cold = await D.runChain(createMemoryCheckpointStore(), 'cold', recs, model, true);
	const cs = createMemoryCheckpointStore();
	const cut = await D.runChain(cs, 'c', recs, model, true, { maxSteps: w.meta.n + 12 });   // crash mid-chain (fuel cut)
	cs.rollbackInflight('c');                                                                 // recover in-flight tokens
	const resume = await D.runChain(cs, 'c', null, model, true);                              // resume from the durable marking
	const s = D.score(resume.byId, w);
	assert.equal(s.ok, s.n, 'resume completes the run correctly');
	assert.equal(cut.calls + resume.calls, cold.calls, `no model work lost or duplicated (cut ${cut.calls} + resume ${resume.calls} == cold ${cold.calls})`);
});
