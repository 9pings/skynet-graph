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
 * C3 — the LEARNING METHOD LIBRARY (roadmap P2 SKELETON → P3 complete). A thin assembly over the
 * always-on master loop (the cost-ladder MATCH→RETRIEVE→FORGE→ESCALATE), a persistent method store,
 * and the O(1) dispatch catalog — so a recurrent typed workload:
 *   • AMORTIZES — a repeat problem elides the forge (MATCH → 0 model calls) once the library warms;
 *   • SURVIVES a restart — the library is disk-backed (a fresh process replays at 0 calls);
 *   • SHIPS — `pack()` → a portable `.sgc` a different deployment `load()`s and replays (version-gated);
 *   • RE-DERIVES on drift — `drift(problem)` invalidates the method (cache + recall) and deopts its
 *     mount rank toward the ESCALATE floor, so the next solve re-forges only the violated entry.
 *
 * This is the P2 SKELETON: master-loop + store + dispatch catalog + `.sgc` portability, the §4 posture
 * (durable store ON, validator/audit available; effectful forge opt-in). P3 COMPLETES it:
 * `crystallizeFrom(records)` to distill methods from real traces, the adapt-or-forge creative loop
 * (dispatch→antiUnify-adapt→forge) as the forge, and the localized blame/credit on mounted frames.
 * The bricks stay usable "à nu" — this is an optional convenience over `Graph.authoring.*`.
 *
 * @param opts.signature (problem) => {structure, content}   the K1 signature; STRUCTURE = method class
 *                       (mount/deopt key), CONTENT = what's derived. Default: identity on the problem.
 * @param opts.forge     async (problem, ctx) => {result, cost, signals?}   the expensive path (REQUIRED).
 * @param opts.reForge   optional partial re-forge of the differing content on a recalled skeleton.
 * @param opts.store     a file PATH (→ disk-backed, cross-restart) or a Map-like store; default in-memory.
 * @param opts.mount     a mount controller (default createMountController; opts.maxDeopt → its threshold).
 * @param opts.recallK   fuzzy-recall breadth (default 3).
 * @param opts.*         the §4 knobs via resolveComboDefaults.
 * @returns {{ solve, drift, stats, pack, load, library, loop, store }}
 */

var defaults = require('./defaults.js');
var master = require('../authoring/master-loop.js');
var mountMod = require('../authoring/mount.js');
var libMod = require('../authoring/library.js');
var storeMod = require('../authoring/store.js');
var packMod = require('../authoring/method-pack.js');

function createLearningLibrary( opts ) {
	opts = opts || {};
	var d = defaults.resolveComboDefaults(opts);
	if ( typeof opts.forge !== 'function' ) throw new Error('createLearningLibrary needs opts.forge (async (problem, ctx) -> {result, cost})');

	// ── the persistent method store (the "library"): a file path → disk-backed (survives restart),
	//    a Map-like → used as-is, else in-memory. This is the master-loop's exact-match cache. ────────
	var store = (typeof opts.store === 'string') ? storeMod.createFileStore(opts.store)
	          : (opts.store || new Map());

	// ── the O(1) dispatch catalog (for the P3 adapt-or-forge creative loop; exposed now for wiring) ──
	var library = opts.library || libMod.makeLibrary();

	// ── the mount controller (regime + deopt-to-ESCALATE ladder) ────────────────────────────────────
	var mount = opts.mount || mountMod.createMountController(opts.maxDeopt != null ? { thresholds: { maxDeopt: opts.maxDeopt } } : undefined);

	// ── the always-on master loop: MATCH→RETRIEVE→FORGE→ESCALATE ────────────────────────────────────
	var loop = master.createMasterLoop({
		signature: opts.signature,
		forge    : opts.forge,
		reForge  : opts.reForge,
		cache    : store,
		mount    : mount,
		recallK  : opts.recallK,
		signals  : opts.signals
	});

	return {
		loop   : loop,
		store  : store,
		library: library,

		/** solve a problem through the cost ladder → {result, arm, regime, cost}. */
		solve: function ( problem ) { return loop.solve(problem); },

		/** a premise drifted → invalidate the method (cache + recall) + deopt its mount rank. */
		drift: function ( problem ) { return loop.drift(problem); },

		/** the ladder counters {match, recallFull, recallPartial, forge, escalate, cost, calls}. */
		stats: function () { return loop.stats; },

		/** pack the warm library as a portable, version-stamped `.sgc` bundle (ship it). */
		pack: function ( packOpts ) { return packMod.packMethods(loop, packOpts || {}); },

		/** load a `.sgc` bundle into this library (version-gated — a stale package never silently replays). */
		load: function ( bundle, loadOpts ) { return packMod.loadMethods(bundle, loop, loadOpts || {}); }
	};
}

module.exports = { createLearningLibrary: createLearningLibrary };
