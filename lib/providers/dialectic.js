'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * C9 dialectic providers — the PURE ledger side of the critical-mind grammar (`concepts/_dialectic/`).
 * `tally`/`untally` are deterministic (0 LLM): they turn an Established Pro/ConEntry cast/uncast into an
 * APPEND-ONLY ledger mutation. The active count of a side is `side.length - sideRetracted.length`, so a
 * retraction is an append (no `__pull` needed) and the journal falls out of the same channel. The LLM
 * providers (cite / propose / normProbe / synthesize) are added in later tranches.
 *
 * Design: `WIP/2026-07-16-design-combos-as-grammar.md` §3.5. Provider signature is the engine's
 * `(graph, concept, scope, argz, cb)`; `cb(null, mutationTemplateOrArray)`.
 */

// tally: an Established entry casts -> push its viewpoint id into ledger[side] (append-only). The
// concept must SELF-FLAG its own marker (cast-marker gotcha, Concept.js:239) or it re-fires to the
// apply-cap. `concept._name` is the cast marker (ProEntry / ConEntry); `argz[0]` is the side array.
function tally( graph, concept, scope, argz, cb ) {
	var side = argz[0];                                  // 'pro' | 'con'
	cb(null, [
		{ $_id: '_parent', [concept._name]: true },
		{ $$_id: 'ledger', [side]: { __push: scope._._id } },
	]);
}

// untally (cleaner): the entry UNCASTs (a witness left the pool -> Established's ensure fell) -> APPEND
// the id to ledger[side+'Retracted']. This is the native replacement for critique.js#reconcile.
function untally( graph, concept, scope, argz, cb ) {
	var side = argz[0];
	cb(null, { $$_id: 'ledger', [side + 'Retracted']: { __push: scope._._id } });
}

module.exports = { C9: { tally, untally } };
