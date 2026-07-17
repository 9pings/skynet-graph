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
	// ── 1. classify → route: the archetype picks the orientation the decomposition is steered by ───
	const r = makeArchetypeRouter({ ask: scriptedAsk('sequential', CHAIN) });
	const routed = await r.route('First sum the items, then tax it, then total it.');
	console.log('archetype →', routed.archetype);
	console.log('hint      →', routed.hint.slice(0, 60) + '…');
	console.log('leaves    →', routed.leaves.map(( l ) => l.request.id + (l.readsExtra.length ? '(needs:' + l.readsExtra.join(',') + ')' : '') ).join(' → '));
	assert.equal(routed.archetype, 'sequential', 'the task was classified');
	assert.match(routed.hint, /CHAIN/, 'the sequential orientation steers toward a chain — that is the dispatch');
	assert.equal(routed.leaves.length, 3, 'the DAG came back typed');
	assert.deepEqual(routed.leaves[2].readsExtra, ['subtotal', 'tax'], 'the needs edges are typed keys, not prose');

	// ── 2. a DIFFERENT archetype dispatches a DIFFERENT orientation, from the same machinery ───────
	const fan = await makeArchetypeRouter({ ask: scriptedAsk('extraction', [
		{ stepKind: 'extract', produces: 'name', needs: [], instruction: 'pull the name' },
		{ stepKind: 'extract', produces: 'date', needs: [], instruction: 'pull the date' },
	]) }).route('Pull every field out of each row.');
	console.log('archetype →', fan.archetype, '| hint:', fan.hint.slice(0, 48) + '…');
	assert.equal(fan.archetype, 'extraction');
	assert.match(fan.hint, /fan-out/, 'extraction steers toward independent parts — a different shape, same router');
	assert.deepEqual(fan.leaves.map(( l ) => l.readsExtra ), [[], []], 'a pure fan-out: no needs between the parts');

	// ── 3. FAIL-CLOSED (the negative control): a bogus label never becomes a bogus route ───────────
	// The model answers with an archetype that does not exist. It does not get honoured, and it does not
	// throw either — it snaps to the general DAG, which is always a safe decomposition.
	const bogus = await makeArchetypeRouter({ ask: scriptedAsk('quantum-vibes', CHAIN) }).route('anything');
	console.log('bogus     →', bogus.archetype, '(the model said "quantum-vibes")');
	assert.equal(bogus.archetype, 'planning', 'off-enum → the safe default, never the hallucinated label');
	assert.ok(ARCHETYPES.includes(bogus.archetype), 'whatever comes back is always in the closed vocabulary');

	const empty = await makeArchetypeRouter({ ask: scriptedAsk('', CHAIN) }).route('anything');
	assert.equal(empty.archetype, 'planning', 'an empty classification also fails closed');

	// ── 4. the vocabulary is YOURS — the router is usable à nu ─────────────────────────────────────
	const custom = makeArchetypeRouter({
		ask       : scriptedAsk('triage', CHAIN),
		archetypes: ['triage', 'deep-dive'],
		hints     : { triage: 'Emit ONE cheap classification part.', 'deep-dive': 'Emit the full DAG.' },
		fallback  : 'triage',
	});
	const c = await custom.route('a ticket');
	console.log('custom    →', c.archetype, '|', c.hint);
	assert.equal(c.archetype, 'triage', 'your own archetype vocabulary routes the same way');
	assert.equal(await custom.detect('x'), 'triage');

	console.log('STRATEGY OK — classify → dispatch the matching decomposition; an off-enum label fails closed to the safe general DAG');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
