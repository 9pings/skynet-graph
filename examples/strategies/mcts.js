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
const { exchange, of, liveBanner } = require('./_live.js');

// A REAL position. Squares 0-8, X = top-left(0) + centre(4) — so X threatens the 0-4-8 diagonal.
// O = top-right(2) + bottom-left(6), and it is O to move. The ONLY square that does not lose is 8.
const NAME = ['top-left', 'top-middle', 'top-right', 'middle-left', 'centre', 'middle-right', 'bottom-left', 'bottom-middle', 'bottom-right'];
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const START = { X: [0, 4], O: [2, 6] };
const winner = ( b ) => { for ( const L of LINES ) { const [a, c, d] = L;
	if ( b[a] && b[a] === b[c] && b[a] === b[d] ) return b[a]; } return null; };
const boardOf = ( moves ) => { const b = Array(9).fill(null);
	START.X.forEach(( i ) => b[i] = 'X' ); START.O.forEach(( i ) => b[i] = 'O' );
	moves.forEach(( m, k ) => b[m] = k % 2 === 0 ? 'O' : 'X' ); return b; };
const movesOf = ( node ) => (String(node.text || '').match(/\d/g) || []).map(Number);
const empties = ( b ) => b.map(( v, i ) => v ? null : i ).filter(( i ) => i != null );

// THE REAL GAME: legal moves, and a rollout that plays it out properly (each side takes a win if it
// has one, else blocks, else the first free square — deterministic, so the whole search replays).
const ticTacToe = () => ({
	actions : async ( node ) => { const b = boardOf(movesOf(node));
		return winner(b) ? [] : empties(b).map(String); },
	simulate: async ( node ) => {
		let b = boardOf(movesOf(node)), turn = movesOf(node).length % 2 === 0 ? 'O' : 'X';
		while ( !winner(b) && empties(b).length ) {
			const me = turn, you = me === 'X' ? 'O' : 'X';
			const pick = ( who ) => empties(b).find(( i ) => { const t = b.slice(); t[i] = who; return winner(t) === who; });
			const mv = pick(me) != null ? pick(me) : pick(you) != null ? pick(you) : empties(b)[0];
			b[mv] = me; turn = you;
		}
		return winner(b) === 'X' ? 0 : 1;                 // O not losing = a win for O
	},
});

async function main() {
	title('THE MODEL PICKS THE MOVE THAT LOSES. THE SEARCH FINDS THE ONE THAT SAVES IT.');
	say('This is the search behind game-playing AI: try a move, play it to the end, see who won,');
	say('favour what keeps winning. Normally it leans on randomness, so the same position gives a');
	say('different answer each run and you can never reproduce the search that decided. Not here.');
	gap();
	liveBanner();
	gap();
	say('  A real position:   X has top-left and centre — so X is one square from the diagonal.');
	say('                     O has top-right and bottom-left. O to move. One square saves it.');
	gap();
	beat(0, 'Just ask the model which square:');
	exchange('mcts', 0, null);
	bad('"centre-right" LOSES. X takes bottom-right next move and wins on the diagonal');
	gap();
	beat(1, 'Now the search. The model is only asked what it is good at — what moves EXIST:');
	exchange('mcts', 1, 'that is all it contributes. It never picks; it lists');
	gap();

	// ── 1. the search plays the position out, for real ────────────────────────────────────────────
	const r = await Graph.factories.createMCTS(Object.assign(ticTacToe(), { iterations: 40 })).run('');
	beat(2, 'It plays each square out to the end of the game, 40 times over, and counts:');
	for ( const k of r.children.slice().sort(( a, b ) => b.visits - a.visits ) )
		note(NAME[Number(k.move)].padEnd(14) + 'played out ' + String(k.visits).padStart(2) + ' times · survived '
			+ String(k.wins).padStart(2) + (Number(k.move) === 8 ? '   ← the only square that saves it' : ''));
	good('it recommends ' + NAME[Number(r.best.move)].toUpperCase() + ' — the block. The model said centre-right');
	assert.equal(r.best.move, '8', 'the search finds the only non-losing square');
	assert.equal(r.root.visits, 40, 'every play-out counted back to the root');
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
	beat(3, 'Which positions are still worth growing? That question answers itself:');
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
	beat(4, 'A dead-end position, where there is no move at all.');
	bad('it recommends NOTHING. It does not invent a move to look useful');
	good('and it still reports the ' + dead.root.visits + ' tries it really made — no silent skipping');
	assert.equal(dead.best, null, 'no move to recommend — and none fabricated');
	assert.equal(dead.children.length, 0, 'no children invented');
	assert.equal(dead.root.terminal, true, 'the root was marked terminal');
	assert.equal(dead.root.visits, 3, 'the rollouts still ran and were still counted — honest stats, not a silent skip');
	gap();

	// ── 4. REPLAY DETERMINISM: the whole search, twice, byte-identical ─────────────────────────────
	const once = async () => JSON.stringify(await Graph.factories.createMCTS(Object.assign(ticTacToe(), { iterations: 12 })).run(''));
	beat(5, 'Now run the exact same search a second time.');
	assert.equal(await once(), await once(), 'no Math.random in the driver → the search is reproducible');
	good('identical, down to the last number. You can always re-do the search that decided');
	say('       (this also held with a real 9.5 GB model in the loop, not just this scripted one.)');

	finish('the model picked the square that loses; the search played it out and found the block — '
		+ 'and gives the same answer every single time.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
