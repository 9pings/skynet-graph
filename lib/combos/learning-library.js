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
 *     `packAll()`/`loadAll()` ship the EXERCISED library = methods AND the grown typed lattice (the
 *     registry: isa vocab + admitted synonym rings), each a version-gated single-kind `.sgc` bundle;
 *   • RE-DERIVES on drift — `drift(problem)` invalidates the method (cache + recall) and deopts its
 *     mount rank toward the ESCALATE floor, so the next solve re-forges only the violated entry.
 *
 * P2 laid the SKELETON: master-loop + store + dispatch catalog + `.sgc` portability, the §4 posture
 * (durable store ON, validator/audit available; effectful forge opt-in). P3 COMPLETES it (all additive,
 * `learning:false` default = the skeleton unchanged):
 *   • `crystallizeFrom(records, ctx)` — distill methods from captured trace records
 *     (crystallizeFromRecords pass-through; admitted candidates are indexed into the catalog);
 *   • `learning:true` — the FORGE arm becomes the creative loop (adaptOrForgeAsync:
 *     dispatch→hit(0 call)→antiUnify-adapt(1 call)→forge, verifier-gated, auto-indexed); the host
 *     supplies the projections `target(problem)`/`dispatchFacts(problem)` and a forge that returns
 *     `{candidate, calls}` (the method IS the amortized result). A `reject` THROWS a typed error
 *     (fail-closed — a rejection must never be cached as a 0-call result). `drift()` then ALSO
 *     invalidates the catalog-side template (library.invalidateTemplate) so the stale method cannot
 *     re-`hit` at 0 calls right after the exact cache was evicted (correct-on-drift, both layers);
 *   • `dispatch`/`blame`/`credit` — pure pass-throughs (library.dispatch, attributeSlot{Blame,Credit})
 *     exposing the O(1) catalog lookup and the LOCALIZED blame/credit rules on mounted frames. The
 *     AUTONOMOUS blame→revise loop is C5 (`relearn.js`), deliberately NOT here.
 * The bricks stay usable "à nu" — this is an optional convenience over `Graph.authoring.*`.
 *
 * @param opts.signature (problem) => {structure, content}   the K1 signature; STRUCTURE = method class
 *                       (mount/deopt key), CONTENT = what's derived. Default: identity on the problem.
 * @param opts.forge     async (problem, ctx) => {result, cost, signals?}   the expensive path (REQUIRED).
 *                       With `learning:true`: async (problem, ctx) => {candidate, calls} — ctx carries
 *                       {scopeFacts, neighbours, donors} from the dispatch (reuse them = adapt).
 * @param opts.reForge   optional partial re-forge of the differing content on a recalled skeleton.
 * @param opts.store     a file PATH (→ disk-backed, cross-restart) or a Map-like store; default in-memory.
 *                       NOTE with `learning:true` the exact cache holds METHOD candidates (they carry a
 *                       provider fn) — use `pack()`/`load()` for cross-restart method portability; a
 *                       JSON file store is for opaque (JSON-safe) results.
 * @param opts.mount     a mount controller (default createMountController; opts.maxDeopt → its threshold).
 * @param opts.recallK   fuzzy-recall breadth (default 3).
 * @param opts.learning  OPT-IN (§4 default OFF). true → REQUIRES opts.target(problem) => {frontier,
 *                       signatureKeys} and opts.dispatchFacts(problem) => scopeFacts (host projections;
 *                       the combo never computes a signature/target — watch-point §11.1). Optional:
 *                       opts.adaptContent(contentVars, scopeFacts) => {path:value} (the content-forger,
 *                       may be async), opts.verify(candidate, scopeFacts) => bool (may be async),
 *                       opts.interfaceRecall (§6.2 donor skeletons).
 * @param opts.registry  optional grown typed lattice (a registry: isa vocab + synonym rings) the combo HOLDS
 *                       so pack/load ship it with the methods. Host-supplied + host-grown (the combo never
 *                       derives/grows it — loadLattice grows it through the registry's own admission gate).
 * @param opts.*         the §4 knobs via resolveComboDefaults.
 * @returns {{ solve, drift, stats, pack, load, packLattice, loadLattice, packAll, loadAll, registry,
 *             library, loop, store, crystallizeFrom, dispatch, blame, credit }}
 */

var defaults = require('./defaults.js');
var master = require('../authoring/master-loop.js');
var mountMod = require('../authoring/mount.js');
var libMod = require('../authoring/library.js');
var storeMod = require('../authoring/store.js');
var packMod = require('../authoring/method-pack.js');
var latticeMod = require('../authoring/lattice-pack.js');
var adaptMod = require('../authoring/adapt.js');
var crystalMod = require('../authoring/crystallize.js');
var parametric = require('../authoring/parametric.js');

function createLearningLibrary( opts ) {
	opts = opts || {};
	var d = defaults.resolveComboDefaults(opts);
	if ( typeof opts.forge !== 'function' ) throw new Error('createLearningLibrary needs opts.forge (async (problem, ctx) -> {result, cost})');
	if ( d.learning && (typeof opts.target !== 'function' || typeof opts.dispatchFacts !== 'function') )
		throw new Error('createLearningLibrary learning:true needs opts.target(problem) -> {frontier, signatureKeys} and opts.dispatchFacts(problem) -> scopeFacts');

	// ── the persistent method store (the "library"): a file path → disk-backed (survives restart),
	//    a Map-like → used as-is, else in-memory. This is the master-loop's exact-match cache. ────────
	var store = (typeof opts.store === 'string') ? storeMod.createFileStore(opts.store)
	          : (opts.store || new Map());

	// ── the O(1) dispatch catalog (for the P3 adapt-or-forge creative loop; exposed now for wiring) ──
	var library = opts.library || libMod.makeLibrary();

	// ── the grown typed LATTICE (the registry: isa vocab + synonym rings). HOST-supplied + host-grown
	//    (like target/dispatchFacts — the combo never derives/grows it; it only HOLDS the ref so pack/load
	//    can ship it alongside the methods). null until a host passes one or loadLattice adopts one. ──────
	var registry = opts.registry || null;

	// ── the mount controller (regime + deopt-to-ESCALATE ladder) ────────────────────────────────────
	var mount = opts.mount || mountMod.createMountController(opts.maxDeopt != null ? { thresholds: { maxDeopt: opts.maxDeopt } } : undefined);

	// ── the FORGE arm. Default: the host's forge, raw (the skeleton). With `learning:true`: the
	//    creative loop — adaptOrForgeAsync CHAINS dispatch(0-call hit)→antiUnify-adapt(1 call)→host
	//    forge, gated + auto-indexed by the brick; the combo only CALLS the host projections and
	//    renames candidate→result (the method IS the amortized unit). No invented signals (a policy
	//    verdict would be combo logic — mount already gets hitRate from the loop's own bookkeeping);
	//    the host keeps the opts.signals seam. A `reject` THROWS (fail-closed): the master loop would
	//    otherwise cache it as a permanent 0-call result. ─────────────────────────────────────────────
	var masterForge = opts.forge;
	if ( d.learning ) masterForge = async function ( problem, ctx ) {
		var r = await adaptMod.adaptOrForgeAsync({
			lib            : library,
			target         : opts.target(problem),
			scopeFacts     : opts.dispatchFacts(problem),
			adaptContent   : opts.adaptContent,
			verify         : opts.verify,
			interfaceRecall: opts.interfaceRecall,
			recallK        : opts.recallK,
			requireContract: d.failClosed,
			blend          : opts.blend,   // B.4 — opt-in compositional-reuse rung (graft a donor before a fresh forge)
			donor          : opts.donor,
			combine        : opts.combine, // the 2nd composition operator (set-op) — opt-in, sibling to blend; the host
			                               // resolves {left, right, op, outerClass?} for a set-op task (0 calls). The
			                               // rung's outerClass defaults to the `target` above (re-keys the combined method).
			forge          : function ( sf, neighbours, donors ) {
				return opts.forge(problem, Object.assign({}, ctx, { scopeFacts: sf, neighbours: neighbours, donors: donors }));
			}
		});
		if ( r.outcome === 'reject' ) {
			var err = new Error('learning forge rejected: ' + r.reason);
			err.outcome = 'reject'; err.reason = r.reason; err.calls = r.calls;
			throw err;
		}
		return { result: r.candidate, cost: r.calls, outcome: r.outcome };
	};

	// ── the always-on master loop: MATCH→RETRIEVE→FORGE→ESCALATE ────────────────────────────────────
	var loop = master.createMasterLoop({
		signature: opts.signature,
		forge    : masterForge,
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

		/** a premise drifted → invalidate the method (cache + recall) + deopt its mount rank. With
		 *  `learning:true` ALSO drop the catalog-side template for this site (invalidateTemplate) —
		 *  else the next FORGE would re-`hit` the stale method at 0 calls (correct-on-drift). */
		drift: function ( problem ) {
			var r = loop.drift(problem);
			if ( d.learning ) r.invalidated = libMod.invalidateTemplate(library, opts.target(problem), opts.dispatchFacts(problem)).invalidated;
			return r;
		},

		/** P3 — distill methods from captured trace records (`methodTrace().records` off a live run):
		 *  a PURE pass-through to crystallizeFromRecords (`ctx` carries {episodeTree, schemaGraph,
		 *  declaredFrontier, equivKeys, proseKeys, minCount, all, idFor} — the combo is NOT tree-bound;
		 *  traces from different trees may feed the same library). Every ADMITTED candidate is indexed
		 *  into the dispatch catalog (in `all` mode, from res.candidates — indexMethod does not dedup). */
		crystallizeFrom: function ( records, ctx ) {
			var res = crystalMod.crystallizeFromRecords(Object.assign({ records: records }, ctx || {}));
			var all = res.candidates || [res];
			for ( var i = 0; i < all.length; i++ )
				if ( all[i].admitted && all[i].candidate ) libMod.indexMethod(library, all[i].candidate);
			return res;
		},

		/** P3 — the O(1) catalog lookup, exposed: → {key, candidates, scanned, total}. */
		dispatch: function ( target, scopeFacts ) { return libMod.dispatch(library, target, scopeFacts); },

		/** P3 — the LOCALIZED blame rule (per-slot): → {perAtom, role, admissible}. Admissible iff
		 *  every failed atom maps to ONE role (else discard — the blame-gate). Pass-through. */
		blame: function ( o ) { return parametric.attributeSlotBlame(o); },

		/** P3 — the localized credit rule (blame's dual): → {perAtom, roles}. Pass-through. */
		credit: function ( o ) { return parametric.attributeSlotCredit(o); },

		/** the ladder counters {match, recallFull, recallPartial, forge, escalate, cost, calls}. */
		stats: function () { return loop.stats; },

		/** pack the warm library as a portable, version-stamped `.sgc` bundle (ship it). */
		pack: function ( packOpts ) { return packMod.packMethods(loop, packOpts || {}); },

		/** load a `.sgc` bundle into this library (version-gated — a stale package never silently
		 *  replays). With `learning:true` (and the version gate passed) every loaded method that IS a
		 *  candidate (schema + templatesBySig — the catalog's own unit, a shape read) is ALSO re-indexed
		 *  into the dispatch catalog, so a fresh deployment 0-call `hit`s on dispatch (G-P3-5). The pack
		 *  ships the EXERCISED library (recall-index entries); a crystallized-but-never-solved method
		 *  re-crystallizes from its records (the durable source) — the honest portability boundary. */
		load: function ( bundle, loadOpts ) {
			var r = packMod.loadMethods(bundle, loop, loadOpts || {});
			if ( d.learning && r.exactReplaySafe ) {
				var ms = packMod.unpackMethods(bundle).methods, n = 0;
				for ( var i = 0; i < ms.length; i++ )
					if ( ms[i].method && ms[i].method.schema && ms[i].method.templatesBySig ) { libMod.indexMethod(library, ms[i].method); n++; }
				r.catalogued = n;
			}
			return r;
		},

		/** the current grown typed lattice (the registry: isa vocab + synonym rings), or null. */
		registry: function () { return registry; },

		/** pack the grown typed LATTICE as a portable, version-stamped `.sgc kind:'lattice'` bundle — the
		 *  runtime-grown canon (isa vocab + admitted synonym rings) ships alongside the methods. Packs the
		 *  held registry (empty if the host never supplied one). Pass-through to lattice-pack. */
		packLattice: function ( packOpts ) { return latticeMod.packLattice(registry, packOpts || {}); },

		/** load a `.sgc kind:'lattice'` bundle into the held canon (version-gated). With a held registry it
		 *  GROWS it through the SAME admission gate (mergeRingProposals — confluence-checked, conflicting
		 *  aliases rejected); with none it ADOPTS the packaged canon. The grown registry becomes the held
		 *  one (so a later packLattice ships it). Pass-through to lattice-pack. */
		loadLattice: function ( bundle, loadOpts ) {
			var r = latticeMod.loadLattice(bundle, registry, loadOpts || {});
			if ( r.loadSafe && r.registry ) registry = r.registry;
			return r;
		},

		/** SHIP BOTH in one call: the exercised library = the methods AND the grown lattice. Returns a plain
		 *  `{ methods, lattice }` envelope of two single-kind `.sgc` bundles (NOT a new `.sgc` kind — each
		 *  part stays a valid corpus/method/lattice bundle). `lattice` is null when no registry is held. */
		packAll: function ( packOpts ) {
			return { methods: packMod.packMethods(loop, packOpts || {}), lattice: registry ? latticeMod.packLattice(registry, packOpts || {}) : null };
		},

		/** load a `{ methods, lattice }` envelope (the packAll output) — methods then lattice, each
		 *  version-gated by its own pack. Returns `{ methods, lattice }` load results (lattice null if absent). */
		loadAll: function ( bundle, loadOpts ) {
			bundle = bundle || {};
			var m = bundle.methods ? this.load(bundle.methods, loadOpts) : null;
			var l = bundle.lattice ? this.loadLattice(bundle.lattice, loadOpts) : null;
			return { methods: m, lattice: l };
		}
	};
}

module.exports = { createLearningLibrary: createLearningLibrary };
