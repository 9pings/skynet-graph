/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * sound-invoke — THE CONSTAT OPERATIONALIZED (roadmap 2026-07-09 P4; ZERO-CORE, host-side). KG-PROXY proved that a
 * bounded cross-instance invoke ≡ the flat run — same result + same JTMS at drift. P1 gave the bounded WIRE
 * (`invoke` → `{ summary, writeFootprint }`, only Σ_sep crosses). P4 makes the ADMISSION of that result SOUND, so the
 * equivalence is not just observed on a happy path but ENFORCED — "composé-cross-instance ≡ plat, *sainement*".
 *
 * `soundInvokeMerge(parent, invokeResult, extraction, { contract, targetId, oracle? })` gates the commit on the two
 * things the constat needs across the frontier, then applies through the sequenced taskflow:
 *
 *   1. assertPost(contract, summary, writeFootprint)  — the induced post asserted at ADMISSION (contract.js):
 *        · G1 FRAME-COMPLETENESS — the keys the body actually wrote (the P1 write-footprint = the delta) ⊆ declared
 *          write. An under-declared frame is the silent unsoundness; the write-footprint from P1 is exactly its witness.
 *        · the POST holds on the returned summaryFacts (the induced hypothesis — sound on observed, asserted here).
 *        · G2 EFFECT-TAG — an external/irreversible method's post needs a ground-truth ORACLE, never the internal fact.
 *      A violation → REFUSE (the caller never commits a lying result) + `blame` (feed `reviseOnBlame`, CEGIS).
 *   2. mergeSlice (extract.js) — the ASSUMPTION-RECHECK (the frozen frontier still holds in the parent since extraction
 *      — the ATMS defeasance) + SINGLE-WRITER (never writes a frontier id) + `pushMutation` (sequenced). A frontier
 *      drift → REFUSE (the dead-premise result is not committed — the sound analog of the flat JTMS retract).
 *
 * On success the summaryFacts are posted as FIRST-CLASS re-evaluable facts (KG-PROXY C): the caller's JTMS carries the
 * ongoing soundness — a LATER premise drift retracts them like any flat fact. ⇒ composé-cross-instance ≡ plat, sainement.
 */
const { assertPost } = require('../../../lib/authoring/contract.js');
const { mergeSlice } = require('../../../lib/authoring/extract.js');

/**
 * @param parent        the caller graph.
 * @param invokeResult  { summary:{<Σ_sep facts>}, writeFootprint:[keys] } — from Graph.invokeGraph / worker `invoke`.
 * @param extraction    the extractSubgraph record (carries the frozen frontier for the assumption-recheck).
 * @param opts.contract { read, write, pre, post, effect } — the method's typed contract.
 * @param opts.targetId the caller object the bounded summary posts onto (an interior id — never a frozen frontier id).
 * @param opts.oracle   (contract, factsAfter) => bool — ground-truth probe for an effecting post (G2).
 * @returns { merged:true, template } | { merged:false, reason, blame? }
 */
function soundInvokeMerge( parent, invokeResult, extraction, opts ) {
	opts = opts || {};
	const summary = (invokeResult && invokeResult.summary) || {};
	const footprint = (invokeResult && invokeResult.writeFootprint) || [];
	const contract = opts.contract || {};

	// (1) post-assert + blame — G1 frame / post-holds / G2 oracle, at admission.
	const post = assertPost(contract, summary, footprint, { oracle: opts.oracle });
	if ( !post.ok )
		return { merged: false, reason: 'post-violation: ' + post.violations.map(( v ) => v.kind + (v.detail != null ? '(' + v.detail + ')' : '')).join(','), blame: post.blame };

	// (2) assumption-recheck (frontier) + single-writer + sequenced apply. The write template IS the bounded summary
	// (already Σ_sep — no child to project from), posted onto the interior target.
	const project = () => [ Object.assign({ $$_id: opts.targetId }, summary) ];
	return mergeSlice(parent, null, extraction, { project });
}

module.exports = { soundInvokeMerge };
