'use strict';
/**
 * Declarative AI-authoring as CEGIS (roadmap #10, MODELISATION §6.5). The authoring
 * loop synthesizes a concept that satisfies a GOAL, using two oracles:
 *   - author-time oracle  = the validator (validateConceptTree): a malformed candidate
 *     is rejected BEFORE it touches the graph, and the rejection is a counterexample;
 *   - behavioral oracle   = the live graph: install via addConcept/patchConcept,
 *     stabilize, then test the goal predicate; an unmet goal is a counterexample.
 * Each counterexample is fed back to the proposer (an LLM in production; a deterministic
 * stub here) → the candidate space strictly shrinks → convergence.
 *
 * This test drives the full loop OFFLINE with a stub proposer that walks the three
 * feedback paths: (0) a malformed candidate is REJECTED by the validator, (1) a
 * well-formed but too-strict candidate INSTALLS but leaves the goal UNMET, (2) a patch
 * loosening it MEETS the goal.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
const { authorConcept } = require('../../_lab/author.js');
console.log = console.info = console.warn = () => {};

// Build a graph with one segment (Distance 400) and wait for the first stabilize.
function bootGraph(label) {
	Graph._providers = {};
	const conceptMap = { common: { childConcepts: {} } };
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};
	return new Promise((resolve) => {
		const g = new Graph(seed, {
			label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (!g.__booted) { g.__booted = true; resolve(g); } }
		}, conceptMap);
	});
}

test('CEGIS authoring converges: reject malformed -> install too-strict -> patch to meet goal', async () => {
	const g = await bootGraph('cegis-converge');
	const seg = () => g._objById['seg']._etty;
	assert.ok(!seg()._.Far, 'goal not met at start');

	// goal: segment seg ends up carrying the Far fact.
	const goal = (graph) => {
		const met = graph._objById['seg']._etty._.Far === true;
		return { met, counterexample: met ? null : 'seg.Distance.inKm=400 did not produce Far' };
	};

	// deterministic stub proposer: three scripted moves, reading `history` to prove
	// the counterexamples are threaded back.
	const seen = [];
	const propose = async ({ history, round }) => {
		seen.push(history.length);
		if (round === 0)
			// malformed: unparseable ensure -> validator rejects (never installed)
			return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', ensure: ['$Distance.inKm ==== ('] } };
		if (round === 1)
			// well-formed but too strict: 400 is not > 500 -> installs, goal unmet
			return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 500'] } };
		// patch loosening the threshold -> 400 > 300 -> goal met
		return { op: 'patch', nameOrId: 'Far', updates: { assert: ['$Distance.inKm > 300'] } };
	};

	const res = await authorConcept(g, {
		goal, propose, goalDescription: 'segment should be Far',
		validate: { knownFacts: ['Distance', 'Segment'], palette: [] },
		maxRounds: 5
	});

	assert.equal(res.ok, true, 'authoring converged');
	assert.equal(res.concept, 'Far');
	assert.equal(seg()._.Far, true, 'the goal actually holds in the graph');

	// the three feedback paths, in order
	assert.equal(res.rounds.length, 3);
	assert.equal(res.rounds[0].outcome, 'rejected');
	assert.match(res.rounds[0].counterexample, /unparseable|parse/i);
	assert.equal(res.rounds[1].outcome, 'unmet');
	assert.match(res.rounds[1].counterexample, /Far/);
	assert.equal(res.rounds[2].outcome, 'met');

	// the proposer saw a growing history (counterexamples threaded back each round)
	assert.deepEqual(seen, [0, 1, 2]);
});

test('CEGIS reports failure when the goal is not met within maxRounds', async () => {
	const g = await bootGraph('cegis-exhaust');
	const goal = (graph) => ({ met: graph._objById['seg']._etty._.Far === true, counterexample: 'still not Far' });

	// proposer only ever offers too-strict candidates (add then patch, both > 500)
	const propose = async ({ round }) => {
		if (round === 0) return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 500'] } };
		return { op: 'patch', nameOrId: 'Far', updates: { assert: ['$Distance.inKm > 600'] } };
	};

	const res = await authorConcept(g, { goal, propose, validate: { knownFacts: ['Distance'] }, maxRounds: 2 });
	assert.equal(res.ok, false, 'did not converge');
	assert.match(res.reason, /exhaust|maxRounds/i);
	assert.equal(res.rounds.length, 2);
	assert.ok(res.rounds.every((r) => r.outcome === 'unmet'));
});
