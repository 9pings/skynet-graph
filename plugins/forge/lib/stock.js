/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * stock — the reusable CORE of gold-gated concept-method STOCK-BUILDING (host-side, ZERO-CORE, engine-free).
 * The WikiSQL pilot (2026-07-05) proved a stock of .sgc methods can be accumulated from a REAL externally-
 * labelled corpus: `record → forge model decomposition → crystallizeFrom → GOLD-GATE → .sgc`. That pilot
 * inlined the gate + the yield lever; THIS brick promotes them to the library so any dataset adapter reuses
 * them — a host writes only the small per-dataset `{ sigOf, goldStepsOf, problemOf }` adapter + a forge, and
 * the SOUNDNESS-bearing pieces (the gate that keeps the stock clean, the packaging) live here, tested once.
 *
 * The two findings the pilot measured, both captured here:
 *   1. THE VALUE IS THE GATE, not the generation. `goldGate` admits a class method into the stock ONLY IF
 *      the model's decomposition is CONSISTENT across the class's instances AND MATCHES the gold shape AND
 *      crystallize admitted it (K1-sound). So the stock stays 100% clean (0 false admitted) whatever the
 *      small model renders — the oracle (the dataset's gold) + the gate carry soundness, not the model.
 *   2. YIELD IS BOUNDED BY MODEL CONSISTENCY (the pilot's small model omitted/inconsistently-added a step).
 *      `consistencyVote` is the cheap, SOUNDNESS-PRESERVING lever: sample N decompositions of one instance,
 *      take the majority shape. It raises the fraction of instances that reach a consistent shape WITHOUT
 *      bypassing the gate (the gate still verifies the voted shape against gold) — never a soundness risk.
 *
 * Pure functions over shapes (arrays of typed step kinds) — NO engine, NO fs, NO model. The trace-producing
 * run (a Plan decomposition through the engine) stays the host's; this brick verifies + packages its output.
 */

const packMethods = require('../../learning/lib/method-pack.js').packMethods;

/** the canonical SHAPE of a typed decomposition — the ordered step kinds joined (the class-method identity). */
function shapeOf( steps ) { return (steps || []).join('>'); }

/**
 * CONSISTENCY VOTE (the yield lever) — given N sampled decompositions of the SAME instance, return the
 * MAJORITY shape + the agreement fraction. Deterministic on ties (first-seen mode wins). Empty samples vote
 * to an empty shape with agreement 0. Soundness-preserving: the voted shape is still gold-gated downstream.
 * @param samples  array of step-arrays (each a decomposition of one instance).
 * @returns {{ steps, shape, agreement, votes:{ <shape>: count }, n }}
 */
function consistencyVote( samples ) {
	samples = (samples || []).filter( Array.isArray );
	const votes = {}, first = {};
	let bestShape = '', bestCount = 0;
	for ( let i = 0; i < samples.length; i++ ) {
		const sh = shapeOf(samples[i]);
		if ( !sh ) continue;                                     // an empty decomposition is not a vote
		votes[sh] = (votes[sh] || 0) + 1;
		if ( first[sh] === undefined ) first[sh] = i;
		if ( votes[sh] > bestCount || (votes[sh] === bestCount && first[sh] < first[bestShape]) ) { bestShape = sh; bestCount = votes[sh]; }
	}
	const n = samples.length;
	const steps = bestShape ? bestShape.split('>') : [];
	return { steps, shape: bestShape, agreement: n ? bestCount / n : 0, votes, n };
}

/**
 * THE GOLD-GATE — the verification rule that keeps a stock clean. Admit a class method into the stock iff:
 *   (a) the model's per-instance shapes are CONSISTENT (all equal + non-empty across the class's instances),
 *   (b) that shape MATCHES the gold shape (the dataset oracle), and
 *   (c) crystallize ADMITTED the method (K1-sound: the trace carried typed content, not free prose).
 * By construction it NEVER admits a shape≠gold method — the stock's 0-false property is structural, not
 * model-dependent. Reports a discriminating `reason` on refusal (for the LOG / a curator).
 * @param opts { modelShapes:[…], goldSteps:[…]|goldShape:string, crystallized:bool }
 * @returns {{ admitted, consistent, goldMatch, crystallized, modelShape, goldShape, reason }}
 */
function goldGate( opts ) {
	opts = opts || {};
	const modelShapes = (opts.modelShapes || []).map( ( s ) => Array.isArray(s) ? shapeOf(s) : String(s || '') );
	const goldShape = opts.goldShape != null ? opts.goldShape : shapeOf(opts.goldSteps);
	const crystallized = !!opts.crystallized;
	const consistent = modelShapes.length > 0 && modelShapes.every( ( s ) => s === modelShapes[0] && s.length > 0 );
	const modelShape = consistent ? modelShapes[0] : (modelShapes[0] || '');
	const goldMatch = consistent && modelShape === goldShape;
	const admitted = consistent && goldMatch && crystallized;
	const reason = admitted ? 'admit'
		: !consistent ? 'model-inconsistent'
		: !goldMatch ? 'shape-mismatches-gold'
		: 'crystallize-refused';
	return { admitted, consistent, goldMatch, crystallized, modelShape, goldShape, reason };
}

/**
 * Pack the ADMITTED class methods into a portable `.sgc` stock (thin over method-pack). Each admitted class
 * is a recall-index entry keyed on its class signature (structure = `{ taskKind: sig }`).
 * @param admitted  array of `{ sig, candidate }` (the gold-verified class methods).
 * @param opts      { name, version, description, structureKey } — structureKey defaults to 'taskKind'.
 * @returns a `.sgc kind:'methods'` bundle.
 */
function packStock( admitted, opts ) {
	opts = opts || {};
	const sk = opts.structureKey || 'taskKind';
	const entries = (admitted || []).filter( ( a ) => a && a.candidate ).map( ( a ) => {
		const structure = {}; structure[sk] = a.sig;
		return { structure, content: {}, method: a.candidate };
	} );
	return packMethods({ entries: entries }, { name: opts.name || 'stock', version: opts.version || '0.0.0', description: opts.description || '' });
}

module.exports = { shapeOf, consistencyVote, goldGate, packStock };
