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
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');
const { exchange, of, liveBanner } = require('./_live.js');

const session = ( extra ) => Object.assign({ _id: 'ledger', isReactSession: true, maxRounds: 3, trace: [] }, extra || {});
const step = ( id, round, o ) => Object.assign({ _id: id, isThought: true, round, text: 'think' }, o);

async function main() {
	title('THE TO-DO LIST OF PENDING TOOL CALLS — THAT NOBODY MAINTAINS');
	say('When a model uses tools, something has to remember which calls are still waiting for an');
	say('answer. Normally you write that bookkeeping yourself, and it drifts out of sync.');
	say('Here nobody writes it. Watch the list keep itself.');
	gap();
	liveBanner();
	gap();
	beat(0, 'A real question, put to a real model that has two tools available:');
	exchange('react', 0, 'it asked for a tool and an input — THAT is what goes on the list');
	exchange('react', 1, 'we ran the tool, wrote down the answer, and it moved on by itself');
	exchange('react', 2, 'both numbers in hand, it reaches for the calculator');
	good('three real calls, three usable tool requests, no hand-holding');
	gap();
	say('  Now the graph side of the same loop:');

	// ── 1. THE LIVE WORKLIST: a pending action is a cast; the observation retires it ───────────────
	const g = bootStrategy('react', { nodes: [session(), step('t0', 0, { actionTool: 'search', actionInput: 'q' })] });
	await g.settle();
	beat(1, 'The model says: "search for q".');
	note('that call is now marked PENDING — it put itself on the list');
	assert.equal(g.cast('t0', 'NeedsAction'), true, 'a typed pending tool call IS the signal');

	await g.ingest({ t0: { observation: 'found it' } });                       // the host ran the tool, writes what it saw
	await g.settle();
	beat(2, 'We run the search and write down what we found.');
	good('the PENDING mark removed itself. We never crossed it off');
	good('the step joined the trail of what actually happened');
	assert.equal(g.cast('t0', 'NeedsAction'), false, 'the signal RETIRED ITSELF when the observation landed');
	assert.equal(g.cast('t0', 'Observed'), true, 'the step entered the trajectory');
	assert.deepEqual(g.fact('ledger', 'trace'), ['t0'], 'the trajectory IS the audit');
	g.close();
	gap();

	// ── 2. THE THREE STOPS ────────────────────────────────────────────────────────────────────────
	say('A tool loop that never stops is the classic way to burn a budget. Three separate things');
	say('stop this one, and any of them is enough:');
	const s = bootStrategy('react', {
		nodes: [
			session(),
			step('t0', 0, { actionTool: 'x', observation: 'o0' }),                // observed + budget left → Continue
			step('t1', 3, { actionTool: 'x', observation: 'o1' }),                // round == maxRounds → budget stop
			step('t2', 1, { actionTool: 'x', observation: 'o2', continued: 1 }),  // already spawned its successor
		],
	});
	await s.settle();
	const rule = ( when, then ) => when.padEnd(40) + '→ ' + then;
	good(rule('a step with budget left, and work to do', 'keeps going'));
	bad(rule('a step that has spent its round budget', 'stops. No runaway loop'));
	bad(rule('a step that already has a follow-up', 'stops. It cannot fork the trail'));
	assert.equal(s.cast('t0', 'Continue'), true, 'observed + budget + no successor → keep going');
	assert.equal(s.cast('t1', 'Continue'), false, 'stop 1 — the round budget: no runaway loop');
	assert.equal(s.cast('t2', 'Continue'), false, 'stop 2 — the null-guard: a step continues once, never forks');
	s.close();

	const d = bootStrategy('react', { nodes: [session({ finalAnswer: '42' }), step('t0', 0, { actionTool: 'x', observation: 'o' })] });
	await d.settle();
	bad(rule('a session that has its final answer', 'stops. The loop is over'));
	assert.equal(d.cast('ledger', 'Done'), true, 'the session is terminal');
	assert.equal(d.cast('t0', 'Continue'), false, 'stop 3 — a final answer halts the loop STRUCTURALLY');
	d.close();
	gap();

	// ── 3. NEGATIVE CONTROL: no forced tool calls, no phantom trace entries ────────────────────────
	say('Two things it refuses to do, which is how you know the list means something:');
	const n = bootStrategy('react', { nodes: [session(), step('t0', 0), step('t1', 1, { actionTool: 'x' })] });
	await n.settle();
	bad('a step that is just thinking is never pushed into calling a tool');
	bad('a call with no answer yet never counts as something that happened');
	assert.equal(n.cast('t0', 'NeedsAction'), false, 'a pure reasoning step is legitimate — nothing forces a tool call');
	assert.deepEqual(n.fact('ledger', 'trace'), [], 'an unobserved step never enters the trace');
	n.close();
	gap();

	// ── 4. the loop, driven for real ───────────────────────────────────────────────────────────────
	// The production shape: read the worklist off the graph, run those tools, write the observations,
	// continue while the graph says to. The host never tracks "what's pending" — it asks.
	say('Now the whole loop, for real. We never track what is pending — we ask, and we answer:');
	const TOOLS = { search: ( q ) => 'results for ' + q, calc: ( q ) => 'the answer is ' + q.length };
	const L = bootStrategy('react', { nodes: [session(), step('r0', 0, { actionTool: 'search', actionInput: 'skynet' })] });
	await L.settle();
	const ids = ['r0'];
	for ( let guard = 0; guard < 10; guard++ ) {
		const pending = ids.filter(( id ) => L.cast(id, 'NeedsAction') );        // ← the live worklist, read off the graph
		if ( !pending.length ) break;
		for ( const id of pending ) {                                            // run the host's real tools
			const tool = TOOLS[L.fact(id, 'actionTool')];
			note('waiting on: ' + L.fact(id, 'actionTool') + '("' + L.fact(id, 'actionInput') + '")  → we run it, and write the answer down');
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
	gap();
	val('steps taken', L.fact('ledger', 'trace').length + ' — in order, kept as the trail of what happened');
	val('still pending', ids.filter(( id ) => L.cast(id, 'NeedsAction') ).length + ' — the list emptied itself');
	val('stopped because', 'the round budget ran out (stop #1 of 3)');
	assert.deepEqual(L.fact('ledger', 'trace'), ids, 'every acted step is on the trajectory, in order');
	assert.deepEqual(ids.filter(( id ) => L.cast(id, 'NeedsAction') ), [], 'the worklist drained itself — nothing left pending');
	assert.equal(L.cast('ledger', 'Done'), true);
	L.close();

	finish('you never keep the list of pending calls — you ask, and it is always right.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
