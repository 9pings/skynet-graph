'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * E3 — composition-soundness (§11 #6) + false-admit rate + the −G1/−G2/−G3 gate ablations (real engine,
 * deterministic). Kill-criteria: the box-CLOSED compose decision must MATCH open-the-box reality with a
 * ZERO false-admit rate (the checker escalates rather than false-accept); each gate must be load-bearing
 * (removing it introduces a false-admit). acceptRate must be a meaningful fraction (refuse-all can't fake it).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E3 = require('../../artifact/paper-dll/e3-compose.js');

test('E3: box-CLOSED checkCompose MATCHES open-the-box reality; FALSE-ADMIT rate = 0', async () => {
	const s = await E3.soundnessSet();
	assert.equal(s.falseAdmits, 0, 'the checker never false-admits (it escalates instead)');
	assert.equal(s.falseAdmitRate, 0);
	assert.ok(s.matchesReality, 'every box-closed verdict matches the open-box engine outcome');
	// neg control: the kill-pair is genuinely caught (a vacuous "admit nothing" would also be 0 false-admit,
	// so check the SOUND pair really admitted AND the engine really succeeded).
	const sound = s.rows.find((r) => r.pair === 'Normalize→Grade');
	assert.equal(sound.verdict, 'sound'); assert.equal(sound.openBoxOk, true);
	const unsound = s.rows.find((r) => r.pair === 'BadNormalize→Grade');
	assert.equal(unsound.verdict, 'unsound'); assert.equal(unsound.openBoxOk, false);
});

test('E3: every soundness gate is LOAD-BEARING — removing it introduces a false-admit', async () => {
	const ab = await E3.ablations();
	// G1 frame-completeness: ON catches the undeclared write, OFF misses it.
	assert.ok(ab.G1.touched.includes('audit'), 'the body really wrote the undeclared key');
	assert.equal(ab.G1.on, false, 'G1 ON catches the undeclared write');
	assert.equal(ab.G1.off, true, 'G1 OFF misses it (false-admit)');
	assert.ok(ab.G1.falseAdmitIntroduced);
	// G2 effect-tag → oracle: ON escalates, OFF admits.
	assert.equal(ab.G2.on, 'escalate', 'G2 ON escalates an unverified external effect');
	assert.equal(ab.G2.off, 'sound', 'G2 OFF admits it (false-admit)');
	assert.ok(ab.G2.falseAdmitIntroduced);
	// G3 footprint cycle: ON detects the coupled retractable cycle.
	assert.ok(ab.G3.cycles.length > 0, 'G3 ON detects the cycle');
	assert.ok(ab.G3.falseAdmitIntroduced);
});

test('E3: acceptRate is a meaningful coverage fraction (not refuse-all, not admit-all); compose is bounded', async () => {
	const c = E3.coverage();
	assert.ok(c.rate.rate > 0 && c.rate.rate < 1, `acceptRate ${c.rate.rate} is a real fraction`);
	assert.equal(c.rate.n, 4);
	assert.ok(c.rate.sound >= 1 && c.rate.escalate >= 1 && c.rate.unsound >= 1, 'all three verdicts occur');
	// bounded context: the compose decision reads only the shared footprint, a few typed keys (not the body).
	assert.deepEqual(c.sharedFootprint, ['score']);
	assert.ok(c.contractAtoms <= 4, 'compose carries a handful of contract atoms, constant in record volume');
});
