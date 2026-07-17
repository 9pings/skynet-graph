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
 * Typed CONSTAT record (Q6) — promotes memory-on-retraction from an ad-hoc string blob into a
 * STRUCTURED, queryable, bisectable learning surface, with EXISTING engine machinery (the
 * `cleaner` hook + `{__push}` + a surviving anchor). Zero core change.
 *
 * A constat is what a defeasant concept deposits when it RETRACTS: WHAT fell (`kind`/`claim`),
 * WHY (`retractedBecause` — the premise), with what SNAPPED certainty (`certaintyBand` — never a
 * raw float, the barrier), and at which revision (`atRev` — bisectable). The lineage is free:
 * `graph.getCurrentRevision()` + the concept's `_computeWhy` credit graph join it to the trace.
 *
 * Q6 verdict (docs/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §4): the log-odds inc/dec
 * channel already exists (semiring + {__push}+fold + snap-band) — do NOT add a core op; the ONE
 * real gain is this typed constat record. The certainty is read from a SNAPPED key
 * (`certaintyBand`/`confBand`), never a raw continuous value (K1).
 *
 *   const { createConstat, recordConstat } = require('./constat');
 *   register(Graph, [ createConstat() ]);                       // wires Constat::record
 *   // on a defeasant concept:  cleaner:['Constat::record'], constat:{ claimKey:'diagnosis', because:'labVerdict' }
 */

// The canonical constat shape (a `produces`-style declaration — for docs + author-time checks).
var CONSTAT_FIELDS = {
	kind            : { role: 'fact', type: 'id' },     // the concept/claim that retracted
	claim           : { role: 'fact', type: 'id' },     // the value it had asserted
	retractedBecause: { role: 'fact', type: 'id' },     // the premise that fell (the defeasance cause)
	certaintyBand   : { role: 'fact', enum: ['low', 'medium', 'high', 'certain'] },  // SNAPPED, never raw (K1)
	atRev           : { role: 'fact', type: 'int' },    // the revision — bisectable
	note            : { role: 'prose' }                  // free text — UNTRACKED, terminal
};

/**
 * Build a constat record from the retracting concept + its scope.
 * @param cfg.claimKey  the fact key holding the asserted value (e.g. 'diagnosis')
 * @param cfg.because   the premise that fell (e.g. 'labVerdict')
 * @param cfg.extra     extra fields to merge in (e.g. evidenceRefs)
 */
function buildConstat( graph, concept, scope, cfg ) {
	cfg = cfg || {};
	var e = (scope && scope._) || {};
	var rec = {
		kind            : concept._name,
		claim           : cfg.claimKey != null && e[cfg.claimKey] != null ? e[cfg.claimKey] : null,
		retractedBecause: cfg.because != null ? cfg.because : null,
		// certainty is read from a SNAPPED band key only (barrier); never a raw float
		certaintyBand   : e.certaintyBand != null ? e.certaintyBand : (e.confBand != null ? e.confBand : null),
		atRev           : graph.getCurrentRevision()
	};
	if ( cfg.extra ) for ( var k in cfg.extra ) rec[k] = cfg.extra[k];
	return rec;
}

/**
 * The `{__push}` mutation fragment a cleaner returns to deposit a constat on a surviving anchor
 * (race-free append — a shared `lessons` array, not a distinct key).
 * @param cfg.memId/storeKey  the anchor node + array fact (default 'mem'/'lessons')
 */
function recordConstat( graph, concept, scope, cfg ) {
	cfg = cfg || {};
	var tpl = { $$_id: cfg.memId || 'mem' };
	tpl[cfg.storeKey || 'lessons'] = { __push: buildConstat(graph, concept, scope, cfg) };
	return tpl;
}

/**
 * Package the constat cleaner provider (host opt-in, like createNogood / createVerifier).
 * @returns { Constat: { record } }
 *
 * Wiring on a defeasant concept:
 *   { ..., cleaner:['Constat::record'], constat:{ claimKey:'diagnosis', because:'labVerdict' } }
 * On uncast, reads the concept's `constat` config (+ any argz) and deposits the typed record.
 */
function createConstat() {
	return {
		Constat: {
			record: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ memId: 'mem', storeKey: 'lessons' },
					concept._schema && concept._schema.constat, argz && argz[0]);
				cb(null, recordConstat(graph, concept, scope, cfg));
			}
		}
	};
}

module.exports = {
	CONSTAT_FIELDS: CONSTAT_FIELDS,
	buildConstat  : buildConstat,
	recordConstat : recordConstat,
	createConstat : createConstat
};
