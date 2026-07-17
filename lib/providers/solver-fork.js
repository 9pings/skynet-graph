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
 * C-regime solver-fork — search-where-D-propagates, with a snapped frontier (the
 * Mixture-of-Reasoners "C regime"; docs/WIP/HANDOFF.md §7 Tier 1; SOTA subgraph-grammars
 * brick ii; experiment E8). Zero core change.
 *
 * The deterministic D socle PROPAGATES to a fixpoint; it cannot SEARCH. A regime-C
 * sub-graph delegates a constraint problem to a backtracking solver (Logic-LM style,
 * Pan 2023) and EXPORTS ONLY the snapped model across the merge frontier — the colour/
 * assignment enums + a `sat` bool — never the search internals (step counts, the search
 * tree, continuous scores). So the parent stays deterministic and auditable, the barrier
 * holds, and UNSAT is a discrete outcome the D grammar can gate on.
 *
 *   const { createSolver, snappedFrontier, solverConceptTree } = require('./solver-fork');
 *   register(Graph, [ createSolver({ solve: myZ3Backend }) ]);    // wires Solve::run
 *   const child = parent.fork(spec, { conceptMap: { common: solverConceptTree() } });
 *   await nextStable(child);
 *   parent.merge(child, 'prob', snappedFrontier({ targetId: 'prob' }));  // only sat+model cross
 *
 * The solver backend is INJECTED (backend-agnostic, like createLLMProvider's `ask`): a
 * `solve(spec) -> { sat, model, ...internals }` function. The packaged default is a
 * dependency-free backtracking finite-domain CSP (`backtrackColoring`) so the regime is
 * runnable out of the box; the architectural point — search, snapped frontier, auditable
 * D parent — is independent of hand-rolled-vs-Z3.
 */

// ---- reference C-regime backend: a dependency-free backtracking CSP (graph k-colouring) ----
// spec = { nodes:[...], edges:[[u,v],...], colors?:[...] } -> { sat, model, steps }.
// model = a node->colour assignment (the snapped enum the frontier carries); steps is a
// search-internal cost (stays in the fork — it must NOT cross the frontier).
function backtrackColoring( spec ) {
	spec = spec || {};
	var nodes = spec.nodes || [];
	var edges = spec.edges || [];
	var colors = spec.colors || ['R', 'G', 'B'];
	var assign = {}, adj = {};
	nodes.forEach(function ( n ) { adj[n] = []; });
	edges.forEach(function ( e ) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
	var steps = 0;
	function bt( i ) {
		if ( i === nodes.length ) return true;
		var n = nodes[i];
		for ( var ci = 0; ci < colors.length; ci++ ) {
			var c = colors[ci];
			steps++;
			if ( adj[n].every(function ( m ) { return assign[m] !== c; }) ) {
				assign[n] = c;
				if ( bt(i + 1) ) return true;
				delete assign[n];
			}
		}
		return false;
	}
	var sat = bt(0);
	return { sat: sat, model: sat ? Object.assign({}, assign) : null, steps: steps };
}

/**
 * Build the C-regime solver-fork provider fragment (host opt-in, like createVerifier).
 * @param opts.solve   injected backend `(spec) -> { sat, model, ...internals }`
 *                     (default: backtrackColoring).
 * @returns { Solve: { run } }
 *
 * Concept wiring (in the C-fork grammar — see solverConceptTree):
 *   { require:['toSolve'], provider:['Solve::run'], solve:{ specKey:'spec', as:'' } }
 * `specKey` names the scope fact holding the problem spec (omit -> the whole scope fact
 * bag is the spec). Emits the self-flag + <as>sat (bool) + <as>model (the snapped
 * assignment, null when UNSAT) + any solver internals the backend returns (e.g. `steps`)
 * — internals are kept on the CHILD and dropped by snappedFrontier at the merge.
 */
function createSolver( opts ) {
	opts = opts || {};
	var solve = opts.solve || backtrackColoring;
	return {
		Solve: {
			run: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ as: '' }, concept._schema && concept._schema.solve, argz && argz[0]),
				    spec = cfg.specKey ? graph.getRef(cfg.specKey, scope) : scope._,
				    r = solve(spec) || {},
				    as = cfg.as || '',
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[as + 'sat'] = !!r.sat;
				facts[as + 'model'] = r.sat ? (r.model != null ? r.model : null) : null;
				// solver internals (steps, the search tree, …) are emitted on the child only;
				// they document the search but must NOT cross the frontier (see snappedFrontier).
				for ( var k in r ) if ( k !== 'sat' && k !== 'model' ) facts[as + k] = r[k];
				cb(null, facts);
			}
		}
	};
}

/**
 * A merge-projection that crosses ONLY the snapped model across the frontier — the C-regime
 * barrier: the colour/assignment enums + the `sat` bool cross; search internals (step counts,
 * the search tree, continuous scores) stay in the fork. Pass the returned function as the
 * 3rd arg to `parent.merge(child, targetId, project)`.
 * @param opts.targetId  the parent object id to write onto (required)
 * @param opts.sourceId  the child object holding the solved facts (default = targetId)
 * @param opts.frontier  keys allowed to cross (default ['sat','model'])
 * @param opts.as        the child's output prefix (default '')
 */
function snappedFrontier( opts ) {
	opts = opts || {};
	var targetId = opts.targetId,
	    sourceId = opts.sourceId || targetId,
	    frontier = opts.frontier || ['sat', 'model'],
	    as = opts.as || '';
	return function ( child ) {
		var f = child.getEtty(sourceId)._,
		    tpl = { $$_id: targetId };
		frontier.forEach(function ( k ) { tpl[k] = f[as + k]; });  // ONLY these keys cross
		return tpl;
	};
}

/**
 * The C-fork grammar fragment: a `Solve` concept whose provider SEARCHES. Use it as the
 * forked sub-graph's conceptMap so the fork runs the C regime.
 * @param opts.require  the trigger fact that marks an object as "to solve" (default 'toSolve')
 * @param opts.specKey  scope fact holding the spec (passed through to the provider)
 * @param opts.as       output-fact prefix (default '')
 */
function solverConceptTree( opts ) {
	opts = opts || {};
	var solve = { as: opts.as || '' };
	if ( opts.specKey ) solve.specKey = opts.specKey;
	return {
		childConcepts: {
			Solve: {
				_id: 'Solve', _name: 'Solve',
				require: [opts.require || 'toSolve'],
				provider: ['Solve::run'],
				solve: solve
			}
		}
	};
}

module.exports = {
	backtrackColoring: backtrackColoring,
	createSolver: createSolver,
	snappedFrontier: snappedFrontier,
	solverConceptTree: solverConceptTree
};
