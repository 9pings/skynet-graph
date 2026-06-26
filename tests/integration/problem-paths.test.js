'use strict';
/**
 * FLAGSHIP problem-paths (study 2026-06-26): a problem = a segment from a START state to a GOAL
 * state; concepts DECOMPOSE or RESOLVE each segment on its LOCAL context (origin state, target
 * state, parent) — decomposition inserts an intermediate STATE node and recurses — then the
 * start→goal PATH is walked and summarized. Locks the engine mechanics deterministically (the stub
 * numeric bisection, no LLM): every step sees only a local neighbourhood, never the whole problem.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { solve, makeContent, pathSteps } = require('../../examples/poc/problem-paths.js');

test('a problem decomposes into a contiguous start→goal path of locally-resolved atomic steps', async () => {
	const { graph, steps } = await solve({ start: 0, goal: 16 }, makeContent());

	// the path is contiguous from START to GOAL (each step's target is the next step's origin)
	assert.ok(steps.length >= 2, 'the problem decomposed into multiple steps');
	const walk = pathSteps(graph, 'S', 'G');
	assert.deepEqual(walk, steps);

	// the decomposition created intermediate STATE nodes between start and goal (not one giant leap)
	let nodes = 0; for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Node && e.state != null ) nodes++; }
	assert.ok(nodes > 2, `intermediate states were inserted (got ${nodes} state nodes)`);

	// every resolved segment is atomic and carries a step derived from its local origin/target states
	let resolved = 0;
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Segment && e.step != null ) { resolved++; assert.ok(e.Atomic, 'a resolved segment is atomic'); } }
	assert.ok(resolved >= 2, 'multiple atomic segments were resolved on local context');
});

test('best-path selection: alternatives are proposed, the best is chosen, the rest are pruned', async () => {
	const { graph } = await solve({ start: 0, goal: 16 }, makeContent());   // ALTS=2 by default
	let decomposed = 0, chosen = 0, candidates = 0, prunedCand = 0;
	for ( const id in graph._objById ) {
		const e = graph._objById[id]._etty._; if ( !e || !e.Segment ) continue;
		if ( e.Decomposed ) decomposed++;
		if ( e.chosen != null ) chosen++;                 // the Select concept fired here
		if ( e.cand ) { candidates++; if ( !e.onPath ) prunedCand++; }
	}
	assert.ok(decomposed >= 1, 'the problem was decomposed');
	assert.equal(chosen, decomposed, 'every decomposed segment ran SELECT (Propose→Select→Adopt)');
	assert.ok(candidates > 2 * chosen, 'more candidate segments existed than the chosen path used — i.e. real alternatives');
	assert.ok(prunedCand > 0, 'some alternatives were PRUNED (not on the best path)');
});
