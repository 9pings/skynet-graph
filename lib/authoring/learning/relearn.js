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
 * The STANDING / autonomous C-contract un-learn loop (§3.1) — the engine drives
 * blame → revise → patch as REACTIVE concepts at the stabilize fixpoint, with NO host
 * glue. The defeasance moat no RAG / CBR / skill-library has: when a learned method's
 * typed premise falls, the JTMS retracts the belief (handled by the engine) AND the
 * library autonomously, surgically NARROWS the method's applicability (this module) —
 * versioned/undoable (N6/B8).
 *
 * This is the reactive sibling of the host-orchestrated `examples/poc/contract-unlearn.js`
 * (whose steps 3-4 — reviseOnBlame + the gate narrowing — were plain host JS). It mirrors
 * the shape of `supervise.js#reactiveSupervisorTree` / `makeSupervisorProviders`:
 *   - a `cleaner` (`Lib::blame`) deposits, on retraction, BOTH the typed constat AND a
 *     discrete `blamed` fact on the method's library node — a clean `require` trigger;
 *   - a `Revise` meta-concept (`require:['blamed']`, `ensure:["!$revised"]`) fires on the
 *     blame's appearance (#22-safe: keyed on a fact APPEARING, not a value change);
 *   - the `Lib::revise` provider revises the library contract (reviseOnBlame / CEGIS) AND
 *     `patchConcept`es the engine gate to match (queued mid-stabilize, #11.a) — then sets
 *     its own cast marker + the `revised` re-fire guard (the #33 GOTCHA).
 *
 * Wiring (see `examples/poc/contract-relearn.js`):
 *   const { makeRelearnProviders, relearnTree } = require('../learning/relearn.js');
 *   Graph._providers = Object.assign({ App:{approve} }, createConstat(), makeRelearnProviders({ registry }));
 *   // tree: the defeasant method gets `cleaner:['Lib::blame'], discriminator:'region', constat:{...}`
 *   //       + the relearnTree() Revise concept; seed a `lib:<Method>` node.
 */

const { recordConstat } = require('../../providers/constat.js');
const { reviseOnBlame } = require('../core/contract.js');

// The exclusion atom a point-exclusion revision adds, in the engine/expr.js form
// (`$key!='val'` for strings, `$key!=val` for numbers — VERIFIED to parse on the real
// expr.js, single quotes included). Kept identical to reviseOnBlame's pre atom so the
// library contract and the engine `ensure` gate stay in lockstep.
function exclusionAtom( ce ) {
	if ( ce == null || ce.key == null || ce.value === undefined ) return null;
	return '$' + ce.key + '!=' + (typeof ce.value === 'string' ? "'" + ce.value + "'" : ce.value);
}

// The default revision STRATEGY (open R&D / pluggable, §7): point-exclude the failing
// discriminator (CEGIS specialize-pre, NOT method removal — which oscillates). Returns the
// new contract + the matching engine-gate atom so the gate sync is derived from the strategy
// (a different strategy — tighten-bound, etc. — returns its own atom).
function defaultStrategy( contract, ce ) {
	return { contract: reviseOnBlame(contract, ce), ensureAtom: exclusionAtom(ce) };
}

/**
 * The reactive un-learn flow as a concept tree (vs the host-orchestrated loop in
 * contract-unlearn.js). One meta-concept:
 *   <Method> ──retract──▶ (cleaner Lib::blame deposits `blamed` on lib:<Method>)
 *   blamed ──require──▶ Revise  (ensure !revised)  ──▶ Lib::revise narrows the library + the gate
 * @param opts.name  the meta-concept id/_name (default 'Revise')
 */
function relearnTree( opts ) {
	opts = opts || {};
	var name = opts.name || 'Revise';
	var def  = { _id: name, _name: name, require: ['blamed'], ensure: ['!$revised'], provider: ['Lib::revise'] };
	var tree = { childConcepts: {} };
	tree.childConcepts[name] = def;
	return tree;
}

/**
 * The Lib provider pair (host opt-in, like createConstat / makeSupervisorProviders).
 * @param opts.registry  { <Method>: contract } — the library's typed contracts; revise
 *                       mutates the entry to the new (versioned) contract. Pass copies for B8.
 * @param opts.strategy  (contract, ce) => { contract, ensureAtom }  — the revision policy
 *                       (default = point-exclusion via reviseOnBlame). Injectable (§7).
 * @returns { Lib: { blame, revise } }
 */
function makeRelearnProviders( opts ) {
	opts = opts || {};
	var registry = opts.registry || {};
	var strategy = opts.strategy || defaultStrategy;

	return { Lib: {
		// cleaner: on a method's retraction, deposit (a) the typed constat on `mem` AND
		// (b) a discrete `blamed` fact on the method's library node lib:<Method> (a clean
		// `require` trigger for Revise). Multi-target template (pushMutation accepts arrays).
		blame: function ( graph, concept, scope, argz, cb ) {
			var cfg   = Object.assign({ memId: 'mem', storeKey: 'lessons' },
				concept._schema && concept._schema.constat, argz && argz[0]);
			var disc  = concept._schema && concept._schema.discriminator;   // e.g. 'region'
			var e     = (scope && scope._) || {};
			var libId = (concept._schema && concept._schema.libNode) || ('lib:' + concept._name);
			var blameTpl = {
				$$_id      : libId,
				blamed     : true,
				method     : concept._name,
				claim      : cfg.claimKey != null && e[cfg.claimKey] != null ? e[cfg.claimKey] : null,
				because    : cfg.because != null ? cfg.because : null,
				failingCase: e._id,
				discKey    : disc != null ? disc : null,
				discVal    : disc != null ? e[disc] : null,
				atRev      : graph.getCurrentRevision()
			};
			cb(null, [recordConstat(graph, concept, scope, cfg), blameTpl]);
		},

		// the standing revise: read the blame → revise the library contract + narrow the
		// engine gate, autonomously. ZERO host orchestration (vs contract-unlearn.js:85-93).
		revise: function ( graph, concept, scope, argz, cb ) {
			var e  = (scope && scope._) || {};
			var M  = e.method;
			var ce = { key: e.discKey, value: e.discVal };

			// 1 — revise the library contract (B8: a NEW contract; we version the registry entry).
			var out = strategy(registry[M], ce);
			if ( registry[M] != null ) registry[M] = out.contract;

			// 2 — narrow the engine gate to match. Concept.patch REPLACES arrays → pass the FULL
			//     ensure. The patch is issued mid-stabilize → QUEUED to the quiescent boundary (#11.a).
			var target    = graph.getConceptByName(M);
			var newEnsure = (target && target._schema.ensure || []).slice();
			if ( out.ensureAtom && newEnsure.indexOf(out.ensureAtom) < 0 ) {
				newEnsure.push(out.ensureAtom);
				graph.patchConcept(M, { ensure: newEnsure });
			}

			// 3 — own cast marker (#33) + `revised` re-fire guard; B8: the live narrowed pre is
			//     stored as a graph fact on lib:<Method> (typed DSL atoms, not prose) so rollbackTo
			//     restores both the concept (N6) and the recorded pre coherently.
			cb(null, { $_id: '_parent', Revise: true, revised: true,
				narrowedPre: out.contract && out.contract.pre, narrowedEnsure: newEnsure });
		}
	} };
}

module.exports = { makeRelearnProviders, relearnTree, defaultStrategy, exclusionAtom };
