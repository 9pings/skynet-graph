/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C8 — the MIXTURE-RUNTIME server (`createMixtureServe`): a cheap local model ORIENTED by a
 * certified stock, with escalation to a bigger tier for the rest.
 *
 * READ THIS FIRST — this bootstrap demonstrates a REFUTED claim as much as a working one, on purpose:
 * the runtime **cross-agreement trust tier** (trusting a local answer because the small model and an
 * independent predictor agree) was measured at scale and REFUTED — precision 25-42 % at N=201. It is still
 * wired, because the mechanism is real and a host may want it with its own trust function; but the default
 * is FAIL-CLOSED (never auto-trust), and no page here claims cross-agreement is a correctness signal. What
 * survived the measurement: orientation LIFTS the raw score, and **0-false lives at ADMISSION (the forge),
 * never as a runtime badge**. §3 below shows exactly that failure, live.
 *
 * THE GUARANTEE SHOWN:
 *   1. FAIL-CLOSED BY DEFAULT. With no trust function wired, nothing is ever trusted locally — it escalates.
 *      The safe behaviour is what you get for free; trusting requires an explicit, deliberate opt-in.
 *   2. A TRUSTED RESULT IS ALWAYS CERTIFIED. The load-bearing invariant: a `local-trusted` shape is, always,
 *      in the certified vocabulary. An uncertified shape cannot be trusted no matter what agrees with it.
 *   3. THE ECONOMY IS REAL. When the gate does trust, the big tier is never called — that is the saving.
 *
 * small/big/proposeMenu/predict are INJECTED (stub models here — no GPU).
 * Deterministic:  node examples/bootstrap/c8-mixture-serve.js
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { createMixtureServe, makeSurfaceDispatch } = require('../../lib/index.js').factories;

// the CERTIFIED vocabulary — what a forged stock admitted (see forge-stock.js). Everything else is uncovered.
const SHAPES = ['aggregate>select', 'join>filter>select', 'filter>select'];
// labelled training queries → their certified shape. The surface signal is built from these, not from gold.
const ANCHORS = [
	{ text: 'how many singers are there', shape: 'aggregate>select' },
	{ text: 'count the number of albums', shape: 'aggregate>select' },
	{ text: 'total number of students enrolled', shape: 'aggregate>select' },
	{ text: 'name of the pet owned by the student called Smith', shape: 'join>filter>select' },
	{ text: 'the make of the car driven by driver Jones', shape: 'join>filter>select' },
	{ text: 'the countries of singers older than twenty', shape: 'filter>select' },
	{ text: 'the ages of employees in the sales department', shape: 'filter>select' },
];

async function main() {
	const sd = makeSurfaceDispatch({ anchors: ANCHORS });

	// ── 1. FAIL-CLOSED: no trust function → nothing is trusted locally, ever ───────────────────────
	let bigCalls = 0;
	const closed = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async () => 'aggregate>select',                      // the cheap model answers, and answers correctly
		big  : async () => { bigCalls++; return 'aggregate>select'; },
		proposeMenu: sd.proposeMenu,
	});
	const r1 = await closed.serve('how many albums are there');
	console.log('default →', JSON.stringify({ tier: r1.tier, certified: r1.certified, trusted: r1.trusted, bigCalls }));
	assert.equal(r1.trusted, false, 'no trust function wired → NEVER auto-trusted, even though the shape is certified');
	assert.equal(r1.tier, 'escalated', 'it escalated instead — the safe behaviour is the default, not an option');
	assert.equal(bigCalls, 1);

	// ── 2. an EXPLICIT trust opt-in: the economy, and the invariant that constrains it ─────────────
	bigCalls = 0;
	const mx = createMixtureServe({
		certifiedShapes: SHAPES,
		small: async ( q ) => sd.predict(q),                        // the cheap tier, oriented by the stock's menu
		big  : async ( q ) => { bigCalls++; return sd.predict(q); },
		proposeMenu: sd.proposeMenu,
		predict    : sd.predict,                                    // an independent signal…
		// …which enables the cross-agreement gate. NOTE: this gate is the REFUTED-at-scale one (25-42 %
		// precision at N=201). It is shown here because it is what the factory wires; do NOT read it as a
		// correctness claim. A production host should supply its own `trust` — or leave it fail-closed.
	});
	const r2 = await mx.serve('how many albums are there');
	console.log('trusted →', JSON.stringify({ tier: r2.tier, shape: r2.shape, certified: r2.certified, trusted: r2.trusted, bigCalls }));
	assert.equal(r2.tier, 'local-trusted', 'small and the predictor concurred → served local');
	assert.equal(bigCalls, 0, 'THE ECONOMY: the big tier was never called');
	assert.equal(r2.certified, true, 'THE INVARIANT: a trusted result is ALWAYS a certified shape');

	// ── 3. THE INVARIANT UNDER PRESSURE: an uncertified shape is never trusted, whatever agrees ────
	// Both tiers are made to agree on a shape OUTSIDE the certified vocabulary. Perfect agreement — and it
	// still is not trusted, because agreement was never the thing that licenses trust. Admission is.
	bigCalls = 0;
	const off = createMixtureServe({
		certifiedShapes: SHAPES,
		small  : async () => 'window>rank>select',                  // uncertified — the forge never admitted this
		big    : async ( q ) => { bigCalls++; return 'window>rank>select'; },
		predict: () => 'window>rank>select',                        // the predictor agrees perfectly
	});
	const r3 = await off.serve('rank the singers by album count');
	console.log('uncert  →', JSON.stringify({ tier: r3.tier, shape: r3.shape, certified: r3.certified, trusted: r3.trusted, bigCalls }), '← unanimous agreement, still NOT trusted');
	assert.equal(r3.trusted, false, 'agreement on an UNCERTIFIED shape licenses nothing — 0-false lives at admission');
	assert.equal(r3.certified, false);
	assert.equal(r3.tier, 'escalated', 'so it escalated — the honest move on an uncovered query');
	assert.equal(bigCalls, 1);

	// ── 4. the stats are the audit ────────────────────────────────────────────────────────────────
	console.log('stats   →', JSON.stringify(mx.stats));
	assert.equal(mx.stats.served, 1);
	assert.equal(mx.stats.localTrusted, 1);
	assert.equal(mx.stats.escalated, 0);

	console.log('BOOTSTRAP OK — fail-closed by default; a trusted result is always certified; agreement on an uncertified shape trusts nothing (0-false lives at admission, not at runtime)');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
