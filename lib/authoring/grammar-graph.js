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
 * Grammar graph (host-side authoring tool, zero core change) — the second, orthogonal view
 * the Studio was missing: not the IS-A tree (`childConcepts`, already shown), but the
 * concept↔fact FLUX graph, where the real interactions live.
 *
 * A grammar's concepts interact through FACTS: a concept WRITES facts (its self-flag + the
 * keys its `applyMutations` template sets) and READS facts (its `require` LHS + the `$ref`s in
 * its `assert`/`ensure`, with the dependency's POLARITY — a `!$f` / `$f==false` read is a
 * defeasance edge). Crossing two concept sets, a fact written in one set and read in another is
 * a CROSS-CORPUS link; a fact written in two sets is a silent COLLISION (the `leadTime` trap);
 * a fact read but produced by nobody is an external ENTRY POINT (seed / engine input).
 *
 *   const { conceptFactGraph } = require('./grammar-graph');
 *   const g = conceptFactGraph({ common: tree, clinical: tree2 });
 *   // g.concepts, g.facts, g.edges, g.crossCorpus, g.collisions, g.entryPoints, g.tiling
 *
 * The ref / polarity / produced-fact extraction reuses validate.js (single source of truth);
 * the tiling overlay (separators / forks / frontier alphabets) comes from decompose.js#forkPlan.
 * Pure static analysis — no engine runtime.
 */
const { eachConcept, refsOf, refKeyOf, templateKeys, negatedRefKeys } = require('./validate');
const { parseExpression } = require('../graph/expr');
const { forkPlan } = require('./decompose');

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const schemaOf = (c) => (c && c._schema) || c || {};

function conceptKind( schema ) {
	const p = schema.provider;
	if ( !p ) return 'pure';
	const name = Array.isArray(p) ? p[0] : p;
	return (typeof name === 'string' && name.startsWith('LLM::')) ? 'llm' : 'provider';
}

// A `$$key` in a mutation template marks a bagRef (external data) — detect it for the flag badge.
function hasBagRef( applyMutations ) {
	for ( const obj of asArray(applyMutations) ) {
		if ( !obj || typeof obj !== 'object' ) continue;
		for ( const k of Object.keys(obj) ) if ( k.startsWith('$$') ) return true;
	}
	return false;
}

function conceptFlags( schema ) {
	return {
		onCast       : !!schema.onCast,        // standing-cluster subscribe hook
		cleaner      : !!schema.cleaner,        // retraction / teardown hook
		autoCastFalse: schema.autoCast === false,
		enum         : schema.type === 'enum',
		bagRef       : hasBagRef(schema.applyMutations)
	};
}

// Is this a set-map ({ setName: tree }) or a single bare tree (has its own childConcepts)?
function asSetMap( conceptMap ) {
	if ( conceptMap && Object.prototype.hasOwnProperty.call(conceptMap, 'childConcepts') )
		return { default: conceptMap };
	return conceptMap || {};
}

// Shallow-merge the top-level childConcepts of every set into one tree (nested childConcepts are
// preserved) for the tiling overlay. An approximation of the engine's deepmerge — enough for the
// static decomposition; a same-named top-level concept in two sets is overwritten (last wins).
function mergeTrees( trees ) {
	const childConcepts = {};
	for ( const t of trees ) Object.assign(childConcepts, (t && t.childConcepts) || {});
	return { childConcepts };
}

/**
 * Build the concept↔fact grammar graph from a concept map (or a single tree).
 * @param conceptMap { setName: tree, … }  or a single concept tree
 * @returns {{
 *   concepts: Array<{id,name,set,kind,flags}>,
 *   facts:    Array<{key,producedBy:string[],consumedBy:Array<{name,polarity,via}>,sets:string[]}>,
 *   edges:    Array<{kind:'writes',concept,fact} | {kind:'reads',concept,fact,polarity,via}>,
 *   crossCorpus: Array<{fact,fromSet,toSet}>,
 *   collisions:  Array<{fact,sets:string[]}>,
 *   entryPoints: string[],
 *   tiling: object|null
 * }}
 */
