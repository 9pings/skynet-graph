'use strict';
/**
 * Roadmap #11.c.3 — the hypothesis-and-test self-modification regime (capstone of #11).
 *
 * Design constraints from the engine author (2026-06-21):
 *   - `Stuck` is a HUMAN-VOCABULARY fact (part of the semantic/hierarchical concept org),
 *     not an ad-hoc engine flag;
 *   - the "is it worse?" decision is NOT an engine metric — budget-spent is only the
 *     TRIGGER; the judgment is *supervisor* information rendered by a higher-level concept
 *     with a better model → the evaluator is an INJECTED hook;
 *   - strategies are plural / open R&D → hypothesize + evaluate are INJECTED (pluggable),
 *     not hard-coded.
 *
 * The regime composes the now-complete safe instruments (zero new core): a `Stuck`
 * sub-problem → the supervisor HYPOTHESIZES a self-mod (add/patchConcept) → the graph
 * re-stabilizes → the supervisor EVALUATES (better model) → if worse, `rollbackTo` the
 * pre-hypothesis rev (safe: N6 restores the concept-lib edit too, so a bad hypothesis
 * leaves NO trace) → repeat until resolved. The apply-ceiling backstop (#11.c.1) guards
 * the supervisor itself.
 *
 * This test drives the full loop OFFLINE: a bad hypothesis is reverted (concept gone via
 * N6), a good one is kept and resolves the problem.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { supervise } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

const seg = (g) => g._objById['seg']._etty;

function bootGraph(label, conceptMap) {
	Graph._providers = {};
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		// the sub-problem segment is Stuck (human-vocabulary fact) and not yet resolved
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 }, Stuck: true }]
	};
	return new Promise((resolve) => {
		const g = new Graph(seed, {
			label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, applyCap: 50,
			onStabilize() { if (!g.__booted) { g.__booted = true; resolve(g); } }
		}, conceptMap);
	});
}

test('#11.c.3 hypothesis-and-test resolves a Stuck sub-problem: bad hypothesis reverted (N6), good one kept', async () => {
	const g = await bootGraph('supervise', { common: { childConcepts: {} } });
	assert.equal(seg(g)._.Stuck, true, 'seg starts Stuck');

	// the supervisor sees a Stuck, unresolved segment (budget-spent would be the real trigger)
	const detectStuck = (graph) => (graph._objById['seg']._etty._.Stuck && !graph._objById['seg']._etty._.resolved)
		? 'seg' : null;

	// pluggable STRATEGY: attempt 0 proposes a fix that does NOT resolve (a dead end),
	// attempt 1 proposes a concept that posts `resolved`.
	const hypothesize = (graph, stuckId, ctx) => {
		if (ctx.attempt === 0)
			graph.addConcept(null, { _id: 'BadFix', _name: 'BadFix', require: 'Stuck',
				applyMutations: [{ $_id: '_parent', BadFix: true, note: 'dead-end' }] });
		else
			graph.addConcept(null, { _id: 'GoodFix', _name: 'GoodFix', require: 'Stuck',
				applyMutations: [{ $_id: '_parent', GoodFix: true, resolved: true }] });
		return ctx.attempt === 0 ? 'BadFix' : 'GoodFix';
	};

	// the SUPERVISOR judgment (a "better model" hook): better iff the segment is now resolved.
	const evaluate = (graph) => ({ better: graph._objById['seg']._etty._.resolved === true });

	const res = await supervise(g, { detectStuck, hypothesize, evaluate, maxAttempts: 4 });

	assert.equal(res.resolved, true, 'the Stuck problem was resolved');
	assert.equal(seg(g)._.resolved, true, 'seg.resolved holds in the final state');

	// the bad hypothesis left NO trace (N6 rollback removed the concept AND its fact)
	assert.ok(!g._conceptLib['BadFix'], 'the reverted hypothesis concept is gone from the lib');
	assert.ok(!seg(g)._.BadFix, 'the reverted hypothesis left no fact');
	// the good hypothesis was kept
	assert.ok(g._conceptLib['GoodFix'], 'the accepted hypothesis concept is kept');

	const outcomes = res.attempts.map((a) => a.outcome);
	assert.deepEqual(outcomes, ['reverted', 'kept'], 'bad attempt reverted, good attempt kept');
});

test('#11.c.3 supervise reports unresolved when no hypothesis works within maxAttempts', async () => {
	const g = await bootGraph('supervise-fail', { common: { childConcepts: {} } });
	const detectStuck = (graph) => graph._objById['seg']._etty._.resolved ? null : 'seg';
	let n = 0;
	const hypothesize = (graph) => {
		const id = 'Try' + (n++);
		graph.addConcept(null, { _id: id, _name: id, require: 'Stuck',
			applyMutations: [{ $_id: '_parent', [id]: true }] });   // never resolves
		return id;
	};
	const evaluate = () => ({ better: false });   // supervisor always judges worse -> always reverts

	const res = await supervise(g, { detectStuck, hypothesize, evaluate, maxAttempts: 3 });
	assert.equal(res.resolved, false, 'not resolved');
	assert.equal(res.attempts.length, 3, 'tried maxAttempts');
	assert.ok(res.attempts.every((a) => a.outcome === 'reverted'), 'every failed hypothesis reverted');
	// all reverted -> the lib is clean (no Try* concept survived)
	assert.ok(!Object.keys(g._conceptLib).some((k) => k.startsWith('Try')), 'no failed hypothesis survived in the lib');
});
