'use strict';
/**
 * G-1 — the CLOSED borderline→registry CIRCUIT, end-to-end through the real engine (the connective ingest that was the
 * only missing piece: the pieces existed but nothing fed intake's barrier MISSES into the autonomous convergence loop).
 *
 * The two-run control (Laurie confront — a ONE-run test is VACUOUS: the single borderline call is already sound, so a
 * one-run test passes even for a system that poisons canon on run 2). Here:
 *   • RUN 1 — an out-of-vocab paraphrase MISSES the barrier → the borderline gate yields a PROVISIONAL member (on the
 *     untracked `<name>Borderline` audit fact) + a propose-only proposal that is DEPOSITED on a fresh proxy node →
 *     the reactive `RegistryMerge` loop admits it into the MUTABLE registry (the ring grows). CRUCIALLY the provisional
 *     value does NOT mint a digest / does NOT flip status to typed (un-cacheable — the guess never becomes cached truth
 *     on the run that produced it).
 *   • RUN 2 — a FRESH graph over the SAME (now grown) registry: the paraphrase snaps DETERMINISTICALLY at the barrier
 *     (via the `resolveFacts` seam sourcing the living catalog) → typed + digest minted + ZERO model calls. The living
 *     catalog fed the front door.
 *   • RUN 3 — `retractRingAlias` reverts the barrier (recoverability: the model-independent floor — a strong oracle only
 *     lowers the RATE of a wrong admit; retraction bounds the DAMAGE). After retract the surface misses again.
 * Hermetic: both "models" are injected constants (no network).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { createIntake, makeBorderlineSnap } = require('../../lib/providers');
const { deriveRegistry, freezeRegistry, resolveFactsSchema, registryLoopTree, makeRegistryLoopProviders, retractRingAlias } = require('../../lib/authoring/registry');
console.log = console.info = console.warn = () => {};

// severity = {low, high}, NO ring yet — the exogenous vocabulary the circuit will grow from intake misses.
function startReg() {
	const t = { childConcepts: { Sev: { _id: 'Sev', _name: 'Sev', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { severity: { enum: ['low', 'high'] } }, prose: 's' } } } };
	return freezeRegistry(deriveRegistry(t), 'v1');
}

// the concept tree: Intake (fires on the root segment) + the autonomous RegistryMerge loop.
function conceptTree() {
	const tree = { childConcepts: {
		Intake: { _id: 'Intake', _name: 'Intake', require: ['Segment'], provider: ['Intake::type'],
			prompt: { user: '${rawText}', facts: { severity: { ref: 'severity' } }, prose: 'note' },
			intake: { required: ['severity'] } },
	} };
	Object.assign(tree.childConcepts, registryLoopTree().childConcepts);   // + RegistryMerge { require:['proposalMember'] }
	return tree;
}

// boot one run over a shared regBox (the living catalog persists across graphs). `border` counts borderline model calls.
function run( regBox, intakeReply, borderReply, border ) {
	const resolveFacts = ( fs ) => resolveFactsSchema(fs, regBox.registry).facts;      // sources the LIVING registry
	const borderlineSnap = makeBorderlineSnap({ ask: async () => { border.calls++; return borderReply; } });
	const intake = createIntake({ ask: async () => JSON.stringify(intakeReply), resolveFacts, borderlineSnap });
	Graph._providers = Object.assign({}, intake, makeRegistryLoopProviders({ regBox }));
	const seed = { lastRev: 0, nodes: [{ _id: 'start' }, { _id: 'goal' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', rawText: 'in' }] };
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('intake-borderline-loop timed out')), 20000);
		let done = false;
		const g = new Graph(seed, { label: 'ibl', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); } }, { common: conceptTree() });
	});
}
const factsOf = ( g ) => g._objById['root']._etty._;

test('the CLOSED circuit — run-1 provisional (un-cacheable) + autonomous admit; run-2 converges typed at the barrier, 0 calls', async () => {
	const regBox = { registry: startReg() };
	const border = { calls: 0 };

	// ── RUN 1: 'catastrophic' is out-of-vocab → barrier MISS → borderline provisional 'high' + proposal deposited ──
	const g1 = await run(regBox, { severity: 'catastrophic', prose: 'p1' }, 'high', border);
	const f1 = factsOf(g1);
	assert.equal(border.calls, 1, 'the borderline model fired once — only for the out-of-vocab required miss');
	// the provisional value is available for dispatch on the AUDIT fact...
	assert.deepEqual(f1.IntakeBorderline, [{ key: 'severity', member: 'high' }], 'provisional member on the untracked audit fact');
	// ...but it is UN-CACHEABLE: the required key still MISSED → status is not typed, NO reusable digest was minted.
	assert.equal(f1.IntakeStatus, 'untyped', 'a required-key miss stays untyped even with a provisional (the guess is not typed truth)');
	assert.equal(f1.IntakeFactsDigest, undefined, 'NO digest on run 1 — the provisional never mints a cached typed fact (poison-containment)');
	// the CIRCUIT closed: the proposal auto-deposited and the reactive loop admitted it into the living registry.
	assert.deepEqual(regBox.registry.keys.severity.synonyms.high, ['catastrophic'], 'the loop grew the ring autonomously (circuit closed)');
	assert.equal(regBox.registry.ringProvenance['severity::catastrophic'].via, 'llm-borderline', 'admitted alias carries its oracle provenance');

	// ── RUN 2: fresh graph, SAME grown registry → the paraphrase snaps DETERMINISTICALLY at the barrier ──
	border.calls = 0;
	const g2 = await run(regBox, { severity: 'catastrophic', prose: 'p2' }, 'high', border);
	const f2 = factsOf(g2);
	assert.equal(f2.severity, 'high', 'the grown ring snapped the paraphrase at the barrier (the living catalog fed the front door)');
	assert.equal(f2.IntakeStatus, 'typed', 'now typed — a clean deterministic snap');
	assert.ok(f2.IntakeFactsDigest, 'and mints a reusable digest (K1 — cacheable now that it is genuine canon)');
	assert.equal(border.calls, 0, 'ZERO model calls on run 2 — convergence: the deterministic barrier handles it (LAST-resort honored)');

	// ── RUN 3: retract the alias → the barrier REVERTS (recoverability — the model-independent floor) ──
	const rr = retractRingAlias(regBox.registry, 'severity', 'catastrophic');
	regBox.registry = rr.registry;
	assert.equal(rr.retracted, true);
	assert.equal(resolveFactsSchema({ s: { ref: 'severity' } }, regBox.registry).facts.s.synonyms, undefined, 'the barrier spec no longer maps the retracted alias');
	border.calls = 0;
	const g3 = await run(regBox, { severity: 'catastrophic', prose: 'p3' }, 'high', border);
	assert.equal(border.calls, 1, 'after retraction the surface misses again → borderline re-consulted (the ring un-grew)');
	assert.equal(factsOf(g3).IntakeStatus, 'untyped', 'and it is un-cacheable again (no stale cached typing survives retraction)');
});

test('NEG (vacuousness guard) — with NO borderlineSnap wired, a miss stays a plain CanonMiss (no deposit, no ring growth)', async () => {
	const regBox = { registry: startReg() };
	const resolveFacts = ( fs ) => resolveFactsSchema(fs, regBox.registry).facts;
	const intake = createIntake({ ask: async () => JSON.stringify({ severity: 'catastrophic', prose: 'p' }), resolveFacts });   // no borderlineSnap
	Graph._providers = Object.assign({}, intake, makeRegistryLoopProviders({ regBox }));
	const seed = { lastRev: 0, nodes: [{ _id: 'start' }, { _id: 'goal' }], segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', rawText: 'in' }] };
	const g = await new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('timeout')), 20000); let done = false;
		const gg = new Graph(seed, { label: 'ibl-neg', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(gg); } }, { common: conceptTree() });
	});
	const f = factsOf(g);
	assert.deepEqual(f.IntakeCanonMiss, ['severity'], 'the miss is a plain fail-closed CanonMiss (front door unchanged when no gate is wired)');
	assert.equal(f.IntakeBorderline, undefined, 'no provisional value');
	assert.equal(regBox.registry.keys.severity.synonyms, undefined, 'no proposal deposited → the ring did not grow (the deposit is gated on the wired gate, not automatic)');
});
