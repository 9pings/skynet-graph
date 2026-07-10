'use strict';
/**
 * TYPED INTAKE IN FRONT OF C6 — the prose→typed front door drives the proxy's coverage CLASS (roadmap-use-cases
 * point #3 "rendre C6 réel · la couverture typée", owner NEXT 2026-07-06). `makeLocalCoverage`'s semantic key is a
 * keyword STRING (loose, synonyms miss, no soundness gate); `makeTypedIntakeKey` snaps a prose query to a DECLARED
 * VOCABULARY via the SAME canonicalization barrier as the Intake concept, so ONE frontier answer covers a typed
 * CLASS (distillation par-classe). It plugs into the EXISTING `opts.semanticKey` seam — ZERO change to the combo.
 *
 * Deterministic (the local model is STUBBED to canned JSON per query; the frontier is STUBBED + call-counted).
 *
 * THE FINDINGS IT LOCKS (critique §3 — the mechanism, not a green vacuum):
 *   • a typed class COLLAPSES paraphrases with the same declared facts → the 2nd is served LOCAL at 0 frontier
 *     calls (amortization par-classe), and a query with DIFFERENT declared facts does NOT collapse (a finer,
 *     answer-determining key than a keyword string);
 *   • the SOUNDNESS BOUNDARY (Intake Invariant 2): an OUT-OF-VOCABULARY query mints NO reusable key (null) → the
 *     proxy degrades to exact-key → it ESCALATES, never false-collapsing onto a wrong class (0 hallucination);
 *   • the CAVEAT is real + backstopped: a COARSE schema (missing an answer dimension) collapses two different-answer
 *     queries — `coverageCheck` catches the wrong hit, invalidates + escalates (no wrong answer served). The schema
 *     granularity IS the coverage/soundness knob; coverageCheck is its backstop. (NEG control — not vacuous.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProxyCache, makeTypedIntakeKey } = require('../../lib/combos/proxy-cache.js');

// a declared domain: {subject ∈ countries} × {attribute ∈ the answerable dimensions}. The ANSWER-COMPLETE schema.
const FACTS = { subject: { enum: ['france', 'japan', 'brazil'] }, attribute: { enum: ['capital', 'population', 'currency'] } };
// the stubbed local intake: prose → canned declared-facts JSON (what a small model would extract). OOV → no snap.
const INTAKE = {
	'What is the capital of France?'      : { subject: 'France', attribute: 'capital' },
	"What's France's capital city?"       : { subject: 'france', attribute: 'Capital' },      // paraphrase → SAME facts
	'What is the population of France?'    : { subject: 'France', attribute: 'population' },   // different attribute
	'What is the capital of Japan?'        : { subject: 'Japan', attribute: 'capital' },
	'Describe the vibe of France.'         : { subject: 'France', attribute: 'ambiance' },     // attribute OUT-OF-VOCAB
};
const localAsk = async ( { user } ) => JSON.stringify(INTAKE[user] || {});

// a call-counting frontier with canned ground truth (keyed by the intended answer, not the prose).
function makeFrontier( answers ) {
	let calls = 0;
	return {
		frontierAsk: async ( q ) => { calls++; return answers[q]; },
		calls: () => calls
	};
}
const TRUTH = {
	'What is the capital of France?'   : 'Paris',
	"What's France's capital city?"    : 'Paris',
	'What is the population of France?': '68 million',
	'What is the capital of Japan?'    : 'Tokyo',
	'Describe the vibe of France.'     : 'romantic and varied',
};

test('typed-class coverage — paraphrases with the SAME declared facts collapse to one frontier call; different facts do not', async () => {
	const { semanticKey } = makeTypedIntakeKey({ localAsk, facts: FACTS });
	const f = makeFrontier(TRUTH);
	const px = createProxyCache({ frontierAsk: f.frontierAsk, semanticKey });

	const a = await px.answer('What is the capital of France?');
	assert.equal(a.answer, 'Paris'); assert.equal(a.source, 'frontier'); assert.equal(f.calls(), 1, 'first query escalates');

	// a PARAPHRASE (same {subject:france, attribute:capital}) → served LOCAL at 0 frontier calls (the typed collapse).
	const b = await px.answer("What's France's capital city?");
	assert.equal(b.answer, 'Paris', 'the paraphrase is served the distilled class answer');
	assert.equal(b.source, 'local'); assert.equal(b.cost, 0);
	assert.equal(f.calls(), 1, 'NO new frontier call — one answer covered the class');

	// a DIFFERENT attribute (population) → a DIFFERENT typed key → escalates (correct, not the capital answer).
	const c = await px.answer('What is the population of France?');
	assert.equal(c.answer, '68 million', 'a finer key than a keyword string: population does not collide with capital');
	assert.equal(c.source, 'frontier'); assert.equal(f.calls(), 2);

	// a different SUBJECT (japan) also does not collide.
	const d = await px.answer('What is the capital of Japan?');
	assert.equal(d.answer, 'Tokyo'); assert.equal(f.calls(), 3);
});

test('soundness boundary — an OUT-OF-VOCAB query mints NO reusable key (untyped) → it escalates, never a false class', async () => {
	const tk = makeTypedIntakeKey({ localAsk, facts: FACTS });

	// the à-nu projection: a clean snap is `typed` with a digest; an OOV attribute is `untyped` with a NULL key.
	const typed = await tk.project('What is the capital of France?');
	assert.equal(typed.status, 'typed'); assert.ok(typed.key, 'a faithful projection mints a reusable digest');
	const oov = await tk.project('Describe the vibe of France.');
	assert.equal(oov.status, 'untyped', 'attribute out-of-vocab → untyped');
	assert.deepEqual(oov.missing, ['attribute'], 'the refusal NAMES the decision-bearing miss');
	assert.equal(oov.key, null, 'NO reusable key — the OOV query is not K1-canonicalizable (Intake Invariant 2)');

	// end-to-end: the OOV query degrades to exact-key → escalates; it never collapses onto the capital class.
	const f = makeFrontier(TRUTH);
	const px = createProxyCache({ frontierAsk: f.frontierAsk, semanticKey: tk.semanticKey });
	await px.answer('What is the capital of France?');                         // seeds the capital class
	const r = await px.answer('Describe the vibe of France.');
	assert.equal(r.answer, 'romantic and varied', 'the OOV query gets its OWN frontier answer, not a false class hit');
	assert.equal(r.source, 'frontier');
	assert.equal(f.calls(), 2, 'the OOV query escalated (did not false-collapse onto the seeded class)');
});

test('the CAVEAT is real + backstopped — a COARSE schema collides different-answer queries; coverageCheck escalates the wrong hit', async () => {
	// a schema MISSING the answer dimension (subject only) → capital? and population? of France share ONE key.
	const COARSE = { subject: { enum: ['france', 'japan', 'brazil'] } };
	const { semanticKey } = makeTypedIntakeKey({ localAsk, facts: COARSE, required: ['subject'] });
	const f = makeFrontier(TRUTH);

	// WITHOUT a backstop the collision would serve the wrong cached answer — WITH coverageCheck the local model
	// confirms fit: 'Paris' does NOT answer 'population of France' → invalidate + escalate → the correct answer.
	const coverageCheck = async ( query, cached ) => {
		if ( /population/i.test(query) && cached === 'Paris' ) return false;   // the local judge rejects the mismatch
		return true;
	};
	const px = createProxyCache({ frontierAsk: f.frontierAsk, semanticKey, coverageCheck });

	const a = await px.answer('What is the capital of France?');
	assert.equal(a.answer, 'Paris'); assert.equal(f.calls(), 1);

	// the coarse key collides (both {subject:france}) — but coverageCheck catches the wrong hit and escalates.
	const b = await px.answer('What is the population of France?');
	assert.equal(b.answer, '68 million', 'the WRONG cached answer is NOT served — coverageCheck escalated it');
	assert.notEqual(b.answer, 'Paris');
	assert.equal(f.calls(), 2, 'the collision escalated to the frontier (the backstop held)');

	// NEG-of-the-NEG — without the backstop, the SAME coarse schema DOES serve the wrong answer (the caveat is real).
	const f2 = makeFrontier(TRUTH);
	const px2 = createProxyCache({ frontierAsk: f2.frontierAsk, semanticKey });   // no coverageCheck
	await px2.answer('What is the capital of France?');
	const wrong = await px2.answer('What is the population of France?');
	assert.equal(wrong.answer, 'Paris', 'proof the caveat bites: a coarse schema + no backstop serves the wrong class answer');
	assert.equal(f2.calls(), 1, 'the wrong hit was served LOCAL (no escalation) — why the schema must be answer-complete');
});
