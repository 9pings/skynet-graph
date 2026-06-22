/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
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
 * Declarative AI-authoring as a CEGIS loop (counterexample-guided inductive
 * synthesis — Solar-Lezama 2006), the host-side capstone of roadmap #10
 * (doc/MODELISATION.md §6.5). Zero core change: it composes the engine's
 * `addConcept`/`patchConcept` with the author-time validator.
 *
 * The concept schema IS a typed grammar; the AI authors TERMS of it, the host owns
 * the PRIMITIVES (the provider palette + the ref alphabet). Two oracles bound the
 * search:
 *   - author-time oracle = `validateConceptTree` — a malformed candidate (prose
 *     dependency / bad expr / unknown ref / off-palette provider) is rejected
 *     BEFORE it touches the graph; the rejection is a counterexample;
 *   - behavioral oracle = the live graph — install, stabilize, test the goal
 *     predicate; an unmet goal is a counterexample.
 * Each counterexample is appended to `history` and handed to the next proposal, so
 * the candidate space strictly shrinks (CEGIS convergence / monotonicity).
 *
 *   const { authorConcept } = require('./author');
 *   const res = await authorConcept(graph, {
 *     goal:    (g) => ({ met: <bool>, counterexample: <string|null> }),
 *     propose: async ({ goal, history, round }) => ({ op:'add'|'patch', ... }),
 *     validate:{ palette, knownFacts, collectionKeys, strict },
 *     maxRounds: 5,
 *   });
 *   // res = { ok, concept?, rounds:[{proposal, outcome, counterexample?}], reason? }
 *
 * A `proposal` is one of:
 *   { op:'add',   parent:<nameOrId|null>, schema:<conceptSchema> }
 *   { op:'patch', nameOrId:<concept>,     updates:<partialSchema> }
 *
 * The proposer is INJECTED (an LLM::complete call in production; a deterministic
 * stub in tests) — same backend-agnostic discipline as the providers.
 */
const dmerge = require('deepmerge');
const { validateConceptTree } = require('./validate');

const replaceArrays = { arrayMerge: function ( _dest, src ) { return src; } };

// Wrap a single concept schema as a tree the validator can walk.
function asTree( schema ) {
	return { childConcepts: { [schema._id]: schema } };
}

// Await one stabilize after a structural op; surface a synchronous engine throw
// (e.g. duplicate _id, unknown parent) as a rejected promise.
//
// Engine gotcha (verified): `stabilize(cb)` only fires `cb` once something settles —
// i.e. only if the op destabilized at least one object. A NO-OP op (a patch that
// changes no cast-state, or an add that matches nothing) destabilizes nothing, so the
// "stabilize" event never comes and the callback would hang. But a no-op means the
// graph is ALREADY quiescent, so honour the callback on the next tick. A real op
// leaves `_unstable`/`_triggeredCastCount` non-empty and resolves via the event.
function applyOp( graph, proposal ) {
	return new Promise(function ( resolve, reject ) {
		var done = false;
		var finish = function () { if ( !done ) { done = true; resolve(); } };
		try {
			if ( proposal.op === 'patch' )
				graph.patchConcept(proposal.nameOrId, proposal.updates, finish);
			else
				graph.addConcept(proposal.parent == null ? null : proposal.parent, proposal.schema, finish);
		} catch ( e ) { return reject(e); }
		if ( !graph._unstable.length && !graph._triggeredCastCount ) setTimeout(finish);
	});
}

async function authorConcept( graph, spec ) {
	const goal       = spec.goal;
	const propose    = spec.propose;
	const validate   = spec.validate || {};
	const maxRounds  = spec.maxRounds || 5;
	const history    = [];

	for ( let round = 0; round < maxRounds; round++ ) {
		const proposal = await propose({ goal: spec.goalDescription, history, round });
		if ( !proposal ) break;                       // proposer gave up
		const op = proposal.op || 'add';

		// 1. AUTHOR-TIME ORACLE — validate the candidate (for a patch, validate the
		//    schema it would PRODUCE, so a patch that introduces a bad expr/ref is caught too).
		let tree;
		if ( op === 'patch' ) {
			const c = graph.getConceptByName(proposal.nameOrId);
			const merged = c ? dmerge(c._schema, proposal.updates || {}, replaceArrays)
			                 : Object.assign({ _id: proposal.nameOrId, _name: proposal.nameOrId }, proposal.updates);
			tree = asTree(merged);
		} else {
			tree = asTree(proposal.schema);
		}
		const errs = validateConceptTree(tree, validate).errors;
		if ( errs.length ) {
			history.push({ proposal, outcome: 'rejected', counterexample: `validation-failed: ${errs[0].kind} — ${errs[0].message}` });
			continue;
		}

		// 2. INSTALL — engine-level guards (dup _id, unknown parent) are counterexamples too.
		try {
			await applyOp(graph, proposal);
		} catch ( e ) {
			history.push({ proposal, outcome: 'rejected', counterexample: `install-failed: ${e.message}` });
			continue;
		}

		// 3. BEHAVIORAL ORACLE — does the live graph now satisfy the goal?
		const verdict = goal(graph) || {};
		if ( verdict.met ) {
			history.push({ proposal, outcome: 'met' });
			return { ok: true, concept: op === 'patch' ? proposal.nameOrId : proposal.schema._id, rounds: history };
		}
		history.push({ proposal, outcome: 'unmet', counterexample: verdict.counterexample || 'goal not met' });
	}

	return { ok: false, rounds: history, reason: 'maxRounds exhausted without meeting goal' };
}

module.exports = { authorConcept };
