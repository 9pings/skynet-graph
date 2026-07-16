'use strict';
/**
 * Combos C5 — SUPERVISED SELF-MODIFICATION (roadmap P3-bis, `lib/factories/self-mod.js#createSelfMod`).
 *
 * A DETERMINISTIC integration test (no GPU, no network). C5 is a thin, GUARDED packaging of the engine's
 * live-rule-editing bricks (authorConcept/supervise/patchConcept/addConcept/rollbackTo/relearn). It edits
 * the LIVE rules, so it is exposed with prudence — and this file locks that posture in:
 *
 *   guards        — createSelfMod without a graph THROWS /graph/; author() without a proposer THROWS /proposer/.
 *   author (core) — the CEGIS loop converges with a DETERMINISTIC stub proposer (reused EXACTLY from
 *                   author-cegis.test.js: reject-malformed → install-too-strict → patch-to-meet-goal).
 *   reversibility — structural ops capture revisions() (a non-empty ascending array); rollbackTo(<earlier>)
 *                   restores the prior state and the authored concept is GONE (the engine supports it here).
 *   structural    — patch()/addConcept() return promises that resolve; the add casts on the live graph.
 *   facade        — Graph.factories.createSelfMod is the live wiring; relearn.tree/relearn.providers are exposed.
 *
 * The graph is booted EXACTLY as author-cegis.test.js#bootGraph (a minimal conceptMap + a seed segment
 * carrying Distance 400), so the reused stub proposer converges bit-for-bit the same way — no invented schema.
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';   // quiet the boot banner / divergent noise
const { test } = require('node:test');
const assert = require('node:assert');
const Graph = require('../../lib/index.js');
const { createSelfMod } = Graph.factories;

// ── boot — mirrors author-cegis.test.js#bootGraph EXACTLY: minimal conceptMap + a seg with Distance 400 ─
function bootGraph( label ) {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {} } };
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};
	return new Promise(( resolve ) => {
		const g = new Graph(seed, {
			label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if ( !g.__booted ) { g.__booted = true; resolve(g); } }
		}, conceptMap);
	});
}

// ── the DETERMINISTIC stub proposer + goal + validate, reused EXACTLY from author-cegis.test.js ────────
// goal: segment `seg` ends up carrying the Far fact.
const goal = ( graph ) => {
	const met = graph._objById['seg']._etty._.Far === true;
	return { met, counterexample: met ? null : 'seg.Distance.inKm=400 did not produce Far' };
};
// three scripted moves: (0) malformed → validator rejects; (1) well-formed but too strict → installs, unmet;
// (2) patch loosening the threshold → 400 > 300 → goal met.
const propose = async ({ round }) => {
	if ( round === 0 )
		return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', ensure: ['$Distance.inKm ==== ('] } };
	if ( round === 1 )
		return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 500'] } };
	return { op: 'patch', nameOrId: 'Far', updates: { assert: ['$Distance.inKm > 300'] } };
};
const validate = { knownFacts: ['Distance', 'Segment'], palette: [] };

// ── guards — the two prudence barriers (opt-in graph + required proposer) ──────────────────────────────
test('C5 guards: createSelfMod needs a graph; author() needs a proposer', async () => {
	assert.throws(() => createSelfMod({}), /graph/i, 'no graph → the combo refuses to build');

	const g = await bootGraph('c5-guard');
	try {
		const sm = createSelfMod({ graph: g });                 // built, but no proposer declared
		assert.throws(() => sm.author({ goal: () => ({ met: true }) }), /proposer/i,
			'author() without opts.propose or spec.propose → the proposer guard fires');
	} finally {
		g.destroy();
	}
});

// ── author (the core) — the CEGIS loop converges with the deterministic stub ───────────────────────────
test('C5 author: CEGIS converges to author a live concept (deterministic stub)', async () => {
	const g = await bootGraph('c5-author');
	try {
		const sm = createSelfMod({ graph: g, propose, validate });
		assert.ok(!g._objById['seg']._etty._.Far, 'goal not met at start');

		const res = await sm.author({ goal, goalDescription: 'segment should be Far', maxRounds: 5 });

		assert.equal(res.ok, true, 'authoring converged');
		assert.equal(res.concept, 'Far', 'the Far concept is the authored result');
		assert.equal(g._objById['seg']._etty._.Far, true, 'the goal actually holds on the live graph');
		// the three feedback paths threaded the counterexamples back, in order.
		assert.equal(res.rounds.length, 3, 'three CEGIS rounds (reject → unmet → met)');
		assert.equal(res.rounds[0].outcome, 'rejected', 'the malformed candidate was rejected by the validator');
		assert.equal(res.rounds[1].outcome, 'unmet', 'the too-strict candidate installed but left the goal unmet');
		assert.equal(res.rounds[2].outcome, 'met', 'the loosening patch met the goal');
	} finally {
		g.destroy();
	}
});

// ── reversibility — THE guarantee: revisions() ascend; rollbackTo restores + the authored concept is gone
test('C5 reversibility: revisions() ascend and rollbackTo restores the pre-author state', async () => {
	const g = await bootGraph('c5-rollback');
	try {
		const sm = createSelfMod({ graph: g, propose, validate });

		const before = sm.revisions();
		assert.ok(Array.isArray(before) && before.length > 0, 'the boot captured a revision');

		const res = await sm.author({ goal, maxRounds: 5 });
		assert.equal(res.ok, true, 'authoring converged (precondition for the rollback test)');

		const after = sm.revisions();
		assert.ok(Array.isArray(after) && after.length > before.length,
			'authoring captured a new revision (' + JSON.stringify(before) + ' → ' + JSON.stringify(after) + ')');
		for ( let i = 1; i < after.length; i++ )
			assert.ok(after[i] > after[i - 1], 'revisions() is strictly ascending');
		assert.equal(g._objById['seg']._etty._.Far, true, 'Far holds before the rollback');

		// roll back to the last revision that existed BEFORE authoring.
		const target = before[before.length - 1];
		assert.doesNotThrow(() => sm.rollbackTo(target), 'rollbackTo(<earlier rev>) does not throw');
		// the engine supports full reversibility here: the authored concept is gone.
		assert.ok(!g._objById['seg']._etty._.Far, 'the authored Far fact is gone after rollback');
		assert.ok(!g.getConceptByName('Far'), 'the authored Far concept is gone after rollback');
	} finally {
		g.destroy();
	}
});

// ── structural — patch()/addConcept() return promises that resolve; the add casts on the live graph ────
test('C5 structural: addConcept()/patch() return promises that resolve on the live graph', async () => {
	const g = await bootGraph('c5-struct');
	try {
		const sm = createSelfMod({ graph: g });

		// add a live concept: 400 < 500 → Near casts on seg.
		const addP = sm.addConcept(null, { _id: 'Near', _name: 'Near', require: 'Distance', assert: ['$Distance.inKm < 500'] });
		assert.equal(typeof addP.then, 'function', 'addConcept returns a promise');
		await addP;
		assert.equal(g._objById['seg']._etty._.Near, true, 'the added concept cast on the live graph');

		// patch it: 400 < 300 is false → Near uncasts.
		const patchP = sm.patch('Near', { assert: ['$Distance.inKm < 300'] });
		assert.equal(typeof patchP.then, 'function', 'patch returns a promise');
		await patchP;
		assert.ok(!g._objById['seg']._etty._.Near, 'the patched (tightened) concept uncast on the live graph');
	} finally {
		g.destroy();
	}
});

// ── facade + relearn — the live wiring is reachable and relearn is exposed ─────────────────────────────
test('C5 facade + relearn: Graph.factories.createSelfMod is the live wiring; relearn is exposed', async () => {
	assert.equal(typeof Graph.factories.createSelfMod, 'function', 'the facade exposes createSelfMod');
	assert.equal(Graph.factories.createSelfMod, require('../../lib/factories/self-mod.js').createSelfMod,
		'the facade createSelfMod is the same function as the module export');

	const g = await bootGraph('c5-facade');
	try {
		const sm = createSelfMod({ graph: g });
		assert.equal(typeof sm.supervise, 'function', 'the reactive supervisor is exposed');
		assert.equal(typeof sm.rollbackTo, 'function', 'the reversibility verb is exposed');
		assert.equal(typeof sm.relearn, 'object', 'the relearn namespace is exposed');
		assert.equal(typeof sm.relearn.tree, 'function', 'relearn.tree is the autonomous un-learn tree');
		assert.equal(typeof sm.relearn.providers, 'function', 'relearn.providers wires the relearn providers');
	} finally {
		g.destroy();
	}
});
