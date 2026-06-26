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
 * abstraction — the MDL/utility admission gate for "abstract methods" (host-side, ZERO-CORE;
 * study doc/WIP/studies/2026-06-26-…, promotes experiment F2).
 *
 * Hybridizing concepts into a reusable abstract method = inventing a nonterminal for a
 * recurring sub-derivation. Grammar theory gives ONE admission criterion (Minton speedup-
 * utility ≡ SEQUITUR rule-utility ≡ smallest-grammar MDL ≡ Lari-Young nonterminal control):
 * **admit a learned production iff its net utility is positive**. Here, "utility" is measured
 * empirically on the real engine — an abstract grammar is admitted iff it is
 *   (a) VALID (passes the author-time validator),
 *   (b) fixpoint-EQUIVALENT to the chain it replaces (same external facts), and
 *   (c) net-CHEAPER (fewer cumulative applies — the refactor win).
 * Keeping the macro *alongside* its constituents (no refactor) costs more applies for the
 * same result -> a net tax (Minton 1990) -> rejected. This is the offline, author-time form
 * the adversarial lens endorsed ("library curation with a gate"); it never mints mid-stabilize.
 *
 *   const { evaluate } = require('./abstraction');
 *   const r = await evaluate({ seed, providers, chainTree, abstractTree, equivKeys: ['amplified'] });
 *   if (r.admit) // adopt abstractTree as the grammar
 */
const Graph = require('../graph/index.js');
const { nextStable } = require('./supervise.js');
const { validateConceptTree } = require('./validate.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

// Boot a tree on the seed, count cumulative applies, and collect the values of `equivKeys`
// per object — the external contract by which two grammars are compared for equivalence.
async function bootMeasure( tree, seed, providers, opts ) {
	Graph._providers = Object.assign({}, Graph._providers || {}, providers || {});
	let applies = 0;
	const cfg = {
		label: opts.label || 'abstraction', isMaster: true, autoMount: true,
		conceptSets: opts.conceptSets || ['common'], bagRefManagers: {}, logLevel: 'error',
		onConceptApply: function () { applies++; },
	};
	const g = new Graph(clone(seed || { lastRev: 0, nodes: [], segments: [] }), cfg, { common: clone(tree) });
	await nextStable(g);
	const keys = opts.equivKeys || [];
	const facts = {};
	for ( const id of Object.keys(g._objById || {}) ) {
		const etty = g._objById[id] && g._objById[id]._etty;
		const f = etty && etty._;
		if ( !f ) continue;
		const proj = {};
		let has = false;
		for ( const k of keys ) if ( k in f ) { proj[k] = f[k]; has = true; }
		if ( has ) facts[id] = proj;
	}
	return { applies, facts };
}

// Same set of objects, same value for every compared key on each.
function factsEqual( a, b ) {
	const ka = Object.keys(a), kb = Object.keys(b);
	if ( ka.length !== kb.length ) return false;
	for ( const id of ka ) {
		if ( !(id in b) ) return false;
		if ( JSON.stringify(a[id]) !== JSON.stringify(b[id]) ) return false;
	}
	return true;
}

/**
 * Evaluate whether `abstractTree` should be admitted over `chainTree`.
 * @param opts.seed/providers      the representative episode to measure on
 * @param opts.chainTree           the incumbent grammar (the constituents)
 * @param opts.abstractTree        the candidate grammar (with the abstract method)
 * @param opts.equivKeys           the external output facts that define equivalence
 * @param opts.validate            opts forwarded to validateConceptTree (palette, etc.)
 * @returns {{ valid, errors, equivalent, chainApplies, abstractApplies, gain, admit }}
 */
async function evaluate( opts ) {
	opts = opts || {};
	const { errors } = validateConceptTree(opts.abstractTree, opts.validate || {});
	const valid = errors.length === 0;
	const chain = await bootMeasure(opts.chainTree, opts.seed, opts.providers, Object.assign({ label: 'chain' }, opts));
	const abstract = await bootMeasure(opts.abstractTree, opts.seed, opts.providers, Object.assign({ label: 'abstract' }, opts));
	const equivalent = factsEqual(chain.facts, abstract.facts);
	const gain = chain.applies - abstract.applies;
	return {
		valid, errors,
		equivalent,
		chainApplies: chain.applies, abstractApplies: abstract.applies,
		gain,
		admit: valid && equivalent && gain > 0,
	};
}

/**
 * Adapt the MDL/utility gate to the shape `authorConcept`'s `spec.gate` expects, so the
 * CEGIS loop self-admits abstractions: only an 'add' proposal that `evaluate` admits (valid
 * + fixpoint-equivalent + net-cheaper vs the reference `chainTree`) is installed.
 * @param opts.chainTree/seed/providers/equivKeys  the reference episode (as for evaluate)
 * @param opts.asAbstractTree  (proposal)->tree   how to read the candidate grammar from a
 *                             proposal (default: the single proposed schema as a tree)
 * @returns async (graph, proposal) => { admit, reason, eval }
 */
function makeAbstractionGate( opts ) {
	opts = opts || {};
	const asAbstractTree = opts.asAbstractTree
		|| ((proposal) => ({ childConcepts: { [proposal.schema._id]: proposal.schema } }));
	return async function gate( graph, proposal ) {
		if ( (proposal.op || 'add') !== 'add' ) return { admit: true };   // gate only ADDs
		const r = await evaluate({
			seed: opts.seed, providers: opts.providers, chainTree: opts.chainTree,
			abstractTree: asAbstractTree(proposal), equivKeys: opts.equivKeys, validate: opts.validate,
		});
		return { admit: r.admit, reason: r.admit ? null : `not admitted (equivalent=${r.equivalent}, gain=${r.gain})`, eval: r };
	};
}

module.exports = { evaluate, bootMeasure, factsEqual, makeAbstractionGate };
