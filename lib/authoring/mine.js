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
 * mine — sub-forest mining for crystallization (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-26-…, the #13 loop core).
 *
 * Inventing a nonterminal for a recurring sub-derivation = SUBDUE/SEQUITUR on the engine's
 * derivation forest. `mineChains` reads a corpus of apply-records (the `onConceptApply`
 * trace: `{concept, target}` firings) plus the concept schemas, and finds frequent
 * producer->consumer edges A->B (B `require`s a fact A produces, and both fired on the same
 * target). The top edges are candidate abstractions; `composeProviders` chains the
 * constituents' providers into one (threading each output into the next), so the proposed
 * abstract method can be measured by the MDL/utility gate (`abstraction.evaluate`).
 *
 *   const chains = mineChains(applyRecords, conceptTree);     // [{from,to,via,count}, …]
 *   const M = composeProviders(provA, provB);                 // one cast does both
 *   // -> evaluate({chainTree, abstractTree:{…M…}, …}) decides admission.
 *
 * `mineChains` keys only on STATIC produced facts (self-flag + applyMutations template keys
 * — the same extraction validate.js uses); provider-written facts are not statically known,
 * so the mined edge is the self-flag/template producer->consumer chain (the auditable spine).
 */
const { eachConcept, refsOf, refKeyOf, templateKeys } = require('./validate.js');

/**
 * Find frequent producer->consumer concept chains in a trace corpus.
 * @param records  [{ concept, target }]   apply-records (onConceptApply firings)
 * @param tree     the concept tree (for static produces/requires)
 * @returns [{ from, to, via, count }]  sorted by co-firing count (desc)
 */
function mineChains( records, tree ) {
	const concepts = [];
	eachConcept(tree, (c) => { if ( c._name ) concepts.push(c); });

	const produces = {}, requires = {};
	for ( const c of concepts ) {
		const schema = c._schema || c;
		produces[c._name] = new Set([c._name, ...templateKeys(schema.applyMutations)]);
		requires[c._name] = refsOf(schema.require, false).map((r) => refKeyOf(r).key);
	}

	const firedOn = {};                          // concept -> Set(target)
	for ( const r of (records || []) ) {
		if ( !r || !r.concept ) continue;
		(firedOn[r.concept] = firedOn[r.concept] || new Set()).add(r.target);
	}

	const out = [];
	for ( const A of concepts ) for ( const B of concepts ) {
		if ( A === B ) continue;
		let via = null;
		for ( const f of (requires[B._name] || []) )
			if ( produces[A._name] && produces[A._name].has(f) ) { via = f; break; }
		if ( !via ) continue;
		const tA = firedOn[A._name] || new Set(), tB = firedOn[B._name] || new Set();
		let count = 0;
		for ( const t of tA ) if ( tB.has(t) ) count++;
		if ( count > 0 ) out.push({ from: A._name, to: B._name, via, count });
	}
	out.sort((x, y) => y.count - x.count);
	return out;
}

/**
 * Chain N cb-style providers into one. Each provider's output facts are threaded into a
 * shadow scope for the next, and all output facts are merged into a single `_parent`
 * template — so one cast reproduces the whole chain (the inlined abstract method).
 * @param  {...Function} fns  providers `(graph, concept, scope, argz, cb)` -> cb(err, template)
 * @returns Function          a single provider with the same signature
 */
function composeProviders( ...fns ) {
	return function ( graph, concept, scope, argz, cb ) {
		const merged = {};
		const shadowFacts = Object.assign({}, (scope && scope._) || {});
		let i = 0;
		(function step() {
			if ( i >= fns.length ) {
				// the composed concept must mark ITS OWN self-flag cast (a provider concept
				// writes its self-flag in its template, else the engine never sees it cast and
				// re-fires it to the apply-cap). The constituents' flags are merged data facts.
				if ( concept && concept._name ) merged[concept._name] = true;
				return cb(null, Object.assign({ $_id: '_parent' }, merged));
			}
			const fn = fns[i++];
			const shadowScope = { _: shadowFacts, getRef: scope && scope.getRef ? scope.getRef.bind(scope) : undefined };
			fn(graph, concept, shadowScope, argz, function ( err, tpl ) {
				if ( err ) return cb(err);
				const objs = Array.isArray(tpl) ? tpl : (tpl ? [tpl] : []);
				for ( const o of objs ) {
					if ( !o || typeof o !== 'object' ) continue;
					for ( const raw of Object.keys(o) ) {
						if ( raw === '$_id' || raw === '$$_id' || raw === '_id' ) continue;
						const key = raw.replace(/^\$+/, '');
						merged[key] = o[raw];
						shadowFacts[key] = o[raw];
					}
				}
				step();
			});
		})();
	};
}

module.exports = { mineChains, composeProviders };
