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
 * study docs/WIP/studies/2026-06-26-…, promotes experiment F2).
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
 *   const { evaluate } = require('../core/abstraction.js');
 *   const r = await evaluate({ seed, providers, chainTree, abstractTree, equivKeys: ['amplified'] });
 *   if (r.admit) // adopt abstractTree as the grammar
 */
const Graph = require('../../graph/index.js');
const { nextStable } = require('../core/supervise.js');
const { validateConceptTree } = require('../core/validate.js');
const { forkPlan, bagInterface, conceptCliques } = require('../core/decompose.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

// Collect the names of concepts that INVOKE a provider — the casts that cost an (LLM-ish) model call.
// The U4 currency fix: the utility gate must score MODEL CALLS, not all `applies` (a provider-less
// applyMutations cast is ~free; fusing it away saves nothing — Minton 1990, the utility problem).
function providerNames( tree, out ) {
	out = out || new Set();
	const walk = ( node, isChild ) => {
		if ( !node || typeof node !== 'object' ) return;
		const schema = node._schema || node;
		if ( (isChild || node._name) && node._name && schema.provider ) out.add(node._name);
		if ( node.childConcepts ) for ( const k of Object.keys(node.childConcepts) ) walk(node.childConcepts[k], true);
	};
	walk(tree, false);
	return out;
}

// Boot a tree on the seed, count cumulative applies AND estimated model-cost, and collect the values of
// `equivKeys` per object — the external contract by which two grammars are compared for equivalence.
async function bootMeasure( tree, seed, providers, opts ) {
	Graph._providers = Object.assign({}, Graph._providers || {}, providers || {});
	const provSet = providerNames(tree);
	// cost currency (U4): opts.cost(name)->estimate, else 1 per provider-bearing cast, 0 for provider-less.
	const costOf = opts.cost || (( name ) => (provSet.has(name) ? 1 : 0));
	let applies = 0, cost = 0;
	const cfg = {
		label: opts.label || 'abstraction', isMaster: true, autoMount: true,
		conceptSets: opts.conceptSets || ['common'], bagRefManagers: {}, logLevel: 'error',
		onConceptApply: function ( rec ) { applies++; cost += (costOf(rec && rec.conceptName) || 0); },
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
	return { applies, cost, facts };
}

// Σ_sep NON-REGRESSION (the E7 rule, refined by the 2026-06-30 Laurie confront): a created/merged method must not
// WIDEN the bounded-context HORIZON. The sound object is the bag-intersection MINIMAL-INTERFACE width (`bagInterface`,
// Robertson-Seymour 1986) — NOT the scalar min-fill treewidth (an uncoupled upper bound → false-admits a real
// regression) NOR the size-1 articulation `widened` alone (blind to a size-1→size-2 cut). Both are kept as DIAGNOSTICS.
// FIX (finding): the prior code fed `forkPlan({common: tree})`, which `conceptCliques` does NOT unwrap → 0 cliques →
// the gate was VACUOUS (`widened` always []). The trees are the bare childConcepts form; feed them DIRECTLY.
function interfaceRegression( chainTree, abstractTree ) {
	let before, after;
	try { before = forkPlan(chainTree); } catch ( e ) { before = null; }
	try { after = forkPlan(abstractTree); } catch ( e ) { after = null; }
	const sepB = new Set((before && before.separators) || []);
	const sepA = (after && after.separators) || [];
	const widened = sepA.filter(( s ) => !sepB.has(s));     // (diagnostic) size-1 articulation keys the abstraction ADDED
	const bagB = bagInterface(conceptCliques(chainTree)), bagA = bagInterface(conceptCliques(abstractTree));
	const mB = bagB.minimalInterface.size, mA = bagA.minimalInterface.size;
	// the SOUND gate fires only on a genuine CROSS-TILE widening — BOTH sides divisible (a real thin interface exists
	// on each) and the after's thinnest cut is wider. A fusion that COLLAPSES a chain to a single concept makes the
	// after INDIVISIBLE (a black box); its internal clique is the UTILITY gate's concern, NOT a bounded-context
	// regression (the original `interfaceRegression` comment, vindicated). So indivisible-after is never an interface regress.
	const interfaceRegressed = !bagA.indivisible && !bagB.indivisible && mA > mB;
	return {
		separatorsBefore: [...sepB].sort(), separatorsAfter: sepA.slice().sort(), widened,
		treewidthBefore: bagB.treewidth, treewidthAfter: bagA.treewidth,                 // diagnostic (NOT gated — see confront)
		minimalInterfaceBefore: bagB.minimalInterface, minimalInterfaceAfter: bagA.minimalInterface,
		indivisibleBefore: bagB.indivisible, indivisibleAfter: bagA.indivisible,
		interfaceRegressed,                                                              // the SOUND gate: the cross-tile horizon widened
		sigmaSepBefore: bagB.sigmaSep, sigmaSepAfter: bagA.sigmaSep
	};
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
	const costGain = chain.cost - abstract.cost;                 // U4: the LLM-cost currency (model calls saved)
	const iface = interfaceRegression(opts.chainTree, opts.abstractTree);
	// E7 (refined): the SOUND gate is the bag-intersection minimal-interface non-regression (`interfaceRegressed`);
	// the size-1 articulation `widened` is kept as an additional necessary check (a new size-1 cut key is a regression
	// the interface-width can miss when the cut count, not its width, grows). The scalar treewidth is NOT gated.
	const interfaceOk = !iface.interfaceRegressed && iface.widened.length === 0;
	// admit on the CORRECT currency (model-cost), equivalence, validity, and no interface regression. `gain`
	// (applies) stays reported for continuity; a degenerate corpus with no providers falls back to applies.
	const utility = (chain.cost > 0 || abstract.cost > 0) ? costGain : gain;
	return {
		valid, errors,
		equivalent,
		chainApplies: chain.applies, abstractApplies: abstract.applies, gain,
		chainCost: chain.cost, abstractCost: abstract.cost, costGain,
		interface: iface, interfaceOk,
		admit: valid && equivalent && utility > 0 && interfaceOk,
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

module.exports = { evaluate, bootMeasure, factsEqual, makeAbstractionGate, interfaceRegression, providerNames };
