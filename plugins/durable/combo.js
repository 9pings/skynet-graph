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
 * C2 — the DURABLE WORKFLOW RUNNER (roadmap P4). A thin assembly over the durable executor bricks
 * (`plugins/durable/lib/*`): the CheckpointStore (durable marking + content-memo + lease queue, memory or
 * SQLite), the C-xlate (`compileMethod`: a compact select+task+map+reduce spec → a workflow net), the
 * interpreter (`runFlow`: routes typed records, memoizes task calls, fans out maps, folds joins,
 * asserts a per-step contract), and the audit forest (`auditRun`). The properties are already MEASURED
 * (the §11 gate: STRUCT 6 calls vs RAG 24, 0/12 drift-stale; crash-safety via fencing token +
 * rollbackInflight): this combo just names them behind one governed entry point.
 *
 *   const runner = createDurableRunner({ store: 'flow.db', runTask });
 *   await runner.run('run-1', spec, records);   // compile-if-spec → ensureRun → inject → runFlow
 *   await runner.resume('run-1', spec);          // crash-recovery: reclaim orphaned tokens → finish
 *   const { summary } = runner.audit('run-1');   // the derivation forest + verdict + blame
 *
 * The content-memo is SOUND by its key: `keyOf(taskRef, token)` must project to a SUPERSET of the
 * facts each task reads (so it never under-keys → never a false hit) yet ignore incidental fields (so a
 * recurrent class amortizes). The default keys on `{task, payload}` (sound but coarse — incidental
 * fields re-key); pass `opts.keyOf` for tighter amortization (see examples/poc/durable-flow.js).
 * The bricks stay usable "à nu" (`Graph.durable.*`); this is an optional convenience.
 *
 * @param opts.store    a file PATH (→ SQLite, crash-safe, cross-restart) or a store; default in-memory.
 * @param opts.runTask  (task, token) => {payload?, created?} | Promise<…>   the micro-task runner (REQUIRED).
 * @param opts.contract optional per-step contract (assertPost G1/G2) passed to runFlow.
 * @param opts.keyOf    optional content-memo key `(taskRef, token) => key`. Default: digest({task,payload}).
 * @param opts.lease/batch/maxSteps  optional runFlow bounds.
 * @param opts.*        the §4 knobs via resolveComboDefaults.
 * @returns {{ compile, run, resume, audit, stats, marking, store, close }}
 */

var defaults = require('../../lib/combos/defaults.js');
var xlate = require('./lib/xlate.js');
var interp = require('./lib/interpreter.js');
var audit = require('./lib/audit.js');
var cp = require('./lib/checkpoint-store.js');
var digest = require('../../lib/providers/canonicalize.js').digest;

function looksLikeSpec( x ) { return !!(x && (x.select || x.methods || x.steps || x.map)); }

function createDurableRunner( opts ) {
	opts = opts || {};
	var d = defaults.resolveComboDefaults(opts);
	if ( typeof opts.runTask !== 'function' )
		throw new Error('createDurableRunner needs opts.runTask ((task, token) => {payload?, created?})');

	// the durable store: a file path → SQLite (crash-safe + cross-restart), a store object → as-is, else in-memory.
	var store = (typeof opts.store === 'string') ? cp.createSqliteCheckpointStore({ file: opts.store })
	          : (opts.store || cp.createMemoryCheckpointStore());

	// SOUND-by-default content-memo key (coarse: incidental fields re-key). Host overrides for tighter amortization.
	var keyOf = opts.keyOf || function ( taskRef, token ) { return digest({ task: taskRef.task, payload: token.payload || {} }); };

	function runFlowOpts( extra ) {
		return Object.assign({ runTask: opts.runTask, keyOf: keyOf, contract: opts.contract,
		                       lease: opts.lease, batch: opts.batch, maxSteps: opts.maxSteps }, extra);
	}
	function netOf( netOrSpec ) {
		if ( !looksLikeSpec(netOrSpec) ) return netOrSpec;   // already a compiled net
		var net = xlate.compileMethod(netOrSpec);
		if ( d.validate ) xlate.validateNet(net);            // author-time net validation (default ON)
		return net;
	}

	return {
		store: store,

		/** compile a compact select+task+map+reduce spec → a workflow net (+ validate). */
		compile: function ( spec ) { var net = xlate.compileMethod(spec); if ( d.validate ) xlate.validateNet(net); return net; },

		/** run a workflow: compile-if-spec → ensureRun → inject records → drain to completion. */
		run: function ( runId, netOrSpec, records, extra ) {
			var net = netOf(netOrSpec);
			store.ensureRun(runId, net);
			if ( records && records.length ) store.inject(runId, records);
			return interp.runFlow(store, runId, net, runFlowOpts(extra));
		},

		/** crash-recovery: reclaim orphaned in-flight tokens (rollbackInflight), then drain to completion —
		 *  no effect lost or duplicated (the memo + fencing token make replay exactly-once). */
		resume: function ( runId, netOrSpec, extra ) {
			var net = netOf(netOrSpec);
			if ( store.rollbackInflight ) store.rollbackInflight(runId);
			return interp.runFlow(store, runId, net, runFlowOpts(extra));
		},

		/** the derivation forest + verdict + blame for a run. */
		audit: function ( runId ) { var a = audit.auditRun(store, runId); return { audit: a, summary: audit.auditSummary(a) }; },

		/** the run's token status counts { ready, leased, done, failed, … }. */
		stats: function ( runId ) { return store.stats(runId); },
		/** the run's place marking. */
		marking: function ( runId ) { return store.marking ? store.marking(runId) : null; },

		close: function () { if ( store.close ) store.close(); }
	};
}

module.exports = { createDurableRunner: createDurableRunner };
