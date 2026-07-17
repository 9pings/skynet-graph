/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — ReAct: think → act → observe, repeat until an answer.
 *
 * THE GUARANTEE SHOWN: **the pending tool-call list is not a list you maintain.** `NeedsAction` casts on
 * any step carrying a typed `actionTool`, and it UNCASTS the instant the observation lands. So "what tool
 * calls are outstanding?" is answered by reading which objects currently cast NeedsAction — a live worklist
 * maintained by the engine, not a queue you push and pop and eventually get out of sync.
 *
 * And the loop has THREE independent stops, any one of which halts it: the round budget, a final answer on
 * the session, and a one-successor null-guard (a step cannot fork the trajectory twice).
 *
 * WHO ACTS: the host. The tools, their side effects, and the model are all yours — deliberately outside the
 * grammar (that is the impure part). This plugin is the deposited control flow + the trajectory audit.
 * Tier-0 — pure grammar, zero JS. NOTE: the plugin's npm identity is `react-loop` (`react` is taken);
 * its concept SET is plain `react`.
 *
 * Deterministic, no model:  node examples/strategies/react.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');

const session = ( extra ) => Object.assign({ _id: 'ledger', isReactSession: true, maxRounds: 3, trace: [] }, extra || {});
const step = ( id, round, o ) => Object.assign({ _id: id, isThought: true, round, text: 'think' }, o);

async function main() {
	// ── 1. THE LIVE WORKLIST: a pending action is a cast; the observation retires it ───────────────
	const g = bootStrategy('react', { nodes: [session(), step('t0', 0, { actionTool: 'search', actionInput: 'q' })] });
	await g.settle();
	console.log('pending →', JSON.stringify({ needsAction: g.cast('t0', 'NeedsAction'), observed: g.cast('t0', 'Observed'), trace: g.fact('ledger', 'trace') }));
	assert.equal(g.cast('t0', 'NeedsAction'), true, 'a typed pending tool call IS the signal');

	await g.ingest({ t0: { observation: 'found it' } });                       // the host ran the tool, writes what it saw
	await g.settle();
	console.log('observed→', JSON.stringify({ needsAction: g.cast('t0', 'NeedsAction'), observed: g.cast('t0', 'Observed'), trace: g.fact('ledger', 'trace') }));
	assert.equal(g.cast('t0', 'NeedsAction'), false, 'the signal RETIRED ITSELF when the observation landed');
	assert.equal(g.cast('t0', 'Observed'), true, 'the step entered the trajectory');
	assert.deepEqual(g.fact('ledger', 'trace'), ['t0'], 'the trajectory IS the audit');
	g.close();

	// ── 2. THE THREE STOPS ────────────────────────────────────────────────────────────────────────
	const s = bootStrategy('react', {
		nodes: [
			session(),
			step('t0', 0, { actionTool: 'x', observation: 'o0' }),                // observed + budget left → Continue
			step('t1', 3, { actionTool: 'x', observation: 'o1' }),                // round == maxRounds → budget stop
			step('t2', 1, { actionTool: 'x', observation: 'o2', continued: 1 }),  // already spawned its successor
		],
	});
	await s.settle();
	for ( const id of ['t0', 't1', 't2'] ) console.log(id, '→ Continue:', s.cast(id, 'Continue'));
	assert.equal(s.cast('t0', 'Continue'), true, 'observed + budget + no successor → keep going');
	assert.equal(s.cast('t1', 'Continue'), false, 'stop 1 — the round budget: no runaway loop');
	assert.equal(s.cast('t2', 'Continue'), false, 'stop 2 — the null-guard: a step continues once, never forks');
	s.close();

	const done = bootStrategy('react', { nodes: [session({ finalAnswer: '42' }), step('t0', 0, { actionTool: 'x', observation: 'o' })] });
	await done.settle();
	console.log('final   →', JSON.stringify({ done: done.cast('ledger', 'Done'), continue: done.cast('t0', 'Continue') }));
	assert.equal(done.cast('ledger', 'Done'), true, 'the session is terminal');
	assert.equal(done.cast('t0', 'Continue'), false, 'stop 3 — a final answer halts the loop STRUCTURALLY');
	done.close();

	// ── 3. NEGATIVE CONTROL: no forced tool calls, no phantom trace entries ────────────────────────
	const n = bootStrategy('react', { nodes: [session(), step('t0', 0), step('t1', 1, { actionTool: 'x' })] });
	await n.settle();
	console.log('neg     →', JSON.stringify({ pureThoughtActs: n.cast('t0', 'NeedsAction'), trace: n.fact('ledger', 'trace'), done: n.cast('ledger', 'Done') }));
	assert.equal(n.cast('t0', 'NeedsAction'), false, 'a pure reasoning step is legitimate — nothing forces a tool call');
	assert.deepEqual(n.fact('ledger', 'trace'), [], 'an unobserved step never enters the trace');
	n.close();

	// ── 4. the loop, driven for real ───────────────────────────────────────────────────────────────
	// The production shape: read the worklist off the graph, run those tools, write the observations,
	// continue while the graph says to. The host never tracks "what's pending" — it asks.
	const TOOLS = { search: ( q ) => 'results for ' + q, calc: ( q ) => 'the answer is ' + q.length };
	const L = bootStrategy('react', { nodes: [session(), step('r0', 0, { actionTool: 'search', actionInput: 'skynet' })] });
	await L.settle();
	const ids = ['r0'];
	for ( let guard = 0; guard < 10; guard++ ) {
		const pending = ids.filter(( id ) => L.cast(id, 'NeedsAction') );        // ← the live worklist, read off the graph
		if ( !pending.length ) break;
		for ( const id of pending ) {                                            // run the host's real tools
			const tool = TOOLS[L.fact(id, 'actionTool')];
			await L.ingest({ [id]: { observation: tool(L.fact(id, 'actionInput')) } });
		}
		await L.settle();
		const last = ids[ids.length - 1];
		if ( !L.cast(last, 'Continue') ) break;                                  // the graph decides when to stop, not the host
		const round = L.fact(last, 'round') + 1;                                 // the graph said continue → think again
		const next = 'r' + round;
		await L.ingest({ [last]: { continued: 1 },
			[next]: { isThought: true, round, text: 'think', actionTool: 'calc', actionInput: 'xyz' } });
		await L.settle();
		ids.push(next);
	}
	await L.ingest({ ledger: { finalAnswer: 'done' } });                        // the host concludes
	await L.settle();
	console.log('driven  →', JSON.stringify({ trace: L.fact('ledger', 'trace'), done: L.cast('ledger', 'Done'), stillPending: ids.filter(( id ) => L.cast(id, 'NeedsAction') ) }));
	assert.deepEqual(L.fact('ledger', 'trace'), ids, 'every acted step is on the trajectory, in order');
	assert.deepEqual(ids.filter(( id ) => L.cast(id, 'NeedsAction') ), [], 'the worklist drained itself — nothing left pending');
	assert.equal(L.cast('ledger', 'Done'), true);
	L.close();

	console.log('STRATEGY OK — the pending tool-call list is a live cast set (it retires itself on the observation); three independent stops bound the loop');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
