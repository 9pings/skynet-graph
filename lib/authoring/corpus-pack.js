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
 * Corpus exchange (host-side, fs-free) — a portable `.sgc` bundle for moving a concept corpus
 * (a grammar) between hosts/instances, with a DERIVED manifest so the receiver knows what the
 * corpus needs and crosses.
 *
 * The worker boundary already proves a JSON concept map is a viable wire form (lib/runtime ships
 * exactly that). What was missing for real portability is the METADATA — what providers the
 * corpus calls, what facts it produces vs. consumes (its narrow-waist alphabet = the assume-
 * guarantee contract), and what other sets it links to. `deriveManifest` computes all of that
 * from the tree (via grammar-graph.js), so nothing has to be hand-maintained.
 *
 *   const { packCorpus, unpackCorpus } = require('./corpus-pack');
 *   const bundle = packCorpus({ common: tree }, { name: 'common', version: '1.0.0' });  // -> .sgc JSON
 *   const { conceptMap, manifest, validation } = unpackCorpus(bundle, { validate: true });
 *
 * The on-disk JSONC tree stays canonical for editing (lib/load.js#exportConceptsToDir is the
 * disk round-trip); the `.sgc` bundle is the single-file exchange artifact.
 */
const { conceptFactGraph } = require('./grammar-graph');
const { validateConceptTree, eachConcept } = require('./validate');

// Accept either a concept map ({ set: tree }) or a single bare tree (-> { name: tree }).
function asSetMap( input, name ) {
	if ( input && Object.prototype.hasOwnProperty.call(input, 'childConcepts') )
		return { [name || 'corpus']: input };
	return input || {};
}

// Every distinct `Ns::fn` provider string the corpus calls.
function providersOf( conceptMap ) {
	const provs = new Set();
	for ( const set of Object.keys(conceptMap) )
		eachConcept(conceptMap[set], ( c ) => {
			const schema = (c && c._schema) || c || {};
			const p = schema.provider;
			if ( !p ) return;
			const name = Array.isArray(p) ? p[0] : p;
			if ( typeof name === 'string' ) provs.add(name);
		});
	return [...provs].sort();
}

/**
 * Derive the corpus manifest from its concept map (or single tree). All fields are computed —
 * the only inputs are the optional name/version/description.
 * @returns {{name,version,description,conceptSets,conceptCount,providersRequired,
 *            alphabet:{produces,consumes},crossCorpus,collisions,extends}}
 */
function deriveManifest( conceptMap, meta ) {
	meta = meta || {};
	const map = asSetMap(conceptMap, meta.name);
	const g = conceptFactGraph(map);
	return {
		name             : meta.name || Object.keys(map).join('+'),
		version          : meta.version || '0.0.0',
		description      : meta.description || '',
		conceptSets      : Object.keys(map).sort(),
		conceptCount     : g.concepts.length,
		providersRequired: providersOf(map),
		// the narrow-waist alphabet: facts the corpus WRITES vs. external facts it READS
		alphabet         : {
			produces: g.facts.filter(( f ) => f.producedBy.length).map(( f ) => f.key).sort(),
			consumes: g.entryPoints.slice().sort()
		},
		crossCorpus      : g.crossCorpus,
		collisions       : g.collisions,
		extends          : [...new Set(g.crossCorpus.map(( l ) => l.fromSet))].sort()
	};
}

/**
 * Pack a corpus into a portable `.sgc` bundle (plain JSON).
 * @param input  concept map ({ set: tree }) or a single tree
 * @param opts   { name, version, description, seed }
 */
function packCorpus( input, opts ) {
	opts = opts || {};
	const map = asSetMap(input, opts.name);
	const bundle = {
		format    : 'sgc',
		sgcVersion: 1,
		manifest  : deriveManifest(map, opts),
		conceptMap: JSON.parse(JSON.stringify(map))
	};
	if ( opts.seed !== undefined ) bundle.seed = opts.seed;
	return bundle;
}

/**
 * Unpack a `.sgc` bundle. With `{ validate: true }` it runs validateConceptTree per set and
 * returns the records (it never throws on a grammar error — the caller decides severity).
 * @returns {{ conceptMap, manifest, seed, validation }}
 */
function unpackCorpus( bundle, opts ) {
	opts = opts || {};
	if ( !bundle || bundle.format !== 'sgc' ) throw new Error('not an .sgc bundle');
	const conceptMap = bundle.conceptMap || {};
	let validation = null;
	if ( opts.validate )
		validation = Object.keys(conceptMap).map(( set ) => {
			const r = validateConceptTree(conceptMap[set], opts.validateOpts || {});
			return { set, errors: r.errors, warnings: r.warnings };
		});
	return { conceptMap, manifest: bundle.manifest, seed: bundle.seed, validation };
}

module.exports = { deriveManifest, packCorpus, unpackCorpus };
