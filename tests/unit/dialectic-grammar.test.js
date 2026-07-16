'use strict';
/**
 * C9 as GRAMMAR — the dialectic / critical-mind ledger-core expressed as a concept set
 * (`plugins/critical-mind/concepts/dialectic/`) on the native engine emergence, replacing the imperative
 * pipeline of `plugins/critical-mind/combo.js`. Design: `WIP/2026-07-16-design-combos-as-grammar.md` §3.
 *
 * TRANCHE 1 = the ledger core: Statement (life-in-pool) → Viewpoint → Explore (witness leaf) →
 * Established (the witness gate) → Pro/ConEntry (append-only tally) → Frame/Verdict (the margin gate).
 * The reconcile() JS loop of critique.js becomes native cascade retraction (proven in the 0-ask
 * structural tests below).
 *
 * These are the AUTHOR-TIME tests (no Graph instantiated) — the cheapest gate, mirroring
 * `substrate-grammar.test.js`: the set builds its IS-A spine and validates barrier-clean.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildConceptTree } = require('../../lib/authoring/concepts');
const { validateConceptTree } = require('../../lib/authoring/validate');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');

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
	const { Dialectic } = require('../../plugins/critical-mind/providers.js');   // the pure ledger providers (tally/untally)
	Graph._providers = { Dialectic };
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
