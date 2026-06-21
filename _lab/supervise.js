'use strict';
/**
 * Hypothesis-and-test self-modification regime (roadmap #11.c.3, doc/MODELISATION.md
 * §6.4) — the capstone of #11. Zero core change: it composes the now-complete safe
 * instruments — re-entrant `add`/`patchConcept` (#11.a), the apply-ceiling backstop
 * (#11.c.1), and concept-lib-versioned `rollbackTo` (#11.c.2 / N6) — into a supervised
 * loop that may *try* a self-modification and cleanly *undo* it if it doesn't help.
 *
 * Design (per the engine author):
 *   - `Stuck` is a human-vocabulary fact (a sub-problem that exhausted its strategies /
 *     blew its budget) — the loop's TRIGGER, surfaced by `detectStuck`;
 *   - the "is it better / worse?" call is NOT an engine metric. Budget-spent is only the
 *     trigger; the judgment is a *supervisor* decision rendered by a higher-level concept
 *     with a better model → injected as `evaluate` (the better-model hook);
 *   - the repair STRATEGY is open R&D / plural → injected as `hypothesize`. Different
 *     strategies plug in here without touching the loop.
 *
 * The loop is HOST-orchestrated because `rollbackTo` must run at a quiescent boundary
 * (it re-mounts; it is not queued like add/patchConcept). A fully-reactive supervisor
 * concept (with queued rollback) is the next R&D step.
 *
 *   const { supervise } = require('./supervise');
 *   const res = await supervise(graph, {
 *     detectStuck: (g) => <stuckId|null>,                         // the trigger (Stuck fact / budget)
 *     hypothesize: async (g, stuckId, ctx) => { ...self-mod...; return <label> },  // a strategy
 *     evaluate:    async (g, stuckId, hyp) => ({ better: <bool>, ... }),           // the supervisor model
 *     maxAttempts: 5,
 *   });
 *   // res = { resolved, attempts: [{ hyp, outcome:'kept'|'reverted', verdict }] }
 */

// Await the next settle, or resolve immediately if the graph is already quiescent
// (finding #13: `stabilize(cb)` only fires `cb` on an actual settle — a no-op has none).
function nextStable( graph ) {
	return new Promise(function ( resolve ) {
		var done = false;
		var fin = function () { if ( !done ) { done = true; resolve(); } };
		graph.stabilize(fin);
		if ( !graph._unstable.length && !graph._triggeredCastCount ) setTimeout(fin);
	});
}

async function supervise( graph, spec ) {
	var detectStuck = spec.detectStuck;
	var hypothesize = spec.hypothesize;
	var evaluate    = spec.evaluate;
	var maxAttempts = spec.maxAttempts || 5;
	var attempts    = [];

	await nextStable(graph);

	for ( var i = 0; i < maxAttempts; i++ ) {
		var stuck = detectStuck(graph);
		if ( !stuck ) return { resolved: true, attempts: attempts };

		// checkpoint BEFORE the hypothesis: the snapshot captured at the last settle, keyed
		// by this rev, carries both the facts AND the concept-lib (N6) — so a rollback here
		// fully undoes whatever the hypothesis adds/patches.
		var rev = graph.getCurrentRevision();

		var hyp = await hypothesize(graph, stuck, { attempt: i, attempts: attempts });
		await nextStable(graph);                       // apply the hypothesis (its self-mod re-stabilizes)

		var verdict = await evaluate(graph, stuck, hyp);
		if ( verdict && verdict.better ) {
			attempts.push({ hyp: hyp, outcome: 'kept', verdict: verdict });
		} else {
			graph.rollbackTo(rev);                     // safe at this quiescent boundary; N6 restores rules too
			await nextStable(graph);
			attempts.push({ hyp: hyp, outcome: 'reverted', verdict: verdict });
		}
	}

	return { resolved: !detectStuck(graph), attempts: attempts };
}

module.exports = { supervise, nextStable };
