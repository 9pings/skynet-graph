/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — META-ROUTER: classify the task, THEN pick the decomposition that shape justifies.
 *
 * The router is the "which strategy?" strategy. A prompt is first classified into a decomposition ARCHETYPE
 * (`sequential | extraction | multihop | aggregate | planning`), and the matching orientation then steers the
 * decomposition toward the structure that archetype actually justifies — a chain, a fan-out, a layered DAG,
 * a fan-out-then-merge, or a general DAG.
 *
 * THE GUARANTEE SHOWN: **the classification is FAIL-CLOSED.** The label is a closed enum; anything the model
 * says that is not in it (a hallucinated archetype, empty, prose) snaps to `planning` — the general DAG, which
 * is always safe. A misclassification therefore costs you a less-tailored decomposition, never a broken one.
 *
 * HONEST SCOPE (this one has a caveat worth reading): the archetype→scheme map is a well-motivated PRIOR from
 * the decomposition study, NOT a proven law — the study's own evidence is same-model-inflated and thin
 * cross-model. What is wired here is the DECISION MECHANISM; the claim that each archetype's scheme is optimal
 * is explicitly not made. Override `archetypes`/`hints` with your own vocabulary — it is usable à nu.
 *
 * WHO CLASSIFIES: the host's model, grammar-constrained to the enum. Scripted here for determinism.
 * Deterministic, no model:  node examples/strategies/meta-router.js
 */
const assert = require('node:assert');
const { makeArchetypeRouter, ARCHETYPES } = require('../../plugins/planner/lib/dag-decompose.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// A scripted model: it classifies, then emits a decomposition. In production both calls go to your model
// (grammar-constrained). The router's two asks are distinguishable by their system prompt.
function scriptedAsk( label, parts ) {
	return async ( { system } ) => {
		if ( /Classify the task/.test(system) ) return JSON.stringify(label);      // the detect call → the archetype label
		return JSON.stringify(parts);                                              // the decompose call → the DAG (an array of parts)
	};
}

const CHAIN = [
	{ stepKind: 'compute', produces: 'subtotal', needs: [], instruction: 'sum the line items' },
	{ stepKind: 'compute', produces: 'tax', needs: ['subtotal'], instruction: 'apply the rate to subtotal' },
	{ stepKind: 'compute', produces: 'total', needs: ['subtotal', 'tax'], instruction: 'add them' },
];

async function main() {
	title('WORK OUT WHAT KIND OF JOB THIS IS — THEN SPLIT IT THE RIGHT WAY');
	say('Not every task should be broken up the same way. "Do A, then B, then C" is a chain.');
	say('"Pull every field out of this form" is a hundred independent little jobs. Getting that');
	say('wrong makes everything downstream worse, so it is decided first, and it is decided safely.');
	gap();

	// ── 1. classify → route: the archetype picks the orientation the decomposition is steered by ───
	const r = makeArchetypeRouter({ ask: scriptedAsk('sequential', CHAIN) });
	const routed = await r.route('First sum the items, then tax it, then total it.');
	beat(1, '"First sum the items, then tax it, then total it."');
	val('recognised as', 'a CHAIN — each step feeds the next');
	val('so it is split into', routed.leaves.map(( l ) => l.request.id ).join('  →  '));
	good('each part says which earlier part it needs — by name, not by hoping');
	assert.equal(routed.archetype, 'sequential', 'the task was classified');
	assert.match(routed.hint, /CHAIN/, 'the sequential orientation steers toward a chain — that is the dispatch');
	assert.equal(routed.leaves.length, 3, 'the DAG came back typed');
	assert.deepEqual(routed.leaves[2].readsExtra, ['subtotal', 'tax'], 'the needs edges are typed keys, not prose');
	gap();

	// ── 2. a DIFFERENT archetype dispatches a DIFFERENT orientation, from the same machinery ───────
	const fan = await makeArchetypeRouter({ ask: scriptedAsk('extraction', [
		{ stepKind: 'extract', produces: 'name', needs: [], instruction: 'pull the name' },
		{ stepKind: 'extract', produces: 'date', needs: [], instruction: 'pull the date' },
	]) }).route('Pull every field out of each row.');
	beat(2, '"Pull every field out of each row."');
	val('recognised as', 'INDEPENDENT little jobs — not a chain at all');
	val('so it is split into', fan.leaves.map(( l ) => l.request.id ).join('  ·  ') + '  (nothing waits on anything)');
	good('same machinery, different shape — because it is a different kind of job');
	assert.equal(fan.archetype, 'extraction');
	assert.match(fan.hint, /fan-out/, 'extraction steers toward independent parts — a different shape, same router');
	assert.deepEqual(fan.leaves.map(( l ) => l.readsExtra ), [[], []], 'a pure fan-out: no needs between the parts');
	gap();

	// ── 3. FAIL-CLOSED (the negative control): a bogus label never becomes a bogus route ───────────
	// The model answers with an archetype that does not exist. It does not get honoured, and it does not
	// throw either — it snaps to the general DAG, which is always a safe decomposition.
	const bogus = await makeArchetypeRouter({ ask: scriptedAsk('quantum-vibes', CHAIN) }).route('anything');
	beat(3, 'Now the model answers with a category that does not exist: "quantum-vibes".');
	bad('the made-up answer is not honoured — and nothing crashes');
	good('it falls back to the general-purpose split, which is always safe');
	say('       (guessing the job wrong costs you a less tidy split. It never costs you a broken one.)');
	assert.equal(bogus.archetype, 'planning', 'off-enum → the safe default, never the hallucinated label');
	assert.ok(ARCHETYPES.includes(bogus.archetype), 'whatever comes back is always in the closed vocabulary');

	const empty = await makeArchetypeRouter({ ask: scriptedAsk('', CHAIN) }).route('anything');
	assert.equal(empty.archetype, 'planning', 'an empty classification also fails closed');
	gap();

	// ── 4. the vocabulary is YOURS — the router is usable à nu ─────────────────────────────────────
	const custom = makeArchetypeRouter({
		ask       : scriptedAsk('triage', CHAIN),
		archetypes: ['triage', 'deep-dive'],
		hints     : { triage: 'Emit ONE cheap classification part.', 'deep-dive': 'Emit the full DAG.' },
		fallback  : 'triage',
	});
	const c = await custom.route('a ticket');
	beat(4, 'And the categories are yours: here, "triage" or "deep-dive" for support tickets.');
	good('recognised as: ' + c.archetype + ' — your own vocabulary, same machinery');
	assert.equal(c.archetype, 'triage', 'your own archetype vocabulary routes the same way');
	assert.equal(await custom.detect('x'), 'triage');
	gap();
	say('HONEST NOTE: which split suits which kind of job is a well-argued hunch, not a proven law');
	say('— the evidence behind it is thin. What is built here is the DECIDING, done safely.');

	finish('the kind of job decides the split; an invented category never routes anything.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
