'use strict';
/**
 * Controller-P0 — the request/response bridge. `Session.ask(text)` lifts the event-based decompose→
 * synthesize answer loop into a PROMISE (so a CLI / MCP / small-LLM driver can `await` a reasoning
 * appliance), and `Graph.settle(g)` is the first-class settle verb. Hermetic: the "LLM" is an injected
 * stub `ask` routed on the prompt (no network), so this tests the BRIDGE mechanics, not model quality.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const Session = require('../../lib/studio/session.js');
console.log = console.info = console.warn = () => {};

// a deterministic "model": route on the French system prompts the loop uses.
function stubAsk() {
	const calls = { eval: 0, expand: 0, answer: 0, rollup: 0 };
	const ask = async ( { system } ) => {
		if ( /ATOMIQUE/.test(system) )        { calls.eval++;   return '{"atomic":false}'; }             // force a split at the root
		if ( /découpes une étape/.test(system) ) { calls.expand++; return '{"steps":[{"name":"A","description":"a"},{"name":"B","description":"b"}]}'; }
		if ( /étape atomique/.test(system) )  { calls.answer++; return 'leaf answer'; }                  // a leaf answer (plain text)
		if ( /synthétises/.test(system) )     { calls.rollup++; return 'SYNTH(' + '…' + ')'; }           // the bounded rollup
		return '{}';
	};
	return { ask, calls };
}

test('Session.answer resolves with the synthesized answer (event loop lifted to a promise)', async () => {
	const { ask, calls } = stubAsk();
	const s = new Session('t', { Graph, ask });
	const progress = [];
	s.on('promptProgress', ( m ) => progress.push(m.kind));

	const { answer, state } = await s.answer('why does X fail?', { maxDepth: 1, timeout: 20000 });

	assert.equal(typeof answer, 'string');
	assert.ok(answer.startsWith('SYNTH('), 'the answer is the bounded rollup the loop produced');
	assert.ok(calls.expand >= 1, 'the root was decomposed');
	assert.ok(calls.answer >= 2, 'the two leaves were answered');
	assert.ok(progress.includes('expand') && progress.includes('answer') && progress.includes('rollup'),
		'progress events streamed while awaiting (expand/answer/rollup)');
	assert.ok(Array.isArray(state.objects) && state.objects.length > 0, 'settled state returned alongside the answer');
});

test('Session.answer rejects when no LLM backend is wired (fail-fast, not a hang)', async () => {
	const s = new Session('t', { Graph });                    // no ask
	await assert.rejects(() => s.answer('anything', { timeout: 5000 }), /needs an LLM backend/);
});

test('Graph.settle(g) is a promise that resolves on the next settle (the first-class verb)', async () => {
	// a trivial graph with no concepts: pushing a node settles; Graph.settle awaits it.
	const g = new Graph({ lastRev: 0, nodes: [{ _id: 'a' }], segments: [] },
		{ isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {} }, { common: { childConcepts: {} } });
	await Graph.settle(g);                                     // resolves (already quiescent or on settle)
	g.pushMutation({ _id: 'b', label: 'added' });
	await Graph.settle(g);
	assert.ok(g._objById['b'], 'the mutation applied and settle resolved after it');
});
