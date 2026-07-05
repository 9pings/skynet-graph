'use strict';
/**
 * Combos C4 — the REACTIVE KG (roadmap P1 / design doc, `lib/combos/index.js#reactiveKG`).
 *
 * A DETERMINISTIC integration test (no GPU, no network). C4 is a one-line preset over
 * `Graph.fromDirs({ builtins:true, ... })` that names the engine's ORIGINAL Use-1 (rule-KG +
 * concepts + stabilization + travel/geo). The bricks (the core + fromDirs) stay the real entry,
 * usable "à nu"; this locks in that the sugar boots a working Graph with builtins ON.
 *
 *   boot     — reactiveKG({concepts}) returns a live Graph (pushMutation/rollbackTo/getRevisions)
 *              whose active concept set includes 'common'.
 *   builtins — builtins are ON by default (the geo provider is registered) and the graph settles
 *              an empty seed without throwing.
 *   facade   — Graph.combos.reactiveKG is a function.
 *
 * The engine defaults __SERVER__ to server (lib/graph/index.js), but we set it explicitly so the
 * file boots standalone regardless of load order (mirrors combos-appliance.test.js).
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';   // quiet the boot banner / divergent noise
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Graph = require('../../lib/index.js');

const COMMON = path.resolve(__dirname, '../../concepts/common');

// ── boot — a live Graph over concepts/common, active set includes 'common' ────────────────────────────
test('C4 reactiveKG: boots a live Graph over concepts/common (conceptSets includes common)', () => {
	const g = Graph.combos.reactiveKG({ concepts: COMMON });
	try {
		assert.equal(typeof g.pushMutation, 'function', 'a working Graph exposes pushMutation');
		assert.equal(typeof g.rollbackTo, 'function', 'the MOE reversibility verb rollbackTo is present');
		assert.equal(typeof g.getRevisions, 'function', 'the MOE getRevisions verb is present');
		assert.ok(Array.isArray(g.cfg.conceptSets) && g.cfg.conceptSets.indexOf('common') !== -1,
			'cfg.conceptSets includes the loaded "common" set (' + JSON.stringify(g.cfg.conceptSets) + ')');
	} finally {
		g.destroy();
	}
});

// ── builtins ON by default — the geo provider is registered; the empty seed settles ───────────────────
test('C4 reactiveKG: builtins ON by default (geo provider registered), settles an empty seed', async () => {
	const g = Graph.combos.reactiveKG({ concepts: COMMON });
	try {
		assert.ok(Graph._providers && typeof Graph._providers.CommonGeo === 'object',
			'builtins:true registered the packaged geo provider (CommonGeo)');
		// a working Graph instance settles a quiescent empty seed without throwing
		await Graph.settle(g);
		const revs = g.getRevisions();
		assert.ok(Array.isArray(revs) && revs.length > 0,
			'the empty seed stabilized and captured a revision (' + JSON.stringify(revs) + ')');
	} finally {
		g.destroy();
	}
});

// ── facade — Graph.combos.reactiveKG is a function ────────────────────────────────────────────────────
test('C4 facade: Graph.combos.reactiveKG is a function', () => {
	assert.equal(typeof Graph.combos.reactiveKG, 'function',
		'the reactive KG preset is reachable via the facade combos namespace');
});
