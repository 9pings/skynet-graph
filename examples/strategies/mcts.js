/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — MCTS: select by UCB1, expand, roll out, backpropagate; the most-visited move wins.
 *
 * The second CLASS-B strategy (with tree-of-thoughts): state-in-graph, policy-in-driver. Visits, wins,
 * moves, expanded/terminal flags and parent edges are all typed FACTS — so the search tree is inspectable,
 * serializable and replayable, and every decision the driver takes is written back. The driver is only
 * what the rule DSL genuinely cannot express: an argmax across siblings.
 *
 * THE GUARANTEE SHOWN: **there is no `Math.random` in the driver.** Exploration is the UCB1 term, not
 * noise. So with a deterministic rollout the entire search replays bit-identically — the tree IS the audit
 * trail, and you can re-derive exactly how a move got recommended. (Compare a stock MCTS, where two runs of
 * the same position give you two different trees and no way to reproduce the one that made the decision.)
 *
 * WHO ROLLS OUT: the host — `actions` enumerates the legal moves, `simulate` plays one out to 0|1.
 *
 * Deterministic, no model:  node examples/strategies/mcts.js
 */
const assert = require('node:assert');
const Graph = require('../../lib/index.js');
const { bootStrategy } = require('./_boot.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// a scripted one-ply game: 'good' always wins the rollout, 'bad' always loses. In production: actions =
// your legal moves, simulate = your rollout policy (keep it deterministic and the search stays replayable).
const oneply = () => ({
	actions : async ( node ) => node.parent == null ? ['good', 'bad'] : [],
	simulate: async ( node ) => node.move === 'good' ? 1 : 0,
});

async function main() {
	title('A SEARCH THAT TRIES MOVES AT RANDOM — AND STILL GIVES THE SAME ANSWER TWICE');
	say('This is the family of search behind game-playing AI: try a move, play it out, see who');
	say('wins, favour whatever keeps winning. It normally relies on randomness — which means the');
	say('same position gives you a different answer each run, and you can never reproduce the');
	say('search that made a decision. There is no randomness in this one.');
	gap();

	// ── 1. the search converges — through the flat factory catalog ─────────────────────────────────
	const r = await Graph.factories.createMCTS(Object.assign(oneply(), { iterations: 9 })).run('the position');
	const gArm = r.children.find(( k ) => k.move === 'good' ), bArm = r.children.find(( k ) => k.move === 'bad' );
	beat(1, 'A position with two moves. One always wins, one always loses. 9 tries.');
	note('the winning move   — tried ' + gArm.visits + ' times, won ' + gArm.wins);
	note('the losing move    — tried ' + bArm.visits + ' times, won ' + bArm.wins);
	good('it recommends the winning move, because that is where the wins were');
	good('the tries add up: ' + r.root.visits + ' tries, ' + r.root.wins + ' wins — the count is honest, not rounded');
	assert.equal(r.best.move, 'good', 'the winning move collected the visits');
	assert.ok(gArm.visits > bArm.visits, 'exploitation dominates once the win is established');
	assert.equal(gArm.wins, gArm.visits, 'the good arm never lost a rollout');
	assert.equal(bArm.wins, 0, 'the bad arm never won one');
	assert.equal(r.root.visits, 9, 'every iteration backpropagated to the root');
	assert.equal(r.root.wins, gArm.wins, 'the root total = the sum of winning rollouts — the stats are honest');
	gap();

	// ── 2. THE FRONTIER IS LIVE: Expandable uncasts the moment a node is expanded or terminal ──────
	// Driver-free, straight on the grammar: "what is still growable?" is a cast set, not a bookkeeping list.
	const g = bootStrategy('mcts', {
		nodes: [
			{ _id: 'a', isThought: true, visits: 0, wins: 0, text: 'a' },
			{ _id: 'b', isThought: true, visits: 0, wins: 0, text: 'b' },
		],
	});
	await g.settle();
	beat(2, 'Which positions are still worth growing? That question answers itself:');
	note('two fresh positions — both open for exploring');
	await g.ingest({ a: { expanded: 1 }, b: { terminal: 1 } });
	await g.settle();
	good('one gets explored, the other turns out to be the end of the game');
	good('both drop off the "worth growing" list by themselves — nothing bookkeeps that');
	assert.equal(g.cast('a', 'Expandable'), false, 'an expanded node left the frontier (the ensure fell)');
	assert.equal(g.cast('b', 'Expandable'), false, 'a terminal node left the frontier');
	g.close();
	gap();

	// ── 3. NEGATIVE CONTROL: a dead-end recommends NOTHING rather than inventing a move ────────────
	const dead = await Graph.factories.createMCTS({ actions: async () => [], simulate: async () => 1, iterations: 3 }).run('dead-end');
	beat(3, 'A dead-end position, where there is no move at all.');
	bad('it recommends NOTHING. It does not invent a move to look useful');
	good('and it still reports the ' + dead.root.visits + ' tries it really made — no silent skipping');
	assert.equal(dead.best, null, 'no move to recommend — and none fabricated');
	assert.equal(dead.children.length, 0, 'no children invented');
	assert.equal(dead.root.terminal, true, 'the root was marked terminal');
	assert.equal(dead.root.visits, 3, 'the rollouts still ran and were still counted — honest stats, not a silent skip');
	gap();

	// ── 4. REPLAY DETERMINISM: the whole search, twice, byte-identical ─────────────────────────────
	const once = async () => JSON.stringify(await Graph.factories.createMCTS(Object.assign(oneply(), { iterations: 7 })).run('the position'));
	beat(4, 'Now run the exact same search a second time.');
	assert.equal(await once(), await once(), 'no Math.random in the driver → the search is reproducible');
	good('identical, down to the last number. You can always re-do the search that decided');
	say('       (this also held with a real 9.5 GB model in the loop, not just this scripted one.)');

	finish('the search converges on the winning move, admits a dead end, and repeats exactly.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
