'use strict';
/**
 * FLAGSHIP problem-paths (study 2026-06-26): a problem = a segment from a START state to a GOAL
 * state; concepts DECOMPOSE or RESOLVE each segment on its LOCAL context + the ADJACENT hand-off
 * (the previous resolved step) — decomposition inserts an intermediate STATE node and recurses; the
 * GOAL becoming `reached` triggers an IN-GRAPH bottom-up synthesis. Locks the engine mechanics
 * deterministically (stub numeric bisection, no LLM), each claim with a NEGATIVE CONTROL so the
 * assertions are not vacuous: every step sees only a local neighbourhood, never the whole problem.
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

test('ADJACENT hand-off: each step is resolved with the PREVIOUS resolved step as local context (reached chain)', async () => {
	const C = makeContent();
	const { graph, steps } = await solve({ start: 0, goal: 16 }, C);

	// the stub resolver ECHOES the hand-off it received: step = `from X to Y [after: <prev>]`. So if the
	// chain is genuinely live, each step literally contains the previous step's text (and the first
	// contains the seeded START hand-off). This is the non-vacuous proof the adjacency is consumed.
	assert.ok(steps.length >= 3, 'enough steps to test the chain');
	assert.match(steps[0], /after: start: 0/, 'the FIRST step consumed the seeded START hand-off');
	for ( let i = 1; i < steps.length; i++ ) {
		assert.ok(steps[i].includes(steps[i - 1]), `step ${i} consumed step ${i - 1} as its adjacent hand-off`);
	}

	// resolution happened in PATH ORDER (the cross-ref `originNode:reached` gate forces it): the order
	// of resolve() calls equals the START→GOAL walk order.
	const callOrderTargets = C.log.resolve.map((c) => c.to);
	const pathTargets = []; { let node = 'S'; const byOrigin = {}; for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Segment && e.step != null ) byOrigin[e.originNode] = e; } let g = 0; while ( node !== 'G' && g++ < 100 ) { const s = byOrigin[node]; if ( !s ) break; pathTargets.push(s.targetNode != null ? graph.getEtty(s.targetNode)._.state : null); node = s.targetNode; } }
	assert.deepEqual(callOrderTargets, pathTargets, 'resolve() fired in START→GOAL path order, not arbitrarily');

	// NEGATIVE CONTROL — non-vacuity: at least one resolve saw a REAL intermediate hand-off (not the seed),
	// i.e. the chain is more than one link.
	assert.ok(C.log.resolve.some((c) => c.prev && !/^start:/.test(c.prev)), 'a real mid-path hand-off was consumed, not only the seed');
});

test('IN-GRAPH synthesis: once GOAL is reached, the bounded plan is written onto the root segment', async () => {
	const C = makeContent();
	const { graph, steps, solution } = await solve({ start: 0, goal: 16 }, C);

	// the Summarize concept fired (in-graph), wrote `solution` + `stepCount` on the root, and ran exactly once.
	const root = graph.getEtty('root')._;
	assert.ok(root.Summarize, 'the Summarize concept cast on the root');
	assert.equal(root.stepCount, steps.length, 'the in-graph solution covers every step on the path');
	assert.equal(solution, root.solution, 'solve() returns the in-graph solution fact');
	assert.match(root.solution, /^Plan \(\d+ steps\)/, 'the bounded plan was synthesized from the path');
	assert.equal(C.log.summarize.length, 1, 'synthesis ran EXACTLY once (gated on GOAL.reached, not per-step)');

	// NEGATIVE CONTROL: the GOAL node really did become `reached` (the completion signal that gates Summarize).
	assert.ok(graph.getEtty('G')._.reached, 'the GOAL node was reached — the synthesis trigger is real');
});

// A deliberately TRAPPED problem: the higher-scored alternative dead-ends, the other is viable. The
// grammar must DETECT the dead-end, BACKTRACK to the untried alternative, and still reach the goal.
function trapContent() {
	const log = { resolved: [] };
	const C = {
		// only the root splits; it offers a TRAP midpoint (scored higher → chosen first) and a SAFE one.
		plan: async ({ from, to }) => (from === 'START' && to === 'GOAL')
			? { mids: [{ state: 'TRAP' }, { state: 'SAFE' }] } : { atomic: true },
		score: async ({ mid }) => (mid === 'TRAP' ? 10 : 5),
		// you can ENTER the trap but not LEAVE it: any step whose origin is TRAP is infeasible → Stuck.
		resolve: async ({ from, to }) => {
			log.resolved.push({ from, to });
			return from === 'TRAP' ? { stuck: true, why: 'cannot leave the trap' } : { step: `${from}→${to}` };
		},
		summarize: async ( steps ) => `Plan (${steps.length} steps): ` + steps.join(' → ')
	};
	C.log = log;
	return C;
}

test('BACKTRACK: a dead-ended best alternative is detected and the next-best is adopted, reaching the goal', async () => {
	const C = trapContent();
	const { graph, steps, solution } = await solve({ start: 'START', goal: 'GOAL' }, C);

	const root = graph.getEtty('root')._;
	// the trap was chosen first, dead-ended, a stuck signal bubbled up, and Reselect backtracked.
	// NOTE: Reselect is an ensure-gated ITERATIVE-TRIAL concept — it bumps `attempt` past `stuck.length`
	// and self-retracts so it can re-fire on the NEXT dead-end (finding #15). So its self-flag is
	// transient by design; the DURABLE proof it fired is the ledger it wrote (attempt/tried/chosen).
	assert.ok(root.stuck && root.stuck.length >= 1, 'a stuck signal bubbled to the deciding (root) segment');
	assert.ok((root.attempt || 1) >= 2, 'a backtrack occurred (the attempt counter was bumped)');
	assert.ok((root.tried || []).includes('TRAP'), 'the dead-ended TRAP alternative was recorded as tried');
	assert.equal(root.chosen, 'SAFE', 'the next-best untried alternative (SAFE) was adopted');

	// the LIVE path goes through SAFE and reaches the goal — the trap branch is OFF the path.
	assert.deepEqual(steps, ['START→SAFE', 'SAFE→GOAL'], 'the live resolved path routes around the trap to the goal');
	assert.ok(graph.getEtty('G')._.reached, 'the GOAL was reached despite the dead-end');
	assert.match(solution || '', /2 steps/, 'the in-graph synthesis ran over the recovered path');

	// the dead-end really happened (the segment into the trap is Stuck and pruned off the path).
	let trapStuck = 0, trapPruned = 0;
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( !e || !e.Segment ) continue; if ( e.Stuck ) trapStuck++; if ( e.cand && e.Stuck && !e.onPath ) trapPruned++; }
	assert.ok(trapStuck >= 1, 'the step out of the trap was marked Stuck');

	// NEGATIVE CONTROL (non-vacuity): the trap WAS actually entered and attempted before recovery —
	// i.e. this is a real backtrack, not a path that avoided the trap from the start.
	assert.ok(C.log.resolved.some((r) => r.from === 'START' && r.to === 'TRAP'), 'the trap branch was genuinely entered');
	assert.ok(C.log.resolved.some((r) => r.from === 'TRAP'), 'leaving the trap was genuinely attempted (and failed)');
});

// A DEEPER trap: the chosen sub-problem decomposes again, and BOTH of its alternatives dead-end. The
// inner deciding segment must EXHAUST its options and ESCALATE to its parent, which then routes around.
function escalateContent() {
	const C = {
		plan: async ({ from, to }) => {
			if ( from === 'START' && to === 'GOAL' ) return { mids: [{ state: 'M1' }, { state: 'M2' }] };  // M1 chosen first
			if ( from === 'M1' && to === 'GOAL' ) return { mids: [{ state: 'D1' }, { state: 'D2' }] };     // both dead-end
			return { atomic: true };
		},
		score: async ({ mid }) => ({ M1: 10, M2: 5, D1: 10, D2: 5 })[mid] || 0,
		resolve: async ({ from, to }) => (from === 'D1' || from === 'D2')
			? { stuck: true, why: 'dead-end' } : { step: `${from}→${to}` },     // you can't leave D1/D2
		summarize: async ( steps ) => `Plan (${steps.length} steps): ` + steps.join(' → ')
	};
	return C;
}

test('ESCALATION: an inner sub-problem exhausts all its alternatives and bubbles up; the parent re-routes', async () => {
	const { graph, steps } = await solve({ start: 'START', goal: 'GOAL' }, escalateContent());

	// the inner deciding segment (M1→GOAL) tried BOTH D1 and D2, exhausted, and escalated.
	let inner = null;
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Segment && e.Exhausted ) inner = e; }
	assert.ok(inner, 'an inner segment exhausted its alternatives');
	assert.ok((inner.tried || []).includes('D1') && (inner.tried || []).includes('D2'), 'both inner alternatives were tried before giving up');

	// the escalation reached the ROOT, which backtracked from M1 to M2.
	const root = graph.getEtty('root')._;
	assert.ok((root.tried || []).includes('M1'), 'the root learned its first route (via M1) was exhausted');
	assert.equal(root.chosen, 'M2', 'the root re-routed to the alternative (M2)');

	// the recovered live path reaches the goal around the doubly-dead sub-problem.
	assert.deepEqual(steps, ['START→M2', 'M2→GOAL'], 'the live path routes around the exhausted sub-problem');
	assert.ok(graph.getEtty('G')._.reached, 'the goal was reached after multi-level backtracking');
});
