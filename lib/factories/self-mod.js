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
 * C5 — SUPERVISED SELF-MODIFICATION (roadmap P3-bis). OPT-IN and GUARDED. A thin, prudent packaging of
 * the engine's live-rule-editing bricks: `authorConcept` (CEGIS — propose→validate→install→test→refine),
 * the reactive supervisor (`supervise`: Stuck→hypothesis→eval→revert), `patchConcept`/`addConcept`
 * (hot-patch a live expert + re-evaluate), and `relearn` (the autonomous un-learn loop: blame→revise→
 * patch, as reactive concepts).
 *
 * It edits the LIVE rules, so it is exposed with PRUDENCE:
 *   • `author()` REQUIRES an explicit proposer (the "judge" — an `LLM::complete` in production, a
 *     deterministic stub in tests). You cannot author without declaring how proposals are made/judged.
 *   • REVERSIBILITY is THE guarantee: every structural op is a captured revision, and `rollbackTo(rev)`
 *     ("git for reasoning") restores any prior coherent state. Two author-time + behavioral oracles
 *     bound the CEGIS search (the validator rejects a malformed candidate before it touches the graph;
 *     the live graph rejects an unmet goal).
 *
 * NOT activated by default anywhere — a host builds this combo explicitly. The bricks stay usable "à nu"
 * (`Graph.authoring.author/supervise/relearn` + the engine MOE API `patchConcept/addConcept/rollbackTo`).
 *
 * @param opts.graph    the live graph to modify (REQUIRED).
 * @param opts.propose  async ({goal, history, round}) => proposal   the AI author/judge (required for author()).
 * @param opts.validate author-time validator config (palette/knownFacts/collectionKeys/strict) for the CEGIS oracle.
 * @returns {{ graph, author, supervise, patch, addConcept, rollbackTo, revisions, relearn }}
 */

var author = require('../authoring/core/author.js');
var supervise = require('../authoring/core/supervise.js');
var relearn = require('../authoring/core/relearn.js');

function createSelfMod( opts ) {
	opts = opts || {};
	var graph = opts.graph;
	if ( !graph || typeof graph.patchConcept !== 'function' )
		throw new Error('createSelfMod needs opts.graph (a live Graph with the MOE API)');

	// a structural op → a promise. Mirrors author.js#applyOp: a NO-OP op destabilizes nothing, so the
	// "stabilize" callback never fires — but the graph is already quiescent, so resolve on the next tick.
	function structuralOp( invoke ) {
		return new Promise(function ( resolve, reject ) {
			var done = false, finish = function () { if ( !done ) { done = true; resolve(); } };
			try { invoke(finish); } catch ( e ) { return reject(e); }
			if ( !graph._unstable.length && !graph._triggeredCastCount ) setTimeout(finish);
		});
	}

	return {
		graph: graph,

		/** CEGIS-author a concept toward `spec.goal` (propose→validate→install→test→refine). Requires a
		 *  proposer (opts.propose or spec.propose — the guard). → { ok, concept?, rounds, reason? }. */
		author: function ( spec ) {
			spec = spec || {};
			var propose = spec.propose || opts.propose;
			if ( typeof propose !== 'function' )
				throw new Error('self-mod author() needs a proposer: opts.propose or spec.propose (the AI author/judge)');
			return author.authorConcept(graph, Object.assign({ validate: opts.validate }, spec, { propose: propose }));
		},

		/** run the reactive supervisor (Stuck→hypothesis→eval→revert) toward `spec`. */
		supervise: function ( spec ) { return supervise.supervise(graph, spec || {}); },

		/** hot-patch a live expert + re-evaluate (the change is a captured revision). */
		patch: function ( nameOrId, updates ) { return structuralOp(function ( cb ) { graph.patchConcept(nameOrId, updates, cb); }); },
		/** add a live concept under `parent` (null = root) + stabilize (a revision). */
		addConcept: function ( parent, schema ) { return structuralOp(function ( cb ) { graph.addConcept(parent == null ? null : parent, schema, cb); }); },

		/** THE reversibility guarantee: restore a prior coherent revision (git-for-reasoning). */
		rollbackTo: function ( rev ) { return graph.rollbackTo(rev); },
		/** the revisions available to rollbackTo (ascending). */
		revisions: function () { return graph.getRevisions(); },

		/** the autonomous un-learn loop as reactive concepts (blame→revise→patch) — host wires tree+providers. */
		relearn: { tree: relearn.relearnTree, providers: relearn.makeRelearnProviders }
	};
}

module.exports = { createSelfMod: createSelfMod };
