'use strict';
/**
 * FLAGSHIP typed-domain corpus (2026-06-26): a domain vocabulary (ordered `kind` enum) + named
 * transition operators GROUND the generic problem-paths search — the corpus carries the structure so
 * the LLM is only spent on genuine gaps. The deterministic measurement (the K6 question the docs flag):
 * an in-vocabulary problem is solved by the SAME engine at ZERO LLM cost; a missing operator escalates
 * to the LLM on exactly one segment. No prose ever keys a move (canonicalization barrier): the operators
 * cast on `originKind → targetKind` enums.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { solve, pathSteps } = require('../../examples/poc/problem-paths.js');
const { makeDomainContent, LABEL, ACTIONS } = require('../../examples/poc/problem-domain.js');

const FULL = ['legacy>modular', 'modular>tested', 'tested>documented', 'documented>packaged', 'packaged>published'].map((k) => ACTIONS[k]);

test('GROUNDED: an in-vocabulary problem is solved at ZERO LLM cost — the corpus carries every move', async () => {
	const C = makeDomainContent({ llm: () => { throw new Error('LLM must not be called for an in-vocabulary problem'); } });
	const { graph, steps, solution } = await solve(
		{ start: LABEL.legacy, startKind: 'legacy', goal: LABEL.published, goalKind: 'published' },
		C, { maxDepth: 16, alts: 1, label: 'domain-test' });

	// the whole canonical pipeline was produced deterministically, in order, by the engine's search.
	assert.deepEqual(steps, FULL, 'the resolved path is the 5 named domain transitions in chain order');
	assert.equal(C.stats.calls, 0, 'NO LLM escalation happened — the corpus grounded the entire search');
	assert.equal(C.stats.deterministic, 5, 'all 5 moves were resolved by deterministic domain operators');
	assert.match(solution || '', /5 steps/, 'the in-graph synthesis ran over the grounded path');

	// the intermediate STATES the engine inserted are TYPED (a `kind` enum), not free prose — the
	// canonicalization barrier holds end-to-end (every hop is keyed on a discrete kind).
	let typedStates = 0, untypedStates = 0;
	for ( const id in graph._objById ) { const e = graph._objById[id]._etty._; if ( e && e.Node && e.state != null ) { if ( e.kind ) typedStates++; else untypedStates++; } }
	assert.ok(typedStates >= 5, `the route is typed end-to-end (got ${typedStates} kinded states)`);
	assert.equal(untypedStates, 0, 'no untyped intermediate state leaked into a fully in-vocabulary route');
});

test('ESCALATION-AT-THE-GAP: a missing operator falls back to the LLM on exactly ONE segment', async () => {
	let llmSeen = [];
	const C = makeDomainContent({
		omit: { 'tested>documented': true },                       // knock out one known operator
		llm : async ( ctx ) => { llmSeen.push([ctx.originKind, ctx.targetKind]); return 'BRIDGED: generate API docs from the tested modules'; }
	});
	const { steps } = await solve(
		{ start: LABEL.legacy, startKind: 'legacy', goal: LABEL.published, goalKind: 'published' },
		C, { maxDepth: 16, alts: 1, label: 'domain-gap' });

	// exactly one escalation, precisely at the knocked-out transition; everything else deterministic.
	assert.equal(C.stats.calls, 1, 'exactly ONE LLM escalation (the single gap)');
	assert.equal(C.stats.deterministic, 4, 'the other four moves stayed deterministic');
	assert.deepEqual(llmSeen, [['tested', 'documented']], 'the escalation happened at the missing operator, not elsewhere');

	// the path is still complete START→GOAL, with the bridged step slotted in at the gap.
	assert.equal(steps.length, 5, 'the path is still the full 5-step pipeline');
	assert.equal(steps[2], 'BRIDGED: generate API docs from the tested modules', 'the LLM-bridged step occupies the gap, in order');
	assert.equal(steps[0], ACTIONS['legacy>modular'], 'the steps around the gap stayed deterministic');
	assert.equal(steps[4], ACTIONS['packaged>published'], 'the tail of the pipeline stayed deterministic');
});
