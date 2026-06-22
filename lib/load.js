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
 * @returns {Object} conceptMap keyed by set name
 */
function loadConceptMap( concepts ) {
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
	return map;
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

module.exports = { loadConceptMap, loadProviders };
