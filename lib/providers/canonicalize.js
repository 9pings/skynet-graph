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
 * Deterministic fact canonicalization — the implementation half of the typed-fact
 * spine / canonicalization barrier (doc/MODELISATION.md §4.2, roadmap #1).
 *
 * WHY (the existential risk K1 — prose memo-fragmentation): a concept that depends
 * on variable LLM *prose* re-keys every run (two semantically-equal replies differ
 * textually) → the memo edge never hits → incrementality evaporates, *worse* than
 * nil (you still pay the watcher bookkeeping). The fix is a MODELING rule, enforced
 * here: an `LLM::complete` expert that feeds downstream experts emits a small set of
 * DISCRETE, TYPED, low-cardinality facts (enums, ids, numbers, booleans, short
 * canonical strings); only those are written as *tracked* keys; the free text is a
 * terminal, *untracked* fact. This module snaps the raw LLM values onto that grid.
 *
 * HARD RULE — deterministic snapping ONLY, never embedding/similarity matching.
 * A fuzzy false-hit (GPTCache-style ~33%) graves a WRONG fact that *propagates*
 * through the cascade-invalidation graph (it triggers/inhibits other concepts).
 * Strict structured extraction with a closed vocabulary fails closed instead.
 *
 * A fact spec is a small object:
 *   { enum: [...], default? }   snap to a closed vocabulary: exact match, else a
 *                               whitespace/case-normalized match; a miss -> `default`
 *                               (or null) and is reported in `misses` (fail-closed,
 *                               visible — never a silent wrong snap).
 *   { grain: N }                round a numeric to the nearest multiple of N (the
 *                               per-EDGE grain declaration: the downstream's needed
 *                               granularity, not a global setting).
 *   { type: 'int' | 'number' | 'bool' | 'id' | 'string' }   plain typed coercion.
 *   { from: 'rawKey' }          read the raw value from a different reply key
 *                               (combinable with any of the above).
 *
 * Everything here is pure and synchronous (independently unit-tested).
 */

// ---- closed-vocabulary normalization: trim, lowercase, collapse inner whitespace ----
function normToken( v ) {
	return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
}

// number of decimal places a grain implies (so 0.1 rounds to 1 decimal, 25 -> 0) ----
function grainDecimals( grain ) {
	var s = String(grain);
	var dot = s.indexOf('.');
	return dot === -1 ? 0 : (s.length - dot - 1);
}

/**
 * Canonicalize one raw value against one spec.
 * @returns {{ value: *, miss?: boolean }}  `miss:true` = out-of-vocabulary / un-coercible
 *                                          (the value falls back to `default`/null).
 */
function canonValue( raw, spec ) {
	spec = spec || {};

	// enum: snap to a closed vocabulary (deterministic, fail-closed) --------------
	if ( spec.enum ) {
		var vocab = spec.enum;
		for ( var i = 0; i < vocab.length; i++ ) if ( raw === vocab[i] ) return { value: vocab[i] };
		var nraw = normToken(raw);
		for ( var j = 0; j < vocab.length; j++ ) if ( normToken(vocab[j]) === nraw ) return { value: vocab[j] };
		return { value: spec.default !== undefined ? spec.default : null, miss: true };
	}

	// grain: round a numeric to the nearest multiple of N -------------------------
	if ( spec.grain != null ) {
		var n = typeof raw === 'number' ? raw : parseFloat(raw);
		if ( !isFinite(n) ) return { value: spec.default !== undefined ? spec.default : null, miss: true };
		var snapped = Math.round(n / spec.grain) * spec.grain;
		return { value: Number(snapped.toFixed(grainDecimals(spec.grain))) };
	}

	// plain typed coercion --------------------------------------------------------
	switch ( spec.type ) {
		case 'int': {
			var iv = typeof raw === 'number' ? raw : parseFloat(raw);
			return isFinite(iv) ? { value: Math.round(iv) } : { value: spec.default !== undefined ? spec.default : null, miss: true };
		}
		case 'number': {
			var fv = typeof raw === 'number' ? raw : parseFloat(raw);
			return isFinite(fv) ? { value: fv } : { value: spec.default !== undefined ? spec.default : null, miss: true };
		}
		case 'bool': {
			if ( typeof raw === 'boolean' ) return { value: raw };
			var t = normToken(raw);
			if ( t === 'true' || t === '1' || t === 'yes' || t === 'y' ) return { value: true };
			if ( t === 'false' || t === '0' || t === 'no' || t === 'n' || t === '' ) return { value: false };
			return { value: spec.default !== undefined ? spec.default : null, miss: true };
		}
		case 'id':
			return { value: raw == null ? (spec.default !== undefined ? spec.default : null) : String(raw).trim() };
		case 'string':
		default:
			// a SHORT canonical string (whitespace-normalized). Note: a free-text
			// field is prose, not a fact — keep it out of `facts`/off dependency edges.
			return { value: raw == null ? (spec.default !== undefined ? spec.default : null) : normTokenPreserveCase(raw) };
	}
}

// like normToken but preserves case (short canonical string, not a vocab key) ----
function normTokenPreserveCase( v ) {
	return String(v).trim().replace(/\s+/g, ' ');
}

/**
 * Canonicalize a raw reply object against a facts schema.
 * @param raw          the parsed LLM reply (a plain object)
 * @param factsSchema  { <factKey>: <spec> }
 * @returns {{ facts: {<factKey>: value}, misses: [<factKey>...] }}
 *          `facts` holds ONLY the declared keys, canonicalized — the tracked spine.
 */
function canonFacts( raw, factsSchema ) {
	raw = raw || {};
	var facts = {}, misses = [];
	Object.keys(factsSchema || {}).forEach(function ( key ) {
		var spec = factsSchema[key] || {};
		var src = spec.from != null ? spec.from : key;
		var out = canonValue(raw[src], spec);
		facts[key] = out.value;
		if ( out.miss ) misses.push(key);
	});
	return { facts: facts, misses: misses };
}

/**
 * Stable content digest of a canonical fact set — usable as an explicit memo key
 * so identical projections short-circuit *even across re-prose*. Keys sorted so the
 * digest is order-independent.
 */
function digest( facts ) {
	return JSON.stringify(facts || {}, Object.keys(facts || {}).sort());
}

module.exports = { canonValue: canonValue, canonFacts: canonFacts, digest: digest, normToken: normToken };
