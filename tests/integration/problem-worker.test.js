'use strict';
/**
 * FLAGSHIP delegation to a PROCESS (2026-06-27): a problem-solving sub-graph is dispatched to a WORKER
 * THREAD that runs the problem-paths grammar (loaded from a provider FILE) and ships back only the
 * serialized snapshot. The one effect that can't cross the thread boundary — the model `ask` — is PROXIED
 * back to the parent. This is rung B (delegation) escalated from an in-process fork to a real OS thread:
 * a sub-agent reasons on its own thread while the parent stays the single model owner.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { solveInWorker, planFromSnapshot, stubAsk } = require('../../examples/poc/problem-worker.js');

test('a problem-solving sub-graph runs in a worker thread with the model PROXIED to the parent', async () => {
	let answered = 0;
	const parentAsk = async ( prompt ) => {           // the PARENT owns the model; the worker has none
		answered++;
		if ( prompt && /Summarize/.test(prompt.system || '') ) return 'WORKER PLAN';
		const m = /START: (.*)\nGOAL: (.*)/.exec((prompt && prompt.user) || '');
		return m ? `via-proxy ${m[1]}->${m[2]}` : 'via-proxy';
	};

	const r = await solveInWorker({ start: 0, goal: 5 }, parentAsk, { settleTimeout: 20000 });

	// the worker solved it and shipped back a plan.
	assert.equal(r.steps.length, 5, 'the worker resolved the 5-step chain');
	assert.equal(r.solution, 'WORKER PLAN', 'the worker synthesized the plan (via the proxied summarize call)');

	// PROXY: every model call the worker made was answered by THIS parent (the worker had no local model).
	assert.ok(answered >= 6, `the parent answered the proxied calls (got ${answered}: 5 resolves + 1 summarize)`);
	assert.equal(r.proxiedCalls, answered, 'the parent-side proxy count matches the worker-issued calls');

	// NEGATIVE CONTROL: the step TEXT came from THE PARENT's ask (round-tripped), not invented in the worker.
	assert.ok(r.steps.every(( s ) => /^via-proxy/.test(s)), 'every resolved step text round-tripped through the parent model');
	assert.equal(r.steps[0], 'via-proxy 0->1', 'the first step is the parent-produced text for the first bounded local context');
});

test('planFromSnapshot extracts the ordered path from a worker serialize() snapshot', () => {
	// a minimal synthetic snapshot (the serialize().graph shape: { conceptMaps:[facts...] }).
	const snap = { graph: JSON.stringify({ conceptMaps: [
		{ _id: 'S', Node: true, isStart: true },
		{ _id: 'G', Node: true, isGoal: true },
		{ _id: 'a', Segment: true, onPath: true, step: 'first', originNode: 'S', targetNode: 'm' },
		{ _id: 'b', Segment: true, onPath: true, step: 'second', originNode: 'm', targetNode: 'G' },
		{ _id: 'dead', Segment: true, onPath: false, step: 'pruned', originNode: 'S', targetNode: 'G' },
		{ _id: 'root', Root: true, solution: 'the plan' }
	] }) };
	const r = planFromSnapshot(snap);
	assert.deepEqual(r.steps, ['first', 'second'], 'walks onPath steps in order, skipping the pruned branch');
	assert.equal(r.solution, 'the plan', 'reads the root solution');
});
