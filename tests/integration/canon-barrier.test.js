'use strict';
/**
 * The K1-defeat proof, end-to-end through the engine.
 *
 * Two runs of the SAME problem with textually-divergent prose (the exact K1
 * scenario: "two semantically-equal LLM outputs differ textually"). We show:
 *
 *   1. the canonicalized DISCRETE fact (and its FactsDigest = the memo key) is
 *      byte-identical across the two runs — the prose differs, the spine does not;
 *   2. a downstream concept gated on the DISCRETE fact holds in BOTH runs (its
 *      conclusion is portable across re-prose);
 *   3. a downstream concept gated on the PROSE key holds in run A but RETRACTS in
 *      run B (the same conclusion fragments on a cosmetic re-wording) — and the
 *      author-time validator rejects exactly that prose-keyed gate up front.
 *
 * Hermetic: the "LLM" is an injected constant reply (no network).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
const { createLLMProvider } = require('../../providers');
const { validateConceptTree } = require('../../_lab/validate');
console.log = console.info = console.warn = () => {};

// Classify emits a discrete `bucket` (tracked) + free `summary` (untracked prose).
// GoodGate keys on the discrete fact; ProseGate keys on the prose (the K1 footgun).
const conceptTree = {
	childConcepts: {
		Classify: {
			_id: 'Classify', _name: 'Classify', require: ['Segment'], provider: ['LLM::complete'],
			prompt: { facts: { bucket: { enum: ['low', 'high'] } }, prose: 'summary' }
		},
		GoodGate:  { _id: 'GoodGate', _name: 'GoodGate', require: ['Classify'], ensure: ["$bucket=='high'"], provider: ['AI::mark'] },
		ProseGate: { _id: 'ProseGate', _name: 'ProseGate', require: ['Classify'], ensure: ['$summary == $expectedSummary'], provider: ['AI::mark'] }
	}
};

const proseA = 'In run A the model was verbose and flowery about the high risk.';
const proseB = 'Run B: terse — but concluding the very same high severity.';
const replyA = JSON.stringify({ bucket: 'HIGH', prose: proseA });          // note: "HIGH" vs vocab "high"
const replyB = 'thinking… ' + JSON.stringify({ bucket: 'high', prose: proseB });

function providersFor( reply ) {
	const llm = createLLMProvider({ ask: async () => reply });
	return {
		LLM: llm.LLM,
		AI: { mark( graph, concept, scope, argz, cb ) { const f = { $_id: '_parent' }; f[concept._name] = true; cb(null, f); } }
	};
}

function run( reply, expectedSummary ) {
	Graph._providers = providersFor(reply);
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'start' }, { _id: 'goal' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', expectedSummary }]
	};
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('canon-barrier timed out')), 20000);
		let done = false;
		const g = new Graph(seed, {
			label: 'canon', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(g); }
		}, { common: conceptTree });
	});
}

test('discrete memo key is stable across re-prose; discrete gate holds, prose gate fragments', async () => {
	// run A establishes the baseline; `expectedSummary` is pinned to A's prose.
	const A = await run(replyA, proseA);
	const eA = A._objById['root']._etty;
	const aBucket = eA._.bucket, aDigest = eA._.ClassifyFactsDigest, aSummary = eA._.summary;
	const aGood = eA._.GoodGate === true, aProse = eA._.ProseGate === true;   // self-flag = the cast indicator

	// run B answers the SAME problem with different wording (same expectedSummary pin).
	const B = await run(replyB, proseA);
	const eB = B._objById['root']._etty;

	// (1) the spine is identical; the prose is not.
	assert.equal(aBucket, 'high', 'A snapped "HIGH" -> "high"');
	assert.equal(eB._.bucket, 'high', 'B snapped "high" -> "high"');
	assert.equal(aDigest, eB._.ClassifyFactsDigest, 'identical discrete memo key across textually-divergent runs');
	assert.notEqual(aSummary, eB._.summary, 'prose differs between runs (untracked, terminal)');

	// (2) the discrete-keyed gate is portable across re-prose.
	assert.equal(aGood, true, 'GoodGate cast in run A');
	assert.equal(eB._.GoodGate, true, 'GoodGate STILL cast in run B (discrete gate survives re-prose)');

	// (3) the prose-keyed gate fragments: held in A, retracted in B.
	assert.equal(aProse, true, 'ProseGate cast in run A (prose matched the pin)');
	assert.ok(!eB._.ProseGate, 'ProseGate NOT cast in run B — the conclusion fragmented on a cosmetic re-wording');
	assert.ok(!eB._mappedConcepts.ProseGate, 'ProseGate is not in the cast set in run B');

	// (4) the validator would have caught the fragile gate BEFORE runtime.
	const { errors } = validateConceptTree(conceptTree);
	const flagged = errors.filter((e) => e.kind === 'prose-dependency').map((e) => e.concept);
	assert.deepEqual(flagged, ['ProseGate'], 'author-time validation rejects exactly the prose-keyed gate');
});
