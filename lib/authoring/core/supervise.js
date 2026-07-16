/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
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
 *   const { supervise } = require('../core/supervise.js');
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

/**
 * The supervisor as a REACTIVE concept flow (vs the host-orchestrated `supervise` loop).
 * Enabled by queued rollback (#11.c.4): a concept's provider can now trigger a rollback
 * mid-stabilize and it defers safely. The flow:
 *   Stuck ──require──▶ Supervise (hypothesizes a self-mod, records a rollback checkpoint)
 *   Supervise+hypothesized ──require──▶ Evaluate (the supervisor/better-model verdict)
 *   Evaluate, ensure verdict=='worse' ──▶ Revert (queued rollbackTo the checkpoint)
 *
 * Inject the policy (open R&D):
 *   opts.hypothesize(graph, scope)  — apply a self-mod; the added/patched fix MUST post
 *                                     `hypothesized: true` so Evaluate can fire after it lands
 *                                     (and `resolved: true` + `Stuck: null` if it solves it).
 *   opts.evaluate(graph, scope)     — return 'better' | 'worse' (the supervisor judgment).
 *
 * NOTE (open R&D): the rollback checkpoint is `graph._lastSettledRev` — the last clean
 * snapshot. A robust multi-attempt reactive loop (a checkpoint that holds the problem but
 * not the attempt, + strategy memory so retries differ) is the next research step; this
 * tree demonstrates the reactive wiring and the queued-rollback Revert path.
 */
function reactiveSupervisorTree() {
	// The GRAMMAR lives in FILES, not code (owner: no grammar hard-coded in JS) — the `_supervisor`
	// core set (concepts/_supervisor/, the `_substrate` convention: an engine-family set in files;
	// it moves out with a self-mod capacity plugin if/when that tranche happens). Loaded lazily so
	// this module costs no fs read unless the reactive supervisor is actually used. The Sup::*
	// providers stay factory-built (makeSupervisorProviders below); the grammar only names them.
	const { buildConceptTree } = require('../core/concepts.js');
	return buildConceptTree(require('path').join(__dirname, '..', '..', '..', 'concepts', '_supervisor'));
}

function makeSupervisorProviders( opts ) {
	var hypothesize = opts.hypothesize, evaluate = opts.evaluate;
	return { Sup: {
		propose: function ( graph, concept, scope, argz, cb ) {
			hypothesize(graph, scope);// a self-mod (queued); its fix posts `hypothesized:true`
			cb(null, { $_id: '_parent', Supervise: true, supRev: graph._lastSettledRev });
		},
		judge: function ( graph, concept, scope, argz, cb ) {
			cb(null, { $_id: '_parent', Evaluate: true, verdict: evaluate(graph, scope) });
		},
		revert: function ( graph, concept, scope, argz, cb ) {
			graph.rollbackTo(scope._.supRev);// queued (#11.c.4) -> applied at the quiescent boundary
			cb(null, { $_id: '_parent', Revert: true });
		}
	} };
}

module.exports = { supervise, nextStable, reactiveSupervisorTree, makeSupervisorProviders };
