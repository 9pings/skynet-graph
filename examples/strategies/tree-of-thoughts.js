/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — TREE-OF-THOUGHTS: fan out candidate thoughts, score them, keep the best few, go deeper.
 *
 * This is one of the two CLASS-B strategies (with MCTS): the state lives in the graph as typed facts, and
 * only the SELECTION POLICY is imperative. That split is deliberate — a top-k beam is an argmax ACROSS
 * siblings, and the per-object rule DSL cannot express that (each rule sees one object). Forcing it into
 * rules would be the over-engineering trap, so the beam stays ~60 lines of driver and everything it decides
 * is written back as facts.
 *
 * THE GUARANTEE SHOWN, in two parts:
 *   1. THE PRUNE CASCADES NATIVELY. Prune one node and its whole subtree goes dark — zero traversal code.
 *      `Live` gates on "not pruned AND my parent is Live", a recursive hop-watcher.
 *   2. A PRUNED NODE COSTS NOTHING. The budget claim, asserted below: propose only ever runs on the live
 *      frontier, so a discarded branch never buys another model call.
 *
 * WHO SCORES: the host, and it must be an EXTERNAL judge — the generator scoring its own thoughts is the
 * refuted self-audit. The kernel snaps the raw score to a band so the gates key on an enum, never a float.
 *
 * Deterministic, no model:  node examples/strategies/tree-of-thoughts.js
 */
const assert = require('node:assert');
const Graph = require('../../lib/index.js');
const { bootStrategy } = require('./_boot.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// a scripted problem: branches labelled a/b/c, an EXTERNAL judge that likes 'a' best. Deterministic, so the
// whole search replays bit-identically. In production: propose = your model, score = your judge/oracle/test.
const SCORES = { a: 0.9, b: 0.6, c: 0.2 };
function scriptedHost() {
	const calls = { propose: 0, score: 0 };
	return { calls,
		propose: async ( node ) => { calls.propose++; return ['a', 'b', 'c'].map(( l ) => (node.text === 'seed' ? '' : node.text + '-') + l ); },
		score  : async ( node ) => { calls.score++; return SCORES[node.text.slice(-1)]; } };
}

async function main() {
	title('EXPLORE SEVERAL LINES OF THOUGHT — DROP THE BAD ONES, FOR FREE');
	say('Instead of committing to the first idea, try a few, keep the promising ones, go deeper.');
	say('The bookkeeping is normally the painful bit: when you abandon a line, you have to hunt');
	say('down everything that followed from it. Here you abandon one step and the rest goes dark');
	say('on its own — and the abandoned branches never cost another thought.');
	gap();

	// ── 1. the beam search, through the flat factory catalog (same door as every capability) ───────
	const host = scriptedHost();
	const tot = Graph.factories.createTreeOfThoughts({
		propose: host.propose, score: host.score,
		beamWidth: 2, branching: 3, maxDepth: 2,
	});
	const r = await tot.run('seed');
	beat(1, 'Explore several lines of thought at once, keep the best 2 at each level, drop the rest.');
	val('best line found', r.path.map(( v ) => v.text ).join('  →  '));
	val('branches dropped', r.pruned);
	good('the decision reads a coarse mark (good / okay / bad), never a raw decimal');
	assert.equal(r.best.text, 'a-a', 'the highest-banded chain wins');
	assert.deepEqual(r.path.map(( v ) => v.text ), ['seed', 'a', 'a-a'], 'the winning root→leaf path is READ OFF the structure, not tracked');
	assert.equal(r.best.scoreBand, 'high', 'the gate saw a band, never the raw 0.9');

	// THE BUDGET CLAIM: depth 0 expands the root (1 call); depth 1 expands ONLY the 2 beam survivors.
	// The pruned 'c' branch cost exactly zero propose calls — that is what the beam buys you.
	gap();
	beat(2, 'What did the abandoned branches cost us?');
	val('times we asked the model', host.calls.propose + ' — only ever for lines still in the running');
	good('a dropped branch costs exactly zero further thinking. That is the whole saving');
	assert.equal(host.calls.propose, 3, 'propose ran on the live frontier only (1 root + beamWidth)');
	assert.equal(host.calls.score, 9, 'every proposed child was scored exactly once (3 + 6)');
	assert.equal(r.pruned, 5, 'depth 1 pruned c; depth 2 pruned 4 of 6');
	gap();

	// ── 2. THE NATIVE CASCADE: prune a middle node, its subtree goes dark by itself ────────────────
	// Driver-free, straight on the grammar: a 3-level chain, prune the middle, watch the leaf follow.
	const g = bootStrategy('tree-of-thoughts', {
		nodes: [
			{ _id: 'n0', isThought: true, depth: 0, text: 'root' },
			{ _id: 'n0.0', isThought: true, depth: 1, parent: 'n0', text: 'mid' },
			{ _id: 'n0.0.0', isThought: true, depth: 2, parent: 'n0.0', text: 'leaf' },
		],
	});
	await g.settle();
	beat(3, 'A line of thought, three steps deep. We abandon the MIDDLE step — one word, one place.');
	assert.ok(g.cast('n0', 'Live') && g.cast('n0.0', 'Live') && g.cast('n0.0.0', 'Live'), 'precondition: the chain is live');

	await g.ingest({ 'n0.0': { pruned: 1 } });                                // ONE write, on ONE node
	await g.settle();
	good('everything that followed from it went dark too — we never went looking for it');
	good('and the step before it is untouched. It is a scalpel, not a wipe');
	assert.equal(g.cast('n0', 'Live'), true, 'the root survives — the cascade is precise, not a wipe');
	assert.equal(g.cast('n0.0', 'Live'), false, 'the pruned node left the beam');
	assert.equal(g.cast('n0.0.0', 'Live'), false, 'its DESCENDANT went dark too — recursive hop-watcher, zero traversal code');
	g.close();
	gap();

	// ── 3. NEGATIVE CONTROL: a beam wider than the branching prunes nothing ────────────────────────
	const h2 = scriptedHost();
	const wide = await Graph.factories.createTreeOfThoughts({ propose: h2.propose, score: h2.score, beamWidth: 5, branching: 3, maxDepth: 1 }).run('seed');
	beat(4, 'And if we allow more lines than there are? Does it drop things anyway?');
	good('nothing dropped. It only ever abandons what actually lost');
	assert.equal(wide.pruned, 0, 'top-5 of 3 children → the driver never over-prunes');
	assert.equal(wide.best.text, 'a', 'ranking still picks the best band');
	gap();

	// ── 4. REPLAY DETERMINISM: no randomness anywhere — two runs are byte-identical ────────────────
	const once = async () => { const h = scriptedHost(); return JSON.stringify(await Graph.factories.createTreeOfThoughts({ propose: h.propose, score: h.score, beamWidth: 2, branching: 3, maxDepth: 2 }).run('seed')); };
	beat(5, 'Run the whole exploration again.');
	assert.equal(await once(), await once(), 'same inputs → same tree, same verdict');
	good('identical. Same tree, same winner, every time');

	finish('abandon one thought and everything under it goes with it — for free, and it costs no further thinking.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
