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
 * Directory loaders — turn on-disk concept sets and provider modules into the
 * shapes the engine expects, so a host (or the `sg` CLI) can boot a graph from
 * plain folders passed by path. Kept OUT of lib/graph/* on purpose: the engine
 * core stays filesystem-free (hermetic/portable); all fs lives here at the edge.
 */
const fs   = require('fs');
const path = require('path');
const { buildConceptTree } = require('./authoring/concepts.js');

/**
 * Build a conceptMap ({ <setName>: tree }) from one or more directories.
 *
 * Each argument dir is auto-classified:
 *  - if it directly contains top-level *.json -> it IS a single set (name = its
 *    basename), e.g. loadConceptMap('./concepts/common') -> { common: tree };
 *  - else each immediate sub-directory holding *.json is a set, e.g.
 *    loadConceptMap('./concepts') -> { common: tree, ... }.
 *
 * @param {string|string[]} concepts  dir path(s)
 * @param {object} [opts]   { validate: true } runs validateConceptTree per set and THROWS an
 *                          aggregated error if any set has errors (a strict validating load).
 * @returns {Object} conceptMap keyed by set name
 */
function loadConceptMap( concepts, opts = {} ) {
	const dirs = Array.isArray(concepts) ? concepts : [concepts];
	const map  = {};
	for ( const d of dirs ) {
		const abs     = path.resolve(d);
		const entries = fs.readdirSync(abs, { withFileTypes: true });
		const hasTopJson = entries.some(e => e.isFile() && e.name.endsWith('.json'));
		if ( hasTopJson ) {
			map[path.basename(abs)] = buildConceptTree(abs);
		} else {
			for ( const e of entries ) {
				if ( !e.isDirectory() ) continue;
				const setDir = path.join(abs, e.name);
				if ( fs.readdirSync(setDir).some(f => f.endsWith('.json')) )
					map[e.name] = buildConceptTree(setDir);
			}
		}
	}
	if ( opts.validate ) {
		const { validateConceptTree } = require('./authoring/validate.js');
		const fails = [];
		for ( const set of Object.keys(map) )
			for ( const err of validateConceptTree(map[set], opts.validateOpts || {}).errors )
				fails.push(`[${set}] ${err.concept} — ${err.kind}: ${err.message}`);
		if ( fails.length ) throw new Error('concept validation failed:\n' + fails.join('\n'));
	}
	return map;
}

// Keys re-derived from the file path on load (concepts.js#buildConceptTree), so they are NOT
// written back out — and childConcepts becomes a sibling directory, not a key.
const NON_FILE_KEYS = new Set(['_id', '_name', 'childConcepts']);

/**
 * Write a serialized concept tree back to the on-disk JSONC layout (the inverse of
 * buildConceptTree / loadConceptMap): one `<Name>.json` per concept, a `<Name>/` sub-directory
 * for its children. Comments are NOT preserved (prose belongs in a typed `_description`/`note`
 * field); the result reloads to the identical tree. fs lives here at the edge, not in the core.
 * @param tree  a `{ childConcepts: {...} }` tree (e.g. graph.exportConcepts())
 * @param dir   target directory (created if missing)
 * @returns dir
 */
function exportConceptsToDir( tree, dir ) {
	fs.mkdirSync(dir, { recursive: true });
	const kids = (tree && tree.childConcepts) || {};
	for ( const name of Object.keys(kids) ) {
		const node   = kids[name];
		const schema = {};
		for ( const k of Object.keys(node) ) if ( !NON_FILE_KEYS.has(k) ) schema[k] = node[k];
		fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(schema, null, 2) + '\n');
		if ( node.childConcepts && Object.keys(node.childConcepts).length )
			exportConceptsToDir(node, path.join(dir, name));
	}
	return dir;
}

/**
 * Collect provider-map fragments from module file(s)/dir(s) (or pass-through
 * fragment objects). A provider module exports either:
 *  - a fragment map `{ Namespace: { fn } }`,
 *  - `{ default: fragment }`, or
 *  - a factory `(ctx) => fragment` (so it can self-configure from `ctx`, e.g. an
 *    LLM `ask` backend or env). `ctx` is whatever the caller passes.
 *
 * Returns an array suitable for `register(Graph, fragments)`.
 *
 * @param {string|object|Array} providers  dir/file path(s) and/or fragment object(s)
 * @param {object} [ctx]  passed to any factory module
 * @returns {object[]} fragments
 */
function loadProviders( providers, ctx = {} ) {
	const items     = Array.isArray(providers) ? providers : [providers];
	const fragments = [];
	for ( const item of items ) {
		if ( item && typeof item === 'object' ) { fragments.push(item); continue; } // already a fragment
		const abs   = path.resolve(item);
		const files = fs.statSync(abs).isDirectory()
			? fs.readdirSync(abs).filter(f => f.endsWith('.js')).sort().map(f => path.join(abs, f))
			: [abs];
		for ( const f of files ) {
			let mod = require(f);
			if ( typeof mod === 'function' ) mod = mod(ctx);                       // factory(ctx)
			else if ( mod && typeof mod.default !== 'undefined' ) mod = mod.default; // esm-interop default
			if ( mod && typeof mod === 'object' ) fragments.push(mod);
		}
	}
	return fragments;
}

module.exports = { loadConceptMap, loadProviders, exportConceptsToDir };
