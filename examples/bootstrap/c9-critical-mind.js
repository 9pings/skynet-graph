/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C9 — the EXTERNAL CRITICAL MIND (`createCriticalMind`): the runnable face of README feature
 * **F5**, and the one strategy in the catalog that is LLM-MEASURED (GPU-replayed, published numbers:
 * 0 wrong verdicts vs a native think budget's 13/24 ≈ chance, 11 of them confidently wrong).
 *
 * THE GUARANTEE SHOWN, and it is mostly about what the thing REFUSES to do:
 *   1. 0-FABRICATION IS STRUCTURAL. A point enters the ledger only if real statements from the pool WITNESS
 *      it. A point nothing witnesses stays **open** — visibly unproven, never quietly asserted.
 *   2. THE GENERATION GATE IS NOT ADVISORY. Even the model's *own* proposed thesis is admitted only on ≥2
 *      unused same-side witnesses. Below, the CON thesis dies at that gate — the model proposed it, the
 *      gate refused it. That refusal is the mechanism, not an error path.
 *   3. THE VERDICT HAS A BOUND. A verdict is rendered only at margin ≥ 3 (on this frame); below it you get
 *      counts + an honest **UNDECIDED**. Weighing which side "wins" on free content was measured and
 *      refuted for a low-quant judge — so it is not offered. That is the decidability bound, kept.
 *
 * `ask` is INJECTED and scripted here, so this runs with no model and no GPU. In production it is your local
 * gguf, and this same factory is what the `sg mcp` `critique` tool runs. The debate itself is a CONCEPT SET
 * (the grammar face is the default since the GPU parity re-measure: identical results, budgets, and
 * byte-identical prompts vs the imperative reference — `createCriticalMindImperative`, exported one release).
 *
 * Deterministic, no GPU:  node examples/bootstrap/c9-critical-mind.js
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { createCriticalMind } = require('../../lib/index.js').factories;

// The caller's MATERIAL: real statements to reason over. The frame is announced MATERIAL (vs FREE when you
// give none, vs DECLARED when you name the viewpoints yourself) — you always know which perimeter you are on.
const STATEMENTS = [
	'PRO: pro argument one about cost',
	'PRO: pro argument two about speed',
	'PRO: pro argument three about morale',
	'PRO: pro argument four about focus',
	'CON: con argument one about risk',
	'CON: con argument two about coordination',
];

// a scripted local model. Every branch below is a prompt the debate actually issues.
function scriptedAsk() {
	return async ( q ) => {
		const u = String(q.user);
		if ( /Name the 2 main DISTINCT points of view/.test(u) )
			return /PRO statements/.test(u) ? 'V: pro efficiency\nV: pro wellbeing' : 'V: con delivery risk\nV: con coordination cost';
		if ( /Which statements GENUINELY make this exact point/.test(u) ) {
			if ( /Point of view/.test(u) )
				return /pro efficiency/.test(u) ? 'cites: p1, p2'
					: /con delivery risk/.test(u) ? 'cites: c1'
					: 'cites: NONE';                         // "pro wellbeing" + "con coordination cost" find no witness → they stay OPEN
			return 'cites: NONE';
		}
		if ( /Propose ONE NEW/.test(u) ) {
			if ( /UNUSED statements:[\s\S]*p3/.test(u) ) return 'THESIS: a new pro angle | cites: p3, p4';   // 2 unused → admissible
			if ( /UNUSED statements:[\s\S]*c2/.test(u) ) return 'THESIS: a fused con angle | cites: c2, c1';  // c1 already used → only 1 valid → REFUSED
			return 'NONE';
		}
		if ( /restatement of one known point/.test(u) ) return 'NEW';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /Summarize the (PRO|CON) case/.test(u) ) return 'one-line synthesis.';
		if ( /Rewrite the report/.test(u) ) return 'polished text.';
		throw new Error('unexpected prompt: ' + u.slice(0, 80));
	};
}

async function main() {
	// ── 1. a debate on MATERIAL: what gets established, what stays open, what the gate refuses ─────
	const cm = createCriticalMind({ ask: scriptedAsk() });
	const r = await cm.run({ topic: 'Should we adopt X?', statements: STATEMENTS });

	const established = r.ledger.filter(( e ) => e.status !== 'open' );
	const open = r.ledger.filter(( e ) => e.status === 'open' );
	console.log('frame   →', r.frameStatus, '| threshold:', r.threshold);
	console.log('ledger  →', established.map(( e ) => e.side + ':"' + e.text + '" ⟵ ' + e.witnesses.join('+') ).join('  '));
	console.log('open    →', open.map(( e ) => '"' + e.text + '"' ).join(', '), '← nothing witnessed these, so they stay UNPROVEN');
	console.log('counts  →', JSON.stringify(r.counts), '| verdict:', r.verdict);

	assert.equal(r.frameStatus, 'MATERIAL', 'the perimeter is announced, always');
	const v1 = r.ledger.find(( e ) => e.text === 'pro efficiency' );
	assert.deepEqual(v1.witnesses, ['p1', 'p2'], 'an established point NAMES the statements that witness it');
	assert.equal(open.length, 2, 'the two unwitnessed points stayed open — an unproven point is never faked');

	// the generation gate: the model proposed TWO theses; only the one with 2 unused witnesses got in.
	const generated = r.ledger.filter(( e ) => e.kind === 'generated' );
	console.log('gen     →', generated.map(( e ) => e.side + ':"' + e.text + '" ⟵ ' + e.witnesses.join('+') ).join('  '), '← the CON thesis the model also proposed was REFUSED (c1 was already used → only 1 witness left)');
	assert.equal(generated.length, 1, 'exactly one generated thesis survived the gate');
	assert.equal(generated[0].side, 'PRO');
	assert.deepEqual(generated[0].witnesses, ['p3', 'p4'], 'admitted on 2 UNUSED same-side witnesses — 0-fabrication is structural');

	// the bound: PRO 2 vs CON 1 → margin 1 < 3 → no verdict, and the report says so.
	assert.deepEqual(r.counts, { PRO: 2, CON: 1 });
	assert.equal(r.verdict, 'UNDECIDED', 'margin 1 < threshold 3 → counts + an honest UNDECIDED, not a coin flip');
	assert.equal(r.norm.status, 'CONTESTED');
	assert.match(r.prose, /Frame status: \*\*MATERIAL\*\*/, 'the deliverable states its own perimeter');
	assert.match(r.prose, /pro argument one about cost/, 'and quotes its witnesses verbatim — auditable');
	assert.match(r.prose, /could not be established/, 'and says out loud what it could not prove');
	assert.match(r.prose, /no verdict is rendered/, 'and refuses the verdict in plain language');

	// ── 2. THE REFUSAL BEFORE ANY MODEL CALL: an inadequate pool is refused at 0 asks ──────────────
	let asks = 0;
	const counted = createCriticalMind({ ask: async ( q ) => { asks++; return scriptedAsk()(q); } });
	const thin = await counted.run({ topic: 'Should we adopt X?', statements: ['PRO: only one', 'CON: only one too'] });
	console.log('thin    →', JSON.stringify({ error: thin.error, verdict: thin.verdict, asks }));
	assert.match(thin.error, /pool too small/, 'an inadequate pool is refused, with the reason');
	assert.equal(thin.verdict, 'UNDECIDED');
	assert.equal(asks, 0, 'and refused WITHOUT spending a single model call — the gate is upstream of the cost');

	console.log('BOOTSTRAP OK — points enter only with witnesses (unproven stays open); the generation gate refuses the model\'s own under-witnessed thesis; below the margin bound the verdict is an honest UNDECIDED');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
