'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E1 — STRUCTURAL transfer over a held-out RELATED set + the −F6 ablation (real engine, deterministic).
 * Kill-criterion: F6 must transfer SOUNDLY on ≥30% of held-out related problems; the −F6 ablation (flat
 * cache) must reproduce #30 (unsound replay). The soundness check is load-bearing: calls-alone would rank
 * flat == F6 (both elide), only soundness exposes the wrong-id-space replay.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E1 = require('../../artifact/paper-dll/e1-transfer.js');

test('E1: F6 transfers SOUNDLY on the held-out related set (≥30%), amortizing calls', async () => {
	const r = await E1.measure();
	assert.equal(r.transferRate(r.f6), 1, 'F6: 100% of held-out related transfer at 0 calls AND sound');
	assert.ok(r.transferRate(r.f6) >= 0.3, 'kill-criterion: ≥30% sound transfer');
	assert.ok(r.f6.calls < r.none.calls, `F6 amortizes (${r.f6.calls} < none ${r.none.calls})`);
	// every F6 result is SOUND (no foreign id-space leak), incl. the novel control
	assert.ok(r.f6.rows.every((x) => x.sound), 'all F6 derivations/replays are sound');
});

test('E1: −F6 ABLATION reproduces #30 — the flat cache replays the WRONG id-space (unsound)', async () => {
	const r = await E1.measure();
	// the flat cache DID elide (cost 0 on related) — so calls-alone would call it a win...
	assert.ok(r.related(r.flat).every((x) => x.cost === 0), 'flat cache hits on related (0 calls)');
	// ...but the soundness check catches the wrong-id-space replay: transfer rate (sound) = 0.
	assert.equal(r.transferRate(r.flat), 0, 'flat related transfer is UNSOUND -> #30 reproduced');
	assert.ok(r.related(r.flat).every((x) => !x.sound), 'no flat related replay is sound');
});

test('E1: NEGATIVE CONTROL — a NOVEL transition pays in every mode (no false replay)', async () => {
	const r = await E1.measure();
	assert.ok(r.novel(r.f6).every((x) => x.cost >= 1 && x.sound), 'F6 novel pays + sound (no false replay)');
	assert.ok(r.novel(r.none).every((x) => x.cost >= 1), 'baseline novel pays');
});

test('E1: baseline has NO transfer (every problem re-derives, all sound)', async () => {
	const r = await E1.measure();
	assert.equal(r.transferRate(r.none), 0, 'no cache -> no transfer');
	assert.ok(r.none.rows.every((x) => x.cost === 1 && x.sound), 'each baseline problem derives once, soundly');
	assert.equal(r.none.calls, r.n, 'baseline pays exactly N calls');
});
