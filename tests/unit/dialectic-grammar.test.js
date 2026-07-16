'use strict';
/**
 * C9 as GRAMMAR — the dialectic / critical-mind ledger-core expressed as a concept set
 * (`plugins/critical-mind/concepts/dialectic/`) on the native engine emergence, replacing the imperative
 * pipeline of `plugins/critical-mind/factory.js`. Design: `WIP/2026-07-16-design-combos-as-grammar.md` §3.
 *
 * TRANCHE 1 = the ledger core: Statement (life-in-pool) → Viewpoint → Explore (witness leaf) →
 * Established (the witness gate) → Pro/ConEntry (append-only tally) → Frame/Verdict (the margin gate).
 * The reconcile() JS loop of critique.js becomes native cascade retraction (proven in the 0-ask
 * structural tests below).
 *
 * TRANCHE 2 adds the full pipeline as grammar: Brainstorm/PoolReady/Split (pool admission),
 * Uncertain/Generate (G3 placement + the SINGLE generative pass as a null-guard), NormProbe/
 * SettledNorm, Contested (dialectic, annotation-only). Structural claims proven 0-model here:
 * the verdict is LIVE (a retraction re-decides it natively, both directions) and the generative
 * null-guard holds under retraction (never a re-generation without an explicit host re-arm).
 * The LLM-path parity vs the imperative reference = tests/unit/critique-grammar-parity.test.js.
 *
 * These are the AUTHOR-TIME tests (no Graph instantiated) — the cheapest gate, mirroring
 * `substrate-grammar.test.js`: the set builds its IS-A spine and validates barrier-clean.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');
const { validateConceptTree } = require('../../lib/authoring/core/validate');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');

const DIALECTIC = path.join(__dirname, '..', '..', 'plugins', 'critical-mind', 'concepts', 'dialectic');
const tree = () => buildConceptTree(DIALECTIC);

// ── runtime boot (0-model, structural): the dialectic set + the pure tally providers ──
async function settle(g) {
	for (let i = 0; i < 60; i++) {
		await nextStable(g);
		if (!g._unstable.length && !g._triggeredCastCount) {
			await new Promise((r) => setImmediate(r));
			if (!g._unstable.length && !g._triggeredCastCount) return;
		}
	}
	throw new Error('dialectic graph did not settle');
}
const cast = (g, id, k) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = (g, id, k) => g._objById[id] && g._objById[id]._etty._[k];

async function boot(seed) {
	const { Ledger } = require('../../plugins/reason-kernel/providers.js');   // the ledger primitive (tally/untally) — now a kernel dep
	Graph._providers = { Ledger };
	const g = new Graph(
		{ lastRev: 0, freeNodes: seed.freeNodes || [], nodes: seed.nodes || [], segments: [] },
		{ label: 'dialectic-test', isMaster: true, autoMount: true, conceptSets: ['dialectic'], bagRefManagers: {}, logLevel: 'error' },
		{ dialectic: buildConceptTree(DIALECTIC) }
	);
	await settle(g);
	return g;
}

test('builds the dialectic IS-A spine (ledger core = directory tree)', () => {
	const top = tree().childConcepts;
	assert.ok(top.Statement && top.Viewpoint && top.Frame, 'three roots: Statement, Viewpoint, Frame');
	const vp = top.Viewpoint.childConcepts;
	assert.ok(vp.Explore && vp.Established, 'Explore + Established under Viewpoint');
	assert.ok(vp.Explore.childConcepts.Retry, 'Retry nested under Explore');
	assert.ok(vp.Established.childConcepts.ProEntry && vp.Established.childConcepts.ConEntry, 'Pro/ConEntry under Established');
	const verdict = top.Frame.childConcepts.Verdict.childConcepts;
	assert.ok(verdict.Pro && verdict.Con, 'Verdict Pro/Con nested under Frame');
	assert.ok(verdict.SettledNorm, 'SettledNorm (the advisory upgrade gate) under Verdict');
	const fr = top.Frame.childConcepts;
	assert.ok(fr.Brainstorm && fr.PoolReady && fr.Split, 'pool admission chain under Frame');
	assert.ok(fr.Uncertain && fr.Uncertain.childConcepts.Generate, 'G3 placement + the null-guarded generative pass');
	assert.ok(fr.NormProbe, 'the contestedness probe under Frame');
	assert.ok(vp.Established.childConcepts.Contested, 'Contested (dialectic, annotation-only) under Established');
	// buildConceptTree derives _name from the filename (engine invariant: key == _id)
	assert.equal(top.Statement._name, 'Statement');
	assert.equal(vp.Established.childConcepts.ProEntry._name, 'ProEntry');
});

test('VALIDATES CLEAN (0 errors) — authorable + canonicalization-barrier-safe (K1)', () => {
	const { errors, warnings } = validateConceptTree(tree());
	assert.equal(errors.length, 0, 'no errors: ' + JSON.stringify(errors));
	assert.equal(warnings.filter((w) => w.kind === 'unstratified-cycle').length, 0, 'acyclic/stratified spine');
	// every gate keys on a snapped enum / an id / a `.length`, never a raw float or prose on an edge
	const cont = validateConceptTree(tree(), { flagContinuousGates: true });
	assert.equal(cont.warnings.filter((w) => w.kind === 'continuous-gate').length, 0, 'no raw-float gate (K1-safe)');
});

test('a live same-side witness tallies the viewpoint into ledger.pro (0 model calls)', async () => {
	const g = await boot({
		freeNodes: [{ _id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [] }],
		nodes: [
			{ _id: 'frame', isFrame: true, topic: 'is X good?', threshold: 1 },
			{ _id: 'p1', isStatement: true, side: 'PRO', text: 'because A', inPool: true },
			{ _id: 'V1', isViewpoint: true, side: 'PRO', text: 'X helps A', frame: 'frame', Explore: true, w0: 'p1' },
		],
	});
	assert.equal(cast(g, 'V1', 'Established'), true, 'Established casts on a live same-side witness');
	assert.equal(cast(g, 'V1', 'ProEntry'), true, 'ProEntry casts');
	assert.deepEqual(fact(g, 'ledger', 'pro'), ['V1'], 'V1 tallied into ledger.pro');
});

test('retracting a witness natively uncasts the entry + appends to proRetracted (0 model calls) — reconcile() as engine behaviour', async () => {
	const g = await boot({
		freeNodes: [{ _id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [] }],
		nodes: [
			{ _id: 'frame', isFrame: true, topic: 'is X good?', threshold: 1 },
			{ _id: 'p1', isStatement: true, side: 'PRO', text: 'because A', inPool: true },
			{ _id: 'V1', isViewpoint: true, side: 'PRO', text: 'X helps A', frame: 'frame', Explore: true, w0: 'p1' },
		],
	});
	assert.deepEqual(fact(g, 'ledger', 'pro'), ['V1'], 'precondition: tallied');
	assert.equal(cast(g, 'V1', 'ProEntry'), true, 'precondition: ProEntry cast');
	// the witness leaves the pool (a late erratum) — the whole point of the JTMS
	await new Promise((res) => g.ingest({ p1: { inPool: false } }, res));
	await settle(g);
	assert.equal(cast(g, 'p1', 'Statement'), false, 'Statement uncasts when it leaves the pool');
	assert.equal(cast(g, 'V1', 'Established'), false, 'Established uncasts in cascade (witness gone)');
	assert.equal(cast(g, 'V1', 'ProEntry'), false, 'ProEntry uncasts');
	assert.deepEqual(fact(g, 'ledger', 'proRetracted'), ['V1'], 'retraction APPENDED (no __pull)');
	const active = fact(g, 'ledger', 'pro').length - fact(g, 'ledger', 'proRetracted').length;
	assert.equal(active, 0, 'active PRO count fell to 0 — native reconcile, no reconcile() loop');
});

test('the VERDICT is live: a retraction that drops the margin uncasts it natively — both directions (0 model calls)', async () => {
	const g = await boot({
		freeNodes: [{ _id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [], declared: ['V1', 'V2'], explored: ['V1', 'V2'], open: [] }],
		nodes: [
			{ _id: 'frame', isFrame: true, topic: 'is X good?', threshold: 2, poolBuilt: 1, nPro: 2, nCon: 2 },
			{ _id: 'p1', isStatement: true, side: 'PRO', text: 'because A', inPool: true },
			{ _id: 'p2', isStatement: true, side: 'PRO', text: 'because B', inPool: true },
			{ _id: 'c1', isStatement: true, side: 'CON', text: 'but C', inPool: true },
			{ _id: 'c2', isStatement: true, side: 'CON', text: 'but D', inPool: true },
			{ _id: 'V1', isViewpoint: true, side: 'PRO', text: 'X helps A', frame: 'frame', Explore: true, w0: 'p1' },
			{ _id: 'V2', isViewpoint: true, side: 'PRO', text: 'X helps B', frame: 'frame', Explore: true, w0: 'p2' },
		],
	});
	assert.equal(cast(g, 'frame', 'Pro'), true, 'PRO verdict cast at margin 2 ≥ threshold 2');
	// a witness leaves the pool (late erratum) → cascade → untally → the margin falls BELOW the bound
	await new Promise((res) => g.ingest({ p1: { inPool: false } }, res));
	await settle(g);
	assert.equal(cast(g, 'V1', 'Established'), false, 'the entry cascaded out');
	assert.equal(cast(g, 'frame', 'Pro'), false, 'the VERDICT uncast on its own — re-decide on the impoverished perimeter is native');
	const active = fact(g, 'ledger', 'pro').length - fact(g, 'ledger', 'proRetracted').length;
	assert.equal(active, 1, 'one active PRO left (margin 1 < 2)');
});

test('the generative null-guard holds under retraction: genRound set → Generate NEVER re-fires (0 model calls) + vacuity control', async () => {
	const seed = ( genRound ) => ({
		freeNodes: [{ _id: 'ledger', pro: [], proRetracted: [], con: [], conRetracted: [], declared: ['V1'], explored: ['V1'], open: ['V1'] }],
		nodes: [
			Object.assign({ _id: 'frame', isFrame: true, topic: 'is X good?', threshold: 3, poolBuilt: 1, nPro: 2, nCon: 2 }, genRound ? { genRound: 1 } : {}),
			{ _id: 'p1', isStatement: true, side: 'PRO', text: 'because A', inPool: true },
			{ _id: 'p2', isStatement: true, side: 'PRO', text: 'because B', inPool: true },
			{ _id: 'c1', isStatement: true, side: 'CON', text: 'but C', inPool: true },
			{ _id: 'c2', isStatement: true, side: 'CON', text: 'but D', inPool: true },
			// V1 explored and definitively open (margin 0 < 3 ∧ open ≠ ∅ → the frame IS uncertain)
			{ _id: 'V1', isViewpoint: true, side: 'PRO', text: 'X helps A', frame: 'frame', Explore: true, witnessMiss: true, noRetrySlice: 1 },
		],
	});
	// genRound already spent (the single measured pass) → Uncertain casts but Generate stays blocked:
	// a retraction/enrichment may RE-DECIDE the verdict, it never RE-GENERATES without a host re-arm
	const g1 = await boot(seed(true));
	assert.equal(cast(g1, 'frame', 'Uncertain'), true, 'the frame is uncertain (open declared point)');
	assert.equal(cast(g1, 'frame', 'Generate'), false, 'Generate blocked by the genRound null-guard');
	// vacuity control: the SAME seed with genRound null → Generate becomes applicable (providers are
	// unwired here so it auto-flags — enough to prove the guard, not the leaf, is what blocked above)
	const g2 = await boot(seed(false));
	assert.equal(cast(g2, 'frame', 'Generate'), true, 'control: without the guard the pass would fire');
});
