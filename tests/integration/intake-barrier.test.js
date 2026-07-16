'use strict';
/**
 * C0 — the prose→typed front door (§3.2), end-to-end through the engine.
 *
 * The runtime realization of the published P4 boundary: in-vocab prose flows as typed facts
 * and a downstream gate (`ensure:["$IntakeStatus=='typed'"]`) holds across textual re-prose;
 * an out-of-vocabulary REQUIRED value makes the intake `untyped`, so the gate does NOT cast
 * (the boundary is visible + gated, never crossed silently) — and a premise that later falls
 * auto-retracts the gate (JTMS). The author-time validator rejects a prose-keyed gate up front.
 *
 * Hermetic: the "LLM" is an injected constant reply (no network).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { createIntake } = require('../../lib/providers');
const { validateConceptTree } = require('../../lib/authoring/core/validate');
console.log = console.info = console.warn = () => {};

// Intake snaps a discrete `severity` (tracked) + free `note` (untracked prose). TypedGate keys on
// the DISCRETE status; ProseGate keys on the prose (the K1 footgun the validator must reject).
const conceptTree = {
	childConcepts: {
		Intake: {
			_id: 'Intake', _name: 'Intake', require: ['Segment'], provider: ['Intake::type'],
			prompt: { facts: { severity: { enum: ['low', 'high'] } }, prose: 'note' },
			intake: { required: ['severity'] }
		},
		TypedGate: { _id: 'TypedGate', _name: 'TypedGate', require: ['Intake'], ensure: ["$IntakeStatus=='typed'"], provider: ['AI::mark'] },
		ProseGate: { _id: 'ProseGate', _name: 'ProseGate', require: ['Intake'], ensure: ['$note == $expectedNote'], provider: ['AI::mark'] }
	}
};

function providersFor( reply ) {
	const intake = createIntake({ ask: async () => reply });
	return {
		Intake: intake.Intake,
		AI: { mark( graph, concept, scope, argz, cb ) { const f = { $_id: '_parent' }; f[concept._name] = true; cb(null, f); } }
	};
}

function run( reply, expectedNote ) {
	Graph._providers = providersFor(reply);
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'start' }, { _id: 'goal' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', expectedNote }]
	};
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('intake-barrier timed out')), 20000);
		let done = false;
		const g = new Graph(seed, {
			label: 'intake', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); }
		}, { common: conceptTree });
	});
}

const proseA = 'Verbose and flowery about the HIGH risk in run A.';
const proseB = 'Terse run B — same high severity though.';
const replyA = JSON.stringify({ severity: 'HIGH', prose: proseA });     // "HIGH" vs vocab "high" (snaps)
const replyB = 'thinking… ' + JSON.stringify({ severity: 'high', prose: proseB });

test('in-vocab: typed gate holds across re-prose; digest stable; prose gate fragments', async () => {
	const A = await run(replyA, proseA);
	const eA = A._objById['root']._etty._;
	assert.equal(eA.severity, 'high', 'A snapped "HIGH" -> "high"');
	assert.equal(eA.IntakeStatus, 'typed', 'in-vocab required key -> typed');
	assert.equal(eA.TypedGate, true, 'the discrete gate cast in A');
	assert.equal(eA.ProseGate, true, 'prose gate cast in A (prose matched the pin)');

	const B = await run(replyB, proseA);              // same problem, re-prosed; pin still A's prose
	const eB = B._objById['root']._etty._;
	assert.equal(eB.IntakeStatus, 'typed');
	assert.equal(eB.IntakeFactsDigest, eA.IntakeFactsDigest, 'digest stable across textual divergence');
	assert.equal(eB.TypedGate, true, 'the discrete gate STILL holds in B (portable across re-prose)');
	assert.ok(!eB.ProseGate, 'the prose gate fragmented on the re-wording (the K1 footgun)');
});

test('out-of-vocab REQUIRED value → untyped: the typed gate does NOT cast (boundary gated, not crossed)', async () => {
	const C = await run(JSON.stringify({ severity: 'catastrophic', prose: 'off-grid' }), 'x');
	const ettyC = C._objById['root']._etty, eC = ettyC._;
	assert.equal(eC.IntakeStatus, 'untyped', 'a required out-of-vocab value is untyped');
	assert.equal(eC.severity, null, 'fail-closed: no wrong snap');
	assert.deepEqual(eC.IntakeCanonMiss, ['severity'], 'the miss is visible for escalation');
	assert.equal(eC.IntakeFactsDigest, undefined, 'no reusable digest minted for an untyped intake');
	assert.ok(!eC.TypedGate, 'the downstream typed-gate did NOT cast — nothing prose-derived was admitted');
	assert.ok(!ettyC._mappedConcepts.TypedGate, 'TypedGate is not in the cast set');
});

test('the validator rejects a prose-keyed gate BEFORE runtime', () => {
	const { errors } = validateConceptTree(conceptTree);
	const flagged = errors.filter(( e ) => e.kind === 'prose-dependency').map(( e ) => e.concept);
	assert.deepEqual(flagged, ['ProseGate'], 'author-time validation rejects exactly the prose-keyed gate');
});
