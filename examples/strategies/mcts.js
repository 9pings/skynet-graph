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

// a scripted one-ply game: 'good' always wins the rollout, 'bad' always loses. In production: actions =
// your legal moves, simulate = your rollout policy (keep it deterministic and the search stays replayable).
const oneply = () => ({
	actions : async ( node ) => node.parent == null ? ['good', 'bad'] : [],
	simulate: async ( node ) => node.move === 'good' ? 1 : 0,
});

async function main() {
	// ── 1. the search converges — through the flat factory catalog ─────────────────────────────────
	const r = await Graph.factories.createMCTS(Object.assign(oneply(), { iterations: 9 })).run('the position');
	const good = r.children.find(( k ) => k.move === 'good' ), bad = r.children.find(( k ) => k.move === 'bad' );
	console.log('best    →', JSON.stringify({ move: r.best.move, visits: r.best.visits }));
	console.log('arms    →', JSON.stringify({ good: { visits: good.visits, wins: good.wins }, bad: { visits: bad.visits, wins: bad.wins } }));
	console.log('root    →', JSON.stringify({ visits: r.root.visits, wins: r.root.wins }));
	assert.equal(r.best.move, 'good', 'the winning move collected the visits');
	assert.ok(good.visits > bad.visits, 'exploitation dominates once the win is established');
	assert.equal(good.wins, good.visits, 'the good arm never lost a rollout');
	assert.equal(bad.wins, 0, 'the bad arm never won one');
	assert.equal(r.root.visits, 9, 'every iteration backpropagated to the root');
	assert.equal(r.root.wins, good.wins, 'the root total = the sum of winning rollouts — the stats are honest');

	// ── 2. THE FRONTIER IS LIVE: Expandable uncasts the moment a node is expanded or terminal ──────
	// Driver-free, straight on the grammar: "what is still growable?" is a cast set, not a bookkeeping list.
	const g = bootStrategy('mcts', {
		nodes: [
			{ _id: 'a', isThought: true, visits: 0, wins: 0, text: 'a' },
			{ _id: 'b', isThought: true, visits: 0, wins: 0, text: 'b' },
		],
	});
	await g.settle();
	console.log('frontier→', JSON.stringify({ a: g.cast('a', 'Expandable'), b: g.cast('b', 'Expandable') }));
	assert.ok(g.cast('a', 'Expandable') && g.cast('b', 'Expandable'), 'fresh nodes are the frontier');

	await g.ingest({ a: { expanded: 1 }, b: { terminal: 1 } });
	await g.settle();
	console.log('grown   →', JSON.stringify({ a: g.cast('a', 'Expandable'), b: g.cast('b', 'Expandable') }));
	assert.equal(g.cast('a', 'Expandable'), false, 'an expanded node left the frontier (the ensure fell)');
	assert.equal(g.cast('b', 'Expandable'), false, 'a terminal node left the frontier');
	g.close();

	// ── 3. NEGATIVE CONTROL: a dead-end recommends NOTHING rather than inventing a move ────────────
	const dead = await Graph.factories.createMCTS({ actions: async () => [], simulate: async () => 1, iterations: 3 }).run('dead-end');
	console.log('deadend →', JSON.stringify({ best: dead.best, children: dead.children.length, terminal: dead.root.terminal, visits: dead.root.visits }));
	assert.equal(dead.best, null, 'no move to recommend — and none fabricated');
	assert.equal(dead.children.length, 0, 'no children invented');
	assert.equal(dead.root.terminal, true, 'the root was marked terminal');
	assert.equal(dead.root.visits, 3, 'the rollouts still ran and were still counted — honest stats, not a silent skip');

	// ── 4. REPLAY DETERMINISM: the whole search, twice, byte-identical ─────────────────────────────
	const once = async () => JSON.stringify(await Graph.factories.createMCTS(Object.assign(oneply(), { iterations: 7 })).run('the position'));
	assert.equal(await once(), await once(), 'no Math.random in the driver → the search is reproducible');
	console.log('replay  → two searches JSON-identical');

	console.log('STRATEGY OK — UCB1 with no randomness: the search converges, the tree is the audit, and two runs are byte-identical');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
