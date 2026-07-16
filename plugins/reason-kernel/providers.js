'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * reason-kernel — the LEDGER primitive: a generic, deterministic (0-LLM), append-only tally over a
 * `ledger` graph node, shared by any reasoning strategy that accumulates a decidable count (critical-mind's
 * pro/con sides, self-consistency's votes, …). `tally`/`untally` are the kernel's first brick; Thought /
 * Score / the Gate family follow as real clients need them (design §9.3 — extract from a measured client,
 * never speculate). The active count of a side is `side.length - sideRetracted.length`: a retraction is an
 * APPEND (no `__pull`), so the ledger IS the audit trail and native cascade retraction falls out for free.
 *
 * Provider signature is the engine's `(graph, concept, scope, argz, cb)`; `argz[0]` = the side array key
 * (client-chosen, e.g. 'pro'/'con'/'votes'). Design: `WIP/2026-07-16-design-combos-as-grammar.md` §3.5/§9.3.
 */

// tally: an entry casts -> push its id into ledger[side] (append-only). The client concept must SELF-FLAG
// its own marker (cast-marker gotcha, Concept.js:239) or it re-fires to the apply-cap; `concept._name` is
// that cast marker (ProEntry / ConEntry / Vote / …); `argz[0]` names the ledger side array.
function tally( graph, concept, scope, argz, cb ) {
	var side = argz[0];
	cb(null, [
		{ $_id: '_parent', [concept._name]: true },
		{ $$_id: 'ledger', [side]: { __push: scope._._id } },
	]);
}

// untally (cleaner): the entry UNCASTs (its gate fell — e.g. a witness left the pool) -> APPEND the id to
// ledger[side+'Retracted']. This is the native replacement for the imperative reconcile() loop.
function untally( graph, concept, scope, argz, cb ) {
	var side = argz[0];
	cb(null, { $$_id: 'ledger', [side + 'Retracted']: { __push: scope._._id } });
}

module.exports = { Ledger: { tally, untally } };
