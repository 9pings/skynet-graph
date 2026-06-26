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
 * memo-stability — the safety instrument for structure-learning (host-side, ZERO-CORE;
 * study doc/WIP/studies/2026-06-26-…, promotes experiment F4).
 *
 * WHY. The engine's incrementality rides on the canonicalization memo: identical typed
 * inputs to a concept ⇒ identical `<name>FactsDigest` ⇒ memo hit, no re-derivation. A
 * structural change (addConcept/patchConcept, or a mined abstraction) is SAFE iff it is
 * **memo-surface-preserving** — it must not alter the canonical facts that incumbent
 * concepts' `require`/`ensure`/`assert` read. Violating this collapses the memo silently
 * (the only "quiet failure" the adversarial lens identified). This module makes the F4
 * boundary a reusable, gateable check.
 *
 *   const { memoSnapshot, memoDiff } = require('./memo-stability');
 *   const before = memoSnapshot(graph, ['Consume']);   // incumbents to protect
 *   graph.addConcept(null, candidateSchema, () => {
 *     const { stable, changed } = memoDiff(before, memoSnapshot(graph, ['Consume']));
 *     // stable === false ⇒ the candidate perturbed an incumbent's memo key ⇒ reject/rollback
 *   });
 *
 * A concept's MEMO SURFACE = the fact keys its require/ensure/assert depend on (the same
 * ref extraction `validate.js` uses, single source of truth). A snapshot digests, per
 * (object × concept), the projection of the object's facts onto that surface — so a drift
 * in any depended-on key shows up as a changed digest, while an isolated new fact does not.
 */
const canon = require('../providers/canonicalize.js');
const { refsOf, refKeyOf } = require('./validate.js');

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** The fact keys a concept's require/ensure/assert read — its incremental memo surface. */
function memoSurfaceKeys( graph, conceptName ) {
	const c = graph.getConceptByName ? graph.getConceptByName(conceptName) : null;
	const schema = (c && (c._schema || c)) || {};
	const keys = new Set();
	for ( const r of refsOf(schema.require, false) ) keys.add(refKeyOf(r).key);
	for ( const fld of ['ensure', 'assert'] )
		for ( const e of asArray(schema[fld]) )
			if ( typeof e === 'string' ) for ( const r of refsOf(e, true) ) keys.add(refKeyOf(r).key);
	return [...keys];
}

/**
 * Capture the memo keys of the named incumbents across the live graph.
 * @param graph         a live Graph
 * @param conceptNames  incumbents to protect (default: every concept in the lib)
 * @returns {{[key:string]: string}}  "<objId>|<conceptName>" -> digest of the depended-on facts
 */
function memoSnapshot( graph, conceptNames ) {
	const out = {};
	const names = conceptNames || Object.keys(graph._conceptLib || {});
	const objs = graph._objById || {};
	for ( const name of names ) {
		const keys = memoSurfaceKeys(graph, name);
		if ( !keys.length ) continue;
		for ( const id of Object.keys(objs) ) {
			const etty = objs[id] && objs[id]._etty;
			const facts = etty && etty._;
			if ( !facts ) continue;
			const proj = {};
			let has = false;
			for ( const k of keys ) if ( k in facts ) { proj[k] = facts[k]; has = true; }
			if ( has ) out[id + '|' + name] = canon.digest(proj);
		}
	}
	return out;
}

/**
 * Compare two snapshots. `stable` iff no depended-on memo key changed or disappeared.
 * @returns {{ stable:boolean, changed:Array<{key,before,after}>, removed:string[], added:string[] }}
 */
function memoDiff( before, after ) {
	const changed = [], removed = [];
	for ( const k of Object.keys(before) ) {
		if ( !(k in after) ) removed.push(k);
		else if ( after[k] !== before[k] ) changed.push({ key: k, before: before[k], after: after[k] });
	}
	const added = Object.keys(after).filter((k) => !(k in before));
	return { stable: changed.length === 0 && removed.length === 0, changed, removed, added };
}

module.exports = { memoSnapshot, memoDiff, memoSurfaceKeys };
