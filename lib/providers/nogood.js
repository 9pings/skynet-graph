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
 * L3 learned-NEGATIVE policy — a nogood / sound-skip ("this trial is a dead end for this
 * context") expressed entirely with EXISTING engine machinery (docs/WIP/HANDOFF.md §7 Tier 2;
 * experiment B). Zero core change, and provably fixpoint-preserving: it removes only the
 * useless cast of a provably-dead trial and never changes a surviving useful conclusion
 * (B verified the surviving set bit-for-bit identical with and without the policy).
 *
 * It generalizes the engine's own "`divergent` fact = non-cast condition" from per-(object,
 * concept) to a LEARNED per-(contextKey, trial) policy:
 *   - on a dead-end trial result, the trial's provider {__push}es a `{ctxKey, trial}` nogood
 *     into a shared append-only store node (the same race-free primitive `_markDivergent`
 *     uses) — `recordNogood(...)` builds that mutation fragment;
 *   - a cheap upstream `Nogood::guard` concept reads the store and, for each nogood matching
 *     this object's context, sets a DISCRETE typed `skip_<trial>:true` flag (barrier-clean —
 *     the hot gate keys on a typed boolean, never on the store);
 *   - the expensive trial gains `require:['NogoodGuard']` (DEFER the cast until the cheap
 *     guard has run) + `ensure:['!$skip_<trial>']` (sound-skip) — `guardTrial(...)` adds both.
 *
 * Two ordering disciplines are load-bearing (B, critique-driven) and baked in here:
 *   (1) the trial's `require` lists the guard, so an unresolved require DEFERS the expensive
 *       cast until the cheap guard's self-flag appears (the frontier order is not host-
 *       controllable per concept — the require-deferral is the existing-system route);
 *   (2) the guard writes the `skip_*` flags FIRST and its OWN self-flag LAST, so when the
 *       trial's require-watcher re-tests (the moment the self-flag lands) every skip flag is
 *       already set — otherwise an intra-mutation key-order race lets a trial fire first.
 *
 * A purely ADVISORY hint (a fact nothing gates on) saved ZERO work in B — soft preference
 * needs a core `cfg.frontierComparator` (P1, not built); the sound-skip here is the safe,
 * fixpoint-preserving existing-system answer. Per-episode reset by default (clear the store
 * between episodes; GitOfThoughts-style) — keep it only as long as the context holds.
 *
 *   const { createNogood, recordNogood, guardTrial, nogoodGuardConcept } = require('./nogood');
 *   register(Graph, [ createNogood() ]);   // wires Nogood::guard
 */

/**
 * Build the nogood-store push fragment a trial's provider emits on a dead end (score 0).
 * Spread it into the provider's mutation array alongside the trial's own self-flag write.
 * @param opts.memId    the shared store node id (default 'mem')
 * @param opts.storeKey the array fact on it (default 'nogoods')
 * @param opts.ctxKey   the canonical context key this dead end is keyed on (e.g. the segment kind)
 * @param opts.trial    the trial concept name that is dead for this context
 * @returns a `{ $$_id, <storeKey>: { __push: {ctxKey,trial} } }` mutation template
 */
function recordNogood( opts ) {
	opts = opts || {};
	var tpl = { $$_id: opts.memId || 'mem' };
	tpl[opts.storeKey || 'nogoods'] = { __push: { ctxKey: opts.ctxKey, trial: opts.trial } };
	return tpl;
}

/**
 * Build the nogood guard provider fragment (host opt-in, like createVerifier).
 * @returns { Nogood: { guard } }
 *
 * Concept wiring (the cheap upstream guard):
 *   { require:['Trial','kind'], provider:['Nogood::guard'],
 *     nogood:{ memId:'mem', storeKey:'nogoods', ctxKeyField:'kind' } }
 * Reads the shared store, and for each nogood whose ctxKey matches this object's
 * `<ctxKeyField>` writes `skip_<trial>:true`, then its OWN self-flag LAST.
 */
function createNogood( opts ) {
	opts = opts || {};
	return {
		Nogood: {
			guard: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ memId: 'mem', storeKey: 'nogoods', ctxKeyField: 'kind' },
					concept._schema && concept._schema.nogood, argz && argz[0]),
				    memEtty = graph.getEtty(cfg.memId),
				    store = (memEtty && memEtty._ && memEtty._[cfg.storeKey]) || [],
				    ctx = scope._[cfg.ctxKeyField],
				    out = { $_id: '_parent' };
				// skip_* flags FIRST …
				for ( var i = 0; i < store.length; i++ ) {
					var ng = store[i];
					if ( ng && ng.ctxKey === ctx ) out['skip_' + ng.trial] = true;
				}
				// … the guard's OWN self-flag LAST (so the trial's require-watcher re-tests with
				// every skip flag already set — discipline (2) above).
				out[concept._name] = true;
				cb(null, out);
			}
		}
	};
}

/**
 * Add the sound-skip discipline to a trial concept schema: defer on the guard's self-flag
 * (require) and skip when the learned nogood says so (ensure). Returns a NEW schema.
 * @param schema       the trial concept schema
 * @param opts.trial   the skip-flag basis (default schema._name)
 * @param opts.guard   the guard concept self-flag name to require (default 'NogoodGuard')
 */
function guardTrial( schema, opts ) {
	opts = opts || {};
	var name = opts.trial || schema._name,
	    guard = opts.guard || 'NogoodGuard',
	    asArr = function ( v ) { return v == null ? [] : Array.isArray(v) ? v.slice() : [v]; },
	    out = Object.assign({}, schema);
	out.require = asArr(schema.require).concat([guard]);
	out.ensure = asArr(schema.ensure).concat(['!$skip_' + name]);
	return out;
}

/**
 * The cheap upstream guard concept (provider-less wrapper) for a host that wants it ready-made.
 * @param opts.require       what marks an object as guardable (default ['Trial','kind'])
 * @param opts.memId/storeKey/ctxKeyField  passed through to the provider config
 * @param opts.name          the guard self-flag name (default 'NogoodGuard')
 */
function nogoodGuardConcept( opts ) {
	opts = opts || {};
	var name = opts.name || 'NogoodGuard';
	return {
		_id: opts.id || name, _name: name,
		require: opts.require || ['Trial', opts.ctxKeyField || 'kind'],
		provider: ['Nogood::guard'],
		nogood: {
			memId: opts.memId || 'mem',
			storeKey: opts.storeKey || 'nogoods',
			ctxKeyField: opts.ctxKeyField || 'kind'
		}
	};
}

module.exports = {
	recordNogood: recordNogood,
	createNogood: createNogood,
	guardTrial: guardTrial,
	nogoodGuardConcept: nogoodGuardConcept
};
