'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * reason-kernel providers — the LEDGER bricks, generic + deterministic (0-LLM), shared by any reasoning
 * strategy that accumulates a decidable count (critical-mind's pro/con sides, self-consistency's votes, …):
 *   Ledger::tally   — append an entry to ledger[side]        (accumulate)
 *   Ledger::untally — append it to ledger[side+'Retracted']  (retract; cleaner — native cascade for free)
 *   Ledger::decide  — the k-ary decidability BOUND: majority + top-2 margin over a votes array → verdict
 *                     iff margin >= threshold, else UNDECIDED (§9.3's "MarginGate becomes the shared gate")
 * The active count of a side is `side.length - sideRetracted.length`: a retraction is an APPEND (no
 * `__pull`), so the ledger IS the audit trail. `tally`/`untally` are brick 1; `decide` was added when a
 * real client (self-consistency) needed the k-ary margin — extract from a measured client, never speculate.
 *
 * Provider signature is the engine's `(graph, concept, scope, argz, cb)`. Design §3.5/§9.3.
 */

// majority + top-2 MARGIN over an array of discrete votes (values JSON-keyed so objects vote too). The
// decidability bound generalises C9's binary pro-vs-con to k classes: a verdict fires iff the winner beats
// the runner-up by `threshold`, otherwise UNDECIDED — no fake verdict below the bound.
function marginDecide( votes, threshold ) {
	var counts = {}, order = [];
	for ( var i = 0; i < votes.length; i++ ) {
		var key = JSON.stringify(votes[i]);
		if ( counts[key] == null ) { counts[key] = 0; order.push({ key: key, value: votes[i] }); }
		counts[key]++;
	}
	order.sort(function ( a, b ) { return counts[b.key] - counts[a.key]; });
	var top = order[0] || { value: null }, topN = order[0] ? counts[order[0].key] : 0;
	var runnerUp = order[1] ? counts[order[1].key] : 0;
	var margin = topN - runnerUp;
	return { consensus: top.value, agree: topN, runnerUp: runnerUp, margin: margin, total: votes.length,
		verdict: margin >= threshold ? top.value : 'UNDECIDED' };
}

// tally: an entry casts -> push a value into ledger[side] (append-only). `argz[0]` names the side array;
// `argz[1]` (optional) names a FACT on the casting node to push (e.g. 'answerClass' for a vote) — absent,
// the node id is pushed (C9's pro/con entries). The client concept must SELF-FLAG its own marker
// (cast-marker gotcha, Concept.js:239) or it re-fires to the apply-cap; `concept._name` is that marker.
function tally( graph, concept, scope, argz, cb ) {
	var side = argz[0];
	var value = argz[1] != null ? scope._[argz[1]] : scope._._id;
	cb(null, [
		{ $_id: '_parent', [concept._name]: true },
		{ $$_id: 'ledger', [side]: { __push: value } },
	]);
}

// untally (cleaner): the entry UNCASTs (its gate fell — e.g. a witness left the pool) -> APPEND the id to
// ledger[side+'Retracted']. This is the native replacement for the imperative reconcile() loop.
function untally( graph, concept, scope, argz, cb ) {
	var side = argz[0];
	cb(null, { $$_id: 'ledger', [side + 'Retracted']: { __push: scope._._id } });
}

// decide: read the vote array off the casting node (`argz[0]` = the key, default 'votes'), apply the
// margin bound against `scope.threshold` (or `argz[1]`), and write the verdict + counts. Self-flags the
// concept marker. Deterministic, 0-LLM — the shared decidability gate (self-consistency uses it today; C9's
// binary verdict is the same bound expressed as a grammar `ensure`, a candidate to unify onto this later).
function decide( graph, concept, scope, argz, cb ) {
	var votesKey = argz[0] || 'votes';
	var threshold = scope._.threshold != null ? scope._.threshold : (argz[1] != null ? argz[1] : 1);
	var r = marginDecide(scope._[votesKey] || [], threshold);
	var facts = { $_id: '_parent' };
	facts[concept._name] = true;
	facts.verdict = r.verdict; facts.consensus = r.consensus; facts.agree = r.agree;
	facts.margin = r.margin; facts.total = r.total;
	cb(null, facts);
}

module.exports = { Ledger: { tally, untally, decide } };
