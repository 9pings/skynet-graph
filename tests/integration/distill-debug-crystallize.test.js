'use strict';
/**
 * Distillation kill-gate (B-thin) — the crystallization BACKBONE (the deterministic regression fence).
 * The first real-shape `LLM-provider → methodTrace → crystallizeStructural` path the codebase wires: a
 * structural debugging decomposition (Bug → Hypothesis → Localize → Fix) whose content is a function of
 * the typed bugClass crystallizes into a re-mountable defeasible `Method` that replays on a fresh
 * same-class bug at 0 model calls. Deterministic (injected ask) — this MUST pass before any live run.
 * Mirrors the proven pattern in `crystallize-miner.test.js` (Gap A).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { crystallizeStructural, adopt } = require('../../plugins/learning/lib/crystallize.js');
const { makeDebugProvider } = require('../../plugins/learning/lib/debug-provider.js');
console.log = console.info = console.warn = () => {};

const FIX = { 'off-by-one': 'adjust-bound', 'null-deref': 'guard-null' };

// a DETERMINISTIC debug provider: the bugClass rides the seed segment's `kind`, echoed into the JSON via
// the user prompt (so no real model is needed); fixKind is a function of bugClass (signature-determined).
function detProvider() {
	const calls = [];
	const ask = async ( p ) => { const m = /KIND=(\S+)/.exec(p.user); return JSON.stringify({ bugClass: m[1], hypothesis: 'h-' + m[1], fix: 'f-' + m[1] }); };
	const classify = ( raw ) => ({ bugClass: raw.bugClass, fixKind: FIX[raw.bugClass] || 'unknown' });
	const base = makeDebugProvider({ ask, parseJSON: JSON.parse, classify });
	const AI = { debugStep( g, c, s, a, cb ) { calls.push(s._._id); s._.failingTest = 'KIND=' + s._.kind; return base.AI.debugStep(g, c, s, a, cb); } };
	return { AI, calls };
}

const TREE = { childConcepts: {
	DebugStep: { _id: 'DebugStep', _name: 'DebugStep', require: ['Segment', 'kind'], ensure: ['!$Decomposed'], provider: ['AI::debugStep'] },
} };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind ) => ({ _id: id, originNode: o, targetNode: t, kind });

test('B-thin backbone: a recurrent debug decomposition crystallizes + re-mounts on a fresh same-class bug at 0 calls', async () => {
	const { AI, calls } = detProvider();
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B'), node('C'), node('D')],
		segments: [ seg('E1', 'S', 'G', 'off-by-one'), seg('E2', 'A', 'B', 'off-by-one'), seg('E3', 'C', 'D', 'null-deref') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { AI }, equivKeys: ['Decomposed'], idFor: () => 'CrystalDebug' });
	assert.equal(res.admitted, true, 'an admissible structural Method is crystallized from the LLM-shaped trace');
	assert.ok(res.candidate.schema.contract, 'the Method is born with a defeasible contract');
	const learnt = calls.length;
	assert.ok(learnt >= 2, 'cold learning spent real provider calls');

	// adopt into a FRESH empty grammar; a new same-class bug E4 (off-by-one) must re-mount at 0 NEW calls.
	Graph._providers = {};
	const g2 = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'off-by-one') ] },
		{ label: 'kg', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts: {} } });
	await adopt(g2, res.candidate);
	await nextStable(g2);
	assert.equal(calls.length, learnt, '0 NEW provider calls — the crystal re-mounts a learned decomposition');
	assert.ok(g2._objById['E4_h'], 'the hypothesis node is re-mounted on the fresh bug');
	assert.equal(g2._objById['E4_a0']._etty._.originNode, 'X', 'frontier rebound to the new origin');
	assert.equal(g2._objById['E4_a2']._etty._.targetNode, 'Y', 'frontier rebound to the new target');
	assert.equal(g2._objById['E4']._etty._.CrystalDebug, true, 'crystal cast marker set (no re-fire / divergence)');
});

test('B-thin NEG — an UNSEEN bugClass bypasses (no false replay, no divergence)', async () => {
	const { AI } = detProvider();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'off-by-one'), seg('E2', 'A', 'B', 'off-by-one') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { AI }, equivKeys: ['Decomposed'], idFor: () => 'CrystalDebug' });
	assert.equal(res.admitted, true);
	Graph._providers = {};
	const g2 = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'resource-leak') ] },
		{ label: 'kg2', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts: {} } });
	await adopt(g2, res.candidate);
	await nextStable(g2);
	assert.ok(!g2._objById['E4_h'], 'no decomposition re-mounted for the unseen bugClass (no false replay)');
	assert.equal(g2._objById['E4']._etty._.CrystalDebug, true, 'cast as a NO-OP marker (no divergence)');
	assert.ok(g2.getRevisions().length < 50, 'bounded (no apply-cap runaway)');
});

test('B-thin NEG — same bugClass, content NOT determined by it → refused (K1 ceiling)', async () => {
	// a wobble provider: fixKind depends on a hidden counter, not bugClass → not signature-determined.
	let tick = 0;
	const AI = { debugStep( g, c, s, a, cb ) {
		const base = s._._id, o = s._.originNode, t = s._.targetNode, h = base + '_h';
		cb(null, [
			{ $_id: '_parent', DebugStep: true, Decomposed: true, bugClass: 'off-by-one', fixKind: 'wob-' + (tick++) },
			{ _id: h, Node: true, role: 'hypothesis' },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: h, parentSeg: base },
			{ _id: base + '_a2', Segment: true, originNode: h, targetNode: t, parentSeg: base },
		]);
	} };
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'off-by-one'), seg('E2', 'A', 'B', 'off-by-one') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { AI }, equivKeys: ['Decomposed'], idFor: () => 'CrystalDebug' });
	assert.equal(res.admitted, false, 'content not a function of the typed signature → K1 refuses');
});

test('B-thin: a VARYING prose key blocks crystallization UNLESS declared via proseKeys (the canon-barrier split)', async () => {
	// the typed content (bugClass/fixKind) is deterministic per class, but debugProse VARIES per call (like a
	// real model's free text). Baked into the cast it reads as a content-var → not signature-determined → refused.
	// Declaring it as a prose key strips it from the mined surface (mirroring llm.js's tracked/prose digest split)
	// → the recurrent STRUCTURE crystallizes while the prose stays per-instance. (The live-run finding, made deterministic.)
	let tick = 0;
	const makeAI = () => ({ debugStep( g, c, s, a, cb ) {
		const base = s._._id, o = s._.originNode, t = s._.targetNode, h = base + '_h', l = base + '_l';
		cb(null, [
			{ $_id: '_parent', DebugStep: true, Decomposed: true, bugClass: s._.kind, fixKind: 'adjust-bound', debugProse: 'reasoning-' + (tick++) },
			{ _id: h, Node: true, role: 'hypothesis', fixKind: 'adjust-bound' },
			{ _id: l, Node: true, role: 'localize' },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: h, parentSeg: base },
			{ _id: base + '_a1', Segment: true, originNode: h, targetNode: l, parentSeg: base },
			{ _id: base + '_a2', Segment: true, originNode: l, targetNode: t, parentSeg: base },
		]);
	} });
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'off-by-one'), seg('E2', 'A', 'B', 'off-by-one') ] };
	tick = 0;
	const without = await crystallizeStructural({ episodeTree: TREE, seed, providers: { AI: makeAI() }, equivKeys: ['Decomposed'], idFor: () => 'CrystalDebug' });
	assert.equal(without.admitted, false, 'varying prose baked into the cast blocks signature-determination (the K1 refusal)');
	tick = 0;
	const withp = await crystallizeStructural({ episodeTree: TREE, seed, providers: { AI: makeAI() }, equivKeys: ['Decomposed'], idFor: () => 'CrystalDebug', proseKeys: ['debugProse'] });
	assert.equal(withp.admitted, true, 'declaring the prose key lets the recurrent structure crystallize (prose stays per-instance)');
});
