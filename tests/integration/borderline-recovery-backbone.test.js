'use strict';
/**
 * borderline-recovery-backbone (cont.⁶) — the TRACKED, GPU-FREE fence for the RECOVERABILITY thesis that the gitignored
 * live arm exhibits on a real model. The thesis (Laurie confront, cont.⁵): soundness rests on RECOVERABILITY, NOT on
 * oracle reliability — "8/8 does NOT certify an oracle" (Rule-of-Three: 95% upper bound on the failure rate ≈ 37% after 8
 * clean samples). A strong model lowers the RATE of a bad admit; RETRACTION bounds the DAMAGE. The model is a VARIABLE.
 *
 * The pure-function DE-LOCK (a wrong admit confluence-LOCKS the correction; retraction UN-locks it) is already certified in
 * tests/unit/registry.test.js ("DE-LOCK (the killer)"). This backbone adds what a pure test cannot, and what the existing
 * intake-borderline-loop.test.js (a CORRECT stub oracle) cannot: the damage→recover chain driven by an adversarial
 * FIXED-WRONG oracle THROUGH THE REAL ENGINE — the positive-failure control that instantiates the thesis directly
 * (n_wrong_admit ≈ 100%, recovery STILL succeeds). Plus the property-based confluence invariant + surgical/immutable controls.
 *
 * NON-vacuity: a stub that is always "right" (the existing circuit test) can NEVER exhibit a wrong admit, so it cannot test
 * the recovery path at all. The fixed-wrong stub here is the smallest oracle that forces the recovery path every run,
 * deterministically — so the invariant is certified regardless of any real model's (unknowable, non-certifiable) accuracy.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { createIntake, makeBorderlineSnap } = require('../../lib/providers');
const { deriveRegistry, freezeRegistry, resolveFactsSchema, registryLoopTree, makeRegistryLoopProviders,
	retractRingAlias, mergeRingProposals, specForKey } = require('../../lib/authoring/registry');
const { compileEnumMap, canonValue, normToken } = require('../../lib/providers/canonicalize');
console.log = console.info = console.warn = () => {};

// severity = {low, high}, no ring yet. GOLD (a pre-committed HUMAN label, never the model's own re-canon): catastrophic = high.
function startReg() {
	const t = { childConcepts: { Sev: { _id: 'Sev', _name: 'Sev', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { severity: { enum: ['low', 'high'] } }, prose: 's' } } } };
	return freezeRegistry(deriveRegistry(t), 'v1');
}
function conceptTree() {
	const tree = { childConcepts: {
		Intake: { _id: 'Intake', _name: 'Intake', require: ['Segment'], provider: ['Intake::type'],
			prompt: { user: '${rawText}', facts: { severity: { ref: 'severity' } }, prose: 'note' },
			intake: { required: ['severity'] } },
	} };
	Object.assign(tree.childConcepts, registryLoopTree().childConcepts);
	return tree;
}
// boot one run over a shared regBox (the living catalog persists across graphs); `border.calls` counts model consultations.
function run( regBox, intakeReply, borderReply, border ) {
	const resolveFacts = ( fs ) => resolveFactsSchema(fs, regBox.registry).facts;
	const borderlineSnap = makeBorderlineSnap({ ask: async () => { border.calls++; return borderReply; } });
	const intake = createIntake({ ask: async () => JSON.stringify(intakeReply), resolveFacts, borderlineSnap });
	Graph._providers = Object.assign({}, intake, makeRegistryLoopProviders({ regBox }));
	const seed = { lastRev: 0, nodes: [{ _id: 'start' }, { _id: 'goal' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', rawText: 'in' }] };
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('recovery-backbone timed out')), 20000);
		let done = false;
		const g = new Graph(seed, { label: 'brb', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); } }, { common: conceptTree() });
	});
}
const factsOf = ( g ) => g._objById['root']._etty._;
const GOLD = 'high';   // the human gold label for 'catastrophic'; the fixed-wrong oracle will answer 'low'.

test('ENGINE fixed-wrong oracle — wrong admit lands, DAMAGE is deterministic & bounded, retraction RECOVERS (positive-failure control)', async () => {
	const regBox = { registry: startReg() };
	const border = { calls: 0 };

	// ── RUN 1: the oracle is WRONG ('low' ≠ gold 'high'). It admits, but the guess is UN-CACHEABLE on its own run. ──
	const g1 = await run(regBox, { severity: 'catastrophic', prose: 'p1' }, 'low', border);
	const f1 = factsOf(g1);
	assert.equal(border.calls, 1, 'the model fired once for the out-of-vocab required miss');
	assert.notEqual('low', GOLD, 'sanity: the admitted member genuinely disagrees with the human gold label');
	assert.deepEqual(f1.IntakeBorderline, [{ key: 'severity', member: 'low' }], 'the WRONG provisional member rides the audit fact');
	assert.equal(f1.IntakeStatus, 'untyped', 'the required key still MISSED → untyped (a wrong guess is not typed truth)');
	assert.equal(f1.IntakeFactsDigest, undefined, 'un-cacheable on its own run — the wrong guess mints NO reusable digest');
	assert.deepEqual(regBox.registry.keys.severity.synonyms.low, ['catastrophic'], 'the reactive loop admitted the WRONG alias (oracle-driven ring growth)');
	assert.equal(regBox.registry.ringProvenance['severity::catastrophic'].via, 'llm-borderline', 'the wrong admit is AUDITED (the retraction handle)');

	// ── RUN 2 (fresh graph, same grown WRONG registry): the DAMAGE — a deterministic, confidently-wrong typed snap at 0 calls. ──
	border.calls = 0;
	const g2 = await run(regBox, { severity: 'catastrophic', prose: 'p2' }, 'low', border);
	const f2 = factsOf(g2);
	assert.equal(f2.severity, 'low', 'DAMAGE: the barrier now confidently MIS-types catastrophic → low (the wrong member)');
	assert.equal(f2.IntakeStatus, 'typed', 'and it is a CLEAN deterministic snap — a confidently-wrong CACHED typing');
	assert.ok(f2.IntakeFactsDigest, 'the wrong typing is now cacheable — exactly why an un-audited/un-retractable admit would be dangerous');
	assert.equal(border.calls, 0, 'the model is never re-consulted for the grown ring (the damage is silent + free)');

	// ── RECOVERY: retractRingAlias → the ring un-grows, the surface misses again, and the CORRECT alias is DE-LOCKED. ──
	const rr = retractRingAlias(regBox.registry, 'severity', 'catastrophic');
	regBox.registry = rr.registry;
	assert.equal(rr.retracted, true);
	assert.equal(rr.member, 'low', 'retraction targeted the wrong member the alias had mapped to');
	assert.equal(canonValue('catastrophic', specForKey(rr.registry, 'severity')).miss, true, 'post-retract the surface MISSES again (no stale wrong typing survives)');
	const fixed = mergeRingProposals(rr.registry, [{ key: 'severity', alias: 'catastrophic', member: 'high', via: 'curator' }]);
	assert.equal(fixed.admitted.length, 1, 'the CORRECT catastrophic→high is now ADMISSIBLE (de-lock) — it was confluence-locked before retraction');

	// ── RUN 3 over the retracted (pre-correction) registry: the surface is re-consulted (recovery is REAL, not cosmetic). ──
	border.calls = 0;
	const g3 = await run(regBox, { severity: 'catastrophic', prose: 'p3' }, 'low', border);
	assert.equal(border.calls, 1, 'the ring un-grew → borderline re-consulted (the version bump invalidated the wrong replay path)');
	assert.equal(factsOf(g3).IntakeStatus, 'untyped', 'un-cacheable again — no stale typed fact survived the retraction');
});

test('property-based CONFLUENCE — random admit/retract sequences NEVER break the single-valued ring invariant', () => {
	// deterministic PRNG (reproducible; no Math.random → the fuzz is the SAME every run) — mulberry32.
	let s = 0x1a2b3c4d;
	const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
	const pick = ( xs ) => xs[Math.floor(rnd() * xs.length)];
	const members = ['low', 'med', 'high'], aliases = ['a', 'b', 'c', 'd', 'e'];
	const tree = { childConcepts: { S: { _id: 'S', _name: 'S', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { sev: { enum: members } }, prose: 'p' } } } };
	let reg = freezeRegistry(deriveRegistry(tree), 'v1');
	let admits = 0, rejects = 0, retracts = 0;

	for ( let i = 0; i < 400; i++ ) {
		if ( rnd() < 0.6 ) {
			const r = mergeRingProposals(reg, [{ key: 'sev', alias: pick(aliases), member: pick(members), via: 'rnd' }]);
			reg = r.registry; admits += r.admitted.length; rejects += r.rejected.length;
		} else {
			const r = retractRingAlias(reg, 'sev', pick(aliases)); reg = r.registry; if ( r.retracted ) retracts++;
		}
		// INVARIANT: the ring is ALWAYS confluent — compileEnumMap (the single-valued critical-pair check) never throws.
		assert.doesNotThrow(() => compileEnumMap(specForKey(reg, 'sev') || { enum: members }), 'confluence broke at step ' + i);
		// structural belt-and-suspenders: no normalized alias maps to two members.
		const syn = reg.keys.sev.synonyms || {}, seen = new Map();
		for ( const m of Object.keys(syn) ) for ( const a of syn[m] ) {
			const na = normToken(a);
			assert.ok(!seen.has(na) || seen.get(na) === m, 'alias "' + a + '" maps to two members at step ' + i);
			seen.set(na, m);
		}
	}
	assert.ok(admits > 0 && rejects > 0 && retracts > 0, 'the fuzz actually EXERCISED admits, confluence-rejections, and retracts (not vacuous): ' + JSON.stringify({ admits, rejects, retracts }));
	// vacuity guard: compileEnumMap is a REAL detector — a hand-built non-confluent ring DOES throw.
	assert.throws(() => compileEnumMap({ enum: ['low', 'high'], synonyms: { low: ['x'], high: ['x'] } }), /./, 'the invariant is non-trivial: a same-alias-two-members ring throws');
});

test('surgical-retract + registry-immutable-on-reject — retraction is a scalpel; a rejected proposal mutates NOTHING', () => {
	const tree = { childConcepts: { S: { _id: 'S', _name: 'S', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { sev: { enum: ['low', 'high'] } }, prose: 'p' } } } };
	let reg = freezeRegistry(deriveRegistry(tree), 'v1');
	reg = mergeRingProposals(reg, [{ key: 'sev', alias: 'aa', member: 'low' }, { key: 'sev', alias: 'bb', member: 'high' }]).registry;

	const r = retractRingAlias(reg, 'sev', 'aa');                    // surgical: remove aa only
	assert.equal(r.retracted, true);
	assert.equal(r.registry.keys.sev.synonyms.low, undefined, 'aa removed → its (now empty) member ring is dropped');
	assert.deepEqual(r.registry.keys.sev.synonyms.high, ['bb'], 'bb (a DIFFERENT alias) is untouched — a scalpel, not a nuke');

	const before = JSON.parse(JSON.stringify(r.registry.keys));      // immutable-on-reject
	const rej = mergeRingProposals(r.registry, [{ key: 'sev', alias: 'cc', member: 'nonesuch' }]);
	assert.equal(rej.admitted.length, 0);
	assert.match(rej.rejected[0].reason, /not in the enum/);
	assert.deepEqual(rej.registry.keys, before, 'a rejected proposal mutated the registry keys NOT AT ALL (deep-equal, no partial write)');
});
