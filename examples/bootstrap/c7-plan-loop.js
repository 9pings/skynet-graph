/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C7 — the PLAN LOOP (`createPlanLoop`): the piece-by-piece zoom on a task bigger than the context.
 * This is the runnable face of README feature **F2**.
 *
 * THE GUARANTEE SHOWN, three parts:
 *   1. NO LEAF SEES THE WHOLE TASK. Each leaf is served with a BOUNDED context — only the upstream values it
 *      declared it needs. That is the mechanism behind the measured zoom (GSM8K 16→52 %, FinQA 20→50 % at
 *      N=200/domain; and 0/33 → 10/33 where whole-context prompting collapses).
 *   2. A SEVERED LEAF IS REFUSED, NEVER GUESSED. Amputate a fact a leaf requires and it comes back REFUSED
 *      and named — the answer carries a hole you can see, not a plausible invention. This is the difference
 *      between a decomposition framework and a typed one.
 *   3. THE PLAN IS DRIVEN TO A FIXPOINT. Hand it a degenerate plan — duplicated and out-of-order leaves —
 *      and rebalance dedupes and reorders it into the clean answer, monotonically.
 *
 * `decompose` and `serveLeaf` are INJECTED, so the loop is usable à nu and testable with no model. In
 * production: decompose = the typed-loop (or the archetype router — see examples/strategies/meta-router.js),
 * serveLeaf = `createProxyCache(...).solve` — the cost ladder, whose escalation is LOAD-BEARING (measured:
 * the local stock alone is model-capability-bound on hard leaves).
 *
 * Deterministic, no GPU:  node examples/bootstrap/c7-plan-loop.js
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { createPlanLoop } = require('../../lib/index.js').factories;
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// a small "annual report" task: four figures, one of which depends on two others.
const GOLD = { revenue: 913, costs: 400, margin: 513, marginPct: 56 };
const leaf = ( id, needs ) => ({ id: 'n_' + id, request: { id, agg: 'read' }, nl: 'figure ' + id, readsExtra: needs || [] });

// the leaf ladder: what actually answers one bounded question. It records WHAT each leaf was shown.
function ladder() {
	const seen = [];
	const serveLeaf = async ( lf ) => {
		const id = lf.request.id;
		// lf.prompt is built by the ENGINE, not by us: it is exactly what a model would receive here.
		seen.push({ id, inputs: Object.keys(lf.inputs || {}), prompt: lf.prompt });
		if ( id === 'margin' ) return lf.inputs.revenue - lf.inputs.costs;  // computed FROM its bounded inputs
		if ( id === 'marginPct' ) return Math.round(lf.inputs.margin / lf.inputs.revenue * 100);
		return GOLD[id];
	};
	return { serveLeaf, seen };
}

async function main() {
	// ── 1. the bounded context: each leaf sees ONLY what it declared it needs ──────────────────────
	const l = ladder();
	const loop = createPlanLoop({
		decompose: async () => [
			leaf('revenue'), leaf('costs'),
			leaf('margin', ['revenue', 'costs']),          // needs two upstreams
			leaf('marginPct', ['margin', 'revenue']),      // needs the derived one
		],
		serveLeaf: l.serveLeaf,
	});
	const r = await loop.run('Analyze the annual report');
	title('A BIG TASK, DONE ONE SMALL PIECE AT A TIME');
	say('Give a model a whole dossier and ask a deep question, and it drowns. So the task is cut');
	say('into steps — and each step is shown ONLY what it actually asked for. Not the dossier.');
	say('Not its neighbours. Just its own inputs.');
	gap();
	beat(1, 'Four figures to work out from a report. THIS is the entire prompt each step received —');
	say('       not a summary of it, the actual string the engine handed over:');
	gap();
	for ( const s of l.seen ) {
		say('   ┌─ the "' + s.id + '" step was sent ' + '─'.repeat(Math.max(0, 60 - s.id.length)));
		say('   │ ' + s.prompt);
		say('   └' + '─'.repeat(78));
	}
	good('each one is one line long. Nobody ever saw the whole dossier — that is the entire trick');
	say('       (USE = the values it asked for, already worked out. PRODUCE = the one thing it owes.)');
	val('the answer', r.answer);
	assert.equal(r.converged, true);
	assert.equal(r.refusal, null);
	gap();

	const byId = Object.fromEntries(l.seen.map(( s ) => [s.id, s.inputs] ));
	assert.deepEqual(byId.revenue, [], 'a root leaf sees NOTHING — not the task, not its siblings');
	assert.deepEqual(byId.margin.sort(), ['costs', 'revenue'], 'margin saw exactly its two declared upstreams');
	assert.deepEqual(byId.marginPct.sort(), ['margin', 'revenue'], 'and marginPct saw exactly its two — not the whole dossier');
	assert.match(r.answer, /margin=513/, 'the derived figures are right, computed from bounded inputs only');
	assert.match(r.answer, /marginPct=56/, 'and the second-order derivation too — the projection ordered them');

	// ── 2. THE REFUSAL (the discriminating control): a severed leaf is REFUSED, not invented ───────
	// `marginPct` needs `margin`, but the plan no longer produces `margin`. A framework would serve the
	// leaf anyway and let the model guess. Here the leaf never gets served: it comes back REFUSED, named.
	const l2 = ladder();
	const severed = createPlanLoop({
		decompose: async () => [leaf('revenue'), leaf('marginPct', ['margin', 'revenue'])],   // `margin` amputated
		serveLeaf: l2.serveLeaf,
		isComplete: ( req ) => req.id !== 'marginPct' || false,      // the pre-contract: this request is incomplete
	});
	const rs = await severed.run('Analyze the annual report');
	beat(2, 'Now we take away a figure that one of the steps needs. What does it do?');
	bad('it REFUSES that step, by name — it does not guess a plausible number');
	good('and the answer carries a visible hole where the figure should be');
	good('the model was never even asked. It was stopped before it could invent');
	say('       (a framework would run the step anyway and let the model make something up.)');
	assert.ok(rs.refused.length > 0, 'the severed leaf is NAMED in refused — the hole is visible');
	assert.match(rs.answer, /REFUSED/, 'and it reads REFUSED in the answer — never a silent wrong value');
	assert.ok(!l2.seen.some(( s ) => s.id === 'marginPct' ), 'it was refused AT PROJECTION — the model was never even asked to guess');
	gap();

	// ── 3. THE FIXPOINT: a degenerate plan (duplicated + disordered) converges to the clean answer ──
	const l3 = ladder();
	const messy = createPlanLoop({
		decompose: async () => [                                     // reversed, and revenue asked for twice
			leaf('margin', ['revenue', 'costs']), leaf('revenue'), leaf('costs'), leaf('revenue'),
		],
		serveLeaf: l3.serveLeaf,
	});
	const rm = await messy.run('Analyze the annual report');
	beat(3, 'Last one: hand it a sloppy plan — steps in the wrong order, one asked for twice.');
	good('the duplicate is noticed and dropped — the work is not done twice');
	good('the order sorts itself out, and the right answer comes back anyway');
	assert.equal(rm.leaves, 3, 'the duplicate leaf was deduped by the rebalance (E1)');
	assert.equal(rm.converged, true, 'and it reached a fixpoint');
	assert.equal(rm.monotone, true, 'monotonically — the measure never went backwards');
	assert.match(rm.answer, /margin=513/, 'the out-of-order plan still produced the right derived figure');

	finish('every step sees only what it asked for — and a step missing a fact refuses instead of inventing one.', 'BOOTSTRAP OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
