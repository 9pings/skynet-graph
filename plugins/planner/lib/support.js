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
 * The SUPPORT GRAMMAR (host-side authoring brick) — the support-grammar study made runnable
 * (doc/WIP/studies/2026-06-25-grammaire-de-support-resolution-probleme.md). It composes two
 * already-shipped pieces so a SMALL model only has to be locally competent on a bounded segment
 * while the GRAPH holds the structure and runs the search:
 *
 *   (structure, J1) the decompose loop (lib/authoring/loop.js): a Task DAG that splits a problem
 *      into segments and synthesizes bottom-up (reactive Rollup) — the whole is NEVER in the
 *      model's context, only `${label}` of one segment;
 *   (alternatives, J2) the per-segment SELECT cluster (lib/providers/semiring.js#selectConceptTree):
 *      an atomic segment GENERATES several candidate answers (`Propose`), the `pareto` semiring
 *      keeps the non-dominated trade-offs and picks one (`Select`), and `Adopt` makes the selected
 *      candidate the segment's answer. Multi-criteria selection is reified in the graph (not flattened
 *      by the model), keyed on DISCRETE bands (barrier-clean, deterministic).
 *
 *   const { supportConceptTree, makeSupportProviders } = require('./support');
 *   const providers = makeSupportProviders({ evalFn, expandFn, proposeFn, rollupFn });
 *   register(Graph, [ providers ]);                       // or Graph._providers = {...}
 *   new Graph(seed, conf, { common: supportConceptTree({ criteria, lex }) });
 *
 * Content (eval/expand/propose/rollup) is INJECTED — deterministic in tests, an LLM in production.
 * Zero core change: everything is concepts + providers over the existing engine.
 */
const path = require('path');
const dmerge = require('deepmerge');
const { makeDecomposeProviders } = require('../../../lib/authoring/loop.js');
const { buildConceptTree } = require('../../../lib/authoring/concepts.js');
const { createSemiring, selectConceptTree } = require('../../../lib/providers');
const { rankOf } = require('../../../lib/providers/semiring.js');

/**
 * The support-grammar concept set: the decompose scaffold + the per-segment Propose→Select→Adopt
 * alternative-selection trio + reactive bottom-up synthesis.
 * @param opts.criteria  the SELECT comparison criteria (band lists or {dir}) — see semiring.js
 * @param opts.lex       criterion priority for the tie-break (default: criteria key order)
 * @param opts.idKey     candidate id key (default 'id')
 */
function supportConceptTree( opts ) {
	opts = opts || {};
	var sel = selectConceptTree({
		criteria: opts.criteria || {}, lex: opts.lex, idKey: opts.idKey,
		contribKey: 'candidates', require: ['Task', 'Atomic']
	});
	// The GRAMMAR lives in FILES (owner: no grammar hard-coded in JS) — composed from the planner
	// plugin's sets with deepmerge (the engine's conceptSets merge, Graph.js:189):
	//   structure (J1)      = `loop` MINUS Answer (Propose/Select/Adopt replace the direct leaf answer)
	//   reactive synthesis  = `loop-reactive` (ReportUp / Rollup)
	//   alternatives (J2)   = `support` (Propose / Adopt bracketing the SELECT)
	// `Select` stays PARAMETRIC: built at call time from the host's criteria/lex (selectConceptTree),
	// the same status as the factory-built providers — a generator is code, not a hard-coded grammar.
	var SETS = path.join(__dirname, '..', 'concepts');
	var tree = dmerge.all([
		buildConceptTree(path.join(SETS, 'loop'), { exclude: ['Answer'] }),
		buildConceptTree(path.join(SETS, 'loop-reactive')),
		buildConceptTree(path.join(SETS, 'support'))
	]);
	tree.childConcepts.Task.childConcepts.Select = sel.childConcepts.Select;
	return tree;
}

/**
 * The support-grammar providers. Reuses the decompose providers (AI::evalComplexity/expand/reportUp/
 * rollup, lib/authoring/loop.js) + the pareto reducer (Semiring::reduce) and adds the two tiny
 * Support providers (propose/adopt) that bracket the SELECT.
 * @param opts.proposeFn(scope) -> [{ id, ...criteria, content }]   candidate alternatives for a segment
 * @param opts.escalateFn(scope) -> [{ id, ...criteria, content }]  J3: a BETTER-tier proposer, called
 *        ONLY for a segment whose own candidates all fall below the bar (Stuck). The better model is
 *        spent only where the small one is locally insufficient.
 * @param opts.escalateBar { criterion, order, min }  the quality gate: escalate iff no candidate's
 *        `criterion` band reaches `min` (band order worst→best). Omit to disable escalation.
 *        (+ evalFn/expandFn/answerFn/rollupFn/maxDepth/maxBranch passed through to makeDecomposeProviders)
 */
function makeSupportProviders( opts ) {
	opts = opts || {};
	var proposeFn = opts.proposeFn || function () { return []; },
	    escalateFn = opts.escalateFn,
	    bar = opts.escalateBar;
	// does the candidate set already clear the quality bar? (a `min` band reached on `criterion`)
	function clearsBar( cands ) {
		if ( !bar ) return true;
		var minRank = rankOf(bar.min, bar.order), best = -Infinity;
		for ( var i = 0; i < cands.length; i++ ) best = Math.max(best, rankOf(cands[i][bar.criterion], bar.order));
		return best >= minRank;
	}
	var support = { Support: {
		// generate the segment's candidate alternatives (canned/LLM); if none clears the bar, ESCALATE
		// to the better tier (J3) — recording the weak ones as memory — then arm the cardinality gate.
		propose: function ( graph, concept, scope, argz, cb ) {
			Promise.resolve(proposeFn(scope)).then(function ( cands ) {
				cands = cands || [];
				if ( escalateFn && bar && cands.length && !clearsBar(cands) ) {
					return Promise.resolve(escalateFn(scope)).then(function ( better ) {
						better = better || [];
						var pool = cands.concat(better);
						cb(null, { $_id: '_parent', Propose: true, Stuck: true, Escalated: true,
							escalatedFrom: cands.map(function ( c ) { return c.id; }),   // nogood memory of the dead-ends
							candidates: pool, expected: pool.length });
					});
				}
				cb(null, { $_id: '_parent', Propose: true, candidates: cands, expected: cands.length });
			}).catch(function ( e ) {
				cb(null, { $_id: '_parent', Propose: true, candidates: [], expected: 0, llmError: e.message });
			});
		},
		// adopt the SELECTed candidate (by its discrete selectedId) as the segment's answer
		adopt: function ( graph, concept, scope, argz, cb ) {
			var id = scope._.selectedId, cands = scope._.candidates || [], sel = null;
			for ( var i = 0; i < cands.length; i++ ) if ( cands[i].id === id ) { sel = cands[i]; break; }
			cb(null, { $_id: '_parent', Adopt: true, Answered: true, answer: sel ? sel.content : '(none selected)' });
		}
	} };
	return Object.assign({}, makeDecomposeProviders(opts), support, createSemiring(opts.semiringOpts));
}

module.exports = { supportConceptTree: supportConceptTree, makeSupportProviders: makeSupportProviders };