function conceptFactGraph( conceptMap ) {
	const map = asSetMap(conceptMap);
	const sets = Object.keys(map);

	const concepts = [];
	const setOfConcept = new Map();          // concept name -> set
	const edges = [];
	const producersByFact = new Map();        // fact -> Set(concept name)
	const producerSetsByFact = new Map();     // fact -> Set(set)

	for ( const set of sets ) {
		eachConcept(map[set], ( c, key ) => {
			const schema = schemaOf(c);
			const name = c._name || key;
			if ( !name ) return;               // unnamed node — validate.js flags it; skip here
			concepts.push({ id: c._id || name, name, set, kind: conceptKind(schema), flags: conceptFlags(schema) });
			setOfConcept.set(name, set);

			// produced: self-flag + applyMutations keys
			const produced = new Set([name, ...templateKeys(schema.applyMutations)]);
			for ( const f of produced ) {
				edges.push({ kind: 'writes', concept: name, fact: f });
				if ( !producersByFact.has(f) ) producersByFact.set(f, new Set());
				producersByFact.get(f).add(name);
				if ( !producerSetsByFact.has(f) ) producerSetsByFact.set(f, new Set());
				producerSetsByFact.get(f).add(set);
			}

			// consumed: require (positive); assert/ensure (polarity from the AST)
			for ( const r of refsOf(schema.require, false) )
				edges.push({ kind: 'reads', concept: name, fact: refKeyOf(r).key, polarity: '+', via: 'require' });
			for ( const via of ['assert', 'ensure'] )
				for ( const e of asArray(schema[via]) ) {
					if ( typeof e !== 'string' ) continue;
					let ast; try { ast = parseExpression(e); } catch ( _e ) { ast = null; }
					const negs = negatedRefKeys(ast);
					for ( const r of refsOf(e, true) ) {
						const k = refKeyOf(r).key;
						edges.push({ kind: 'reads', concept: name, fact: k, polarity: negs.has(k) ? '-' : '+', via });
					}
				}
		});
	}

	// consumers per fact
	const consumersByFact = new Map();        // fact -> [{name,polarity,via}]
	const consumerSetsByFact = new Map();     // fact -> Set(set)
	for ( const e of edges ) if ( e.kind === 'reads' ) {
		if ( !consumersByFact.has(e.fact) ) consumersByFact.set(e.fact, []);
		consumersByFact.get(e.fact).push({ name: e.concept, polarity: e.polarity, via: e.via });
		const s = setOfConcept.get(e.concept);
		if ( !consumerSetsByFact.has(e.fact) ) consumerSetsByFact.set(e.fact, new Set());
		if ( s ) consumerSetsByFact.get(e.fact).add(s);
	}

	const allFacts = new Set([...producersByFact.keys(), ...consumersByFact.keys()]);
	const facts = [...allFacts].sort().map(( key ) => ({
		key,
		producedBy: [...(producersByFact.get(key) || [])].sort(),
		consumedBy: (consumersByFact.get(key) || []).slice()
			.sort(( a, b ) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
		sets: [...new Set([...(producerSetsByFact.get(key) || []), ...(consumerSetsByFact.get(key) || [])])].sort()
	}));

	// collisions: a fact written by concepts in >= 2 sets
	const collisions = [];
	for ( const [fact, setSet] of producerSetsByFact )
		if ( setSet.size >= 2 ) collisions.push({ fact, sets: [...setSet].sort() });
	collisions.sort(( a, b ) => (a.fact < b.fact ? -1 : 1));

	// cross-corpus links: produced in set X, consumed in set Y != X
	const crossCorpus = [];
	for ( const fact of allFacts ) {
		const pSets = producerSetsByFact.get(fact) || new Set();
		const cSets = consumerSetsByFact.get(fact) || new Set();
		for ( const from of pSets ) for ( const to of cSets ) if ( from !== to )
			crossCorpus.push({ fact, fromSet: from, toSet: to });
	}
	crossCorpus.sort(( a, b ) => (a.fact < b.fact ? -1 : a.fact > b.fact ? 1 : a.fromSet < b.fromSet ? -1 : 1));

	// entry points: read by someone, produced by no one (external / seed / engine input)
	const entryPoints = [...allFacts].filter(( f ) => !producersByFact.has(f) && consumersByFact.has(f)).sort();

	// tiling overlay (best-effort; never throw the whole derivation on a degenerate corpus)
	let tiling = null;
	try { tiling = forkPlan(mergeTrees(sets.map(( s ) => map[s]))); } catch ( _e ) { tiling = null; }

	return { concepts, facts, edges, crossCorpus, collisions, entryPoints, tiling };
}

module.exports = { conceptFactGraph };
