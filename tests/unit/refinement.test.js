'use strict';
/**
 * refinement (iterative refinement / reflexion) — the THIRD client of reason-kernel, Tier-0 pure grammar.
 * Structural, 0-model: attempts are hand-seeded with a raw score; the kernel snaps each to a K1 band
 * (Scored / Score::band), Accept is the ThresholdGate on the band, Refine is the bounded refine signal
 * (below threshold AND round < maxRounds — the null-guard-round). The host produces the refined answer +
 * score each round; this proves the accept / keep-going / stop control flow.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');

const RF_DIR = path.join(__dirname, '..', '..', 'plugins', 'refinement');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('refinement graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

function boot(nodes) {
	const rf = definePlugin(RF_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([rf]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, freeNodes: [], nodes, segments: [] },
		{ label: 'rf-test', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap
	);
	return { g, cfg };
}
const attempt = (id, score, round, maxRounds) => ({ _id: id, isThought: true, score, round, maxRounds: maxRounds == null ? 3 : maxRounds });

test('refinement is the 3rd client: resolves reason-kernel first, both concept sets merged', () => {
	const rf = definePlugin(RF_DIR, [loadPlugin(RK_DIR)]);
	const cfg = resolvePlugins([rf]);
	assert.deepEqual(cfg.order, ['reason-kernel', 'refinement']);
	assert.deepEqual(Object.keys(cfg.conceptMap).sort(), ['kernel', 'refinement']);
	assert.equal(typeof cfg.providers.Score.band, 'function', 'the Score brick from the kernel');
});

test('score snaps to a K1 band (never a raw float) — the kernel Scored/Score::band', async () => {
	const { g } = boot([attempt('a-lo', 0.4, 0), attempt('a-mid', 0.6, 0), attempt('a-hi', 0.9, 0)]);
	await settle(g);
	assert.equal(cast(g, 'a-lo', 'Scored'), true, 'Scored casts (requires the kernel Thought + score)');
	assert.equal(fact(g, 'a-lo', 'scoreBand'), 'low');
	assert.equal(fact(g, 'a-mid', 'scoreBand'), 'mid');
	assert.equal(fact(g, 'a-hi', 'scoreBand'), 'high');
});

test('Accept gates on the band; Refine keeps going below threshold within the round budget', async () => {
	const { g } = boot([
		attempt('r0', 0.4, 0, 3),   // low, round 0 → refine
		attempt('r1', 0.6, 1, 3),   // mid, round 1 → refine
		attempt('r2', 0.9, 2, 3),   // high         → accept
	]);
	await settle(g);
	assert.equal(cast(g, 'r2', 'Accept'), true, 'accepted the high-band attempt');
	assert.equal(cast(g, 'r2', 'Refine'), false, 'a high attempt does not refine');
	assert.equal(cast(g, 'r0', 'Refine'), true, 'a low attempt with budget refines');
	assert.equal(cast(g, 'r1', 'Refine'), true, 'a mid attempt with budget refines');
	assert.equal(cast(g, 'r0', 'Accept'), false, 'a low attempt is not accepted');
});

test('NEGATIVE control — the null-guard-round holds: at maxRounds a below-threshold attempt neither accepts NOR refines', async () => {
	const { g } = boot([attempt('last', 0.4, 3, 3)]);   // low, round == maxRounds → loop terminates
	await settle(g);
	assert.equal(fact(g, 'last', 'scoreBand'), 'low');
	assert.equal(cast(g, 'last', 'Accept'), false, 'not accepted (band not high)');
	assert.equal(cast(g, 'last', 'Refine'), false, 'not refined either — the round budget is spent (no infinite loop)');
});

test('re-run determinism', async () => {
	const run = async () => {
		const { g } = boot([attempt('r0', 0.4, 0, 3), attempt('r1', 0.9, 1, 3)]);
		await settle(g);
		return [cast(g, 'r0', 'Refine'), cast(g, 'r1', 'Accept'), fact(g, 'r1', 'scoreBand')].join('/');
	};
	assert.equal(await run(), await run());
});
