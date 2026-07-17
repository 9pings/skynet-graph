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
 * Deterministic fact canonicalization — the implementation half of the typed-fact
 * spine / canonicalization barrier (docs/MODELISATION.md §4.2, roadmap #1).
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

// ─────────────────────────── the enum normalization map (+ optional CURATED SYNONYM RING) ──────────────────────────
//
// A per-spec compiled, CONFLUENT normalization map `σ: Σ*/~normToken ⇀ E` extending the enum map with an optional
// curated synonym ring (`spec.synonyms = { <member>: [<alias>...] }`). Members are the NORMAL FORMS; each alias is a
// non-preferred term (ISO 25964-1 §10 USE/UF; SKOS altLabel→prefLabel). Keyed POST-`normToken`, so it is a partial
// function on the normalization quotient → **confluent by construction** (Church-Rosser: normToken is idempotent, one
// normal form per class), GIVEN the two critical-pair conditions checked here at COMPILE (a violation THROWS):
//   • SINGLE-VALUED — no alias maps to two members;   • DISJOINT — no alias `normToken`-collides a member (or a
//   different member's alias).  These are the ground-TRS critical pairs (Knuth-Bendix 1970).
// This is a DETERMINISTIC, closed-domain, author-time LOOKUP — a bigger table, categorically NOT an embedding/similarity
// oracle (which is non-deterministic, non-confluent, open-domain, runtime — the ~33% GPTCache false-hit). So it stays
// INSIDE the barrier's HARD RULE ("no non-deterministic open-domain runtime similarity"), it does not weaken it.
// REGIME (the honest ceiling — signature-stability screen): a strong closed-vocab PROMPT already makes the model emit
// the MEMBER directly, so a ring is REDUNDANT for model-sourced facts. Ring the EXOGENOUS vocabulary you are forced to
// ingest (human free-text, legacy CSV/DB, weak/non-LLM upstreams, cross-system status strings) — finite, domain-stable,
// so the ring CONVERGES (not a treadmill). The residual (a surface in neither members nor ring) stays a fail-closed
// CanonMiss → the host-owned escalation; NEVER an inline fuzzy/edit-distance match (that reimports the banned oracle).
var _enumMaps = new WeakMap();
function compileEnumMap( spec ) {
	var cached = _enumMaps.get(spec);
	if ( cached ) return cached;
	var map = Object.create(null), origin = Object.create(null);   // normToken(term) -> member ; origin ∈ member|alias
	var vocab = spec.enum || [];
	for ( var i = 0; i < vocab.length; i++ ) {
		var m = vocab[i], nk = normToken(m);
		if ( nk in map && map[nk] !== m ) throw new Error('enum: two members normalize to "' + nk + '" (' + map[nk] + ' vs ' + m + ')');
		map[nk] = m; origin[nk] = 'member';
	}
	var syn = spec.synonyms || null;
	if ( syn ) {
		for ( var member in syn ) {
			if ( vocab.indexOf(member) < 0 ) throw new Error('synonyms: ring key "' + member + '" is not an enum member');   // malformed → fail-closed
			var aliases = syn[member] || [];
			for ( var a = 0; a < aliases.length; a++ ) {
				var na = normToken(aliases[a]);
				if ( na in map ) {
					if ( map[na] !== member )                                   // critical pair: alias collides a member / another ring's member
						throw new Error('synonyms: "' + aliases[a] + '" → "' + member + '" collides with "' + map[na] + '" (' + origin[na] + ') — not single-valued/disjoint');
					// else a harmless duplicate (same member) → skip
				} else { map[na] = member; origin[na] = 'alias'; }
			}
		}
	}
	var out = { map: map, origin: origin };
	_enumMaps.set(spec, out);
	return out;
}

/**
 * Canonicalize one raw value against one spec.
 * @returns {{ value: *, miss?: boolean, via?: 'synonym' }}  `miss:true` = out-of-vocabulary / un-coercible (falls back
 *          to `default`/null). `via:'synonym'` = snapped through a curated ring alias (surfaced for audit/reversibility).
 */
function canonValue( raw, spec ) {
	spec = spec || {};

	// enum: snap to a closed vocabulary (deterministic, fail-closed) via the confluent normalization map ----------
	if ( spec.enum ) {
		var comp = compileEnumMap(spec);
		var nk = normToken(raw);                                     // exact + case/whitespace + curated-ring, one probe
		if ( nk in comp.map ) return comp.origin[nk] === 'alias' ? { value: comp.map[nk], via: 'synonym' } : { value: comp.map[nk] };
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
	var facts = {}, misses = [], synonyms = [];
	Object.keys(factsSchema || {}).forEach(function ( key ) {
		var spec = factsSchema[key] || {};
		var src = spec.from != null ? spec.from : key;
		var out = canonValue(raw[src], spec);
		facts[key] = out.value;
		if ( out.miss ) misses.push(key);
		if ( out.via === 'synonym' ) synonyms.push({ key: key, raw: raw[src], member: out.value });   // audit trail (reversibility)
	});
	return { facts: facts, misses: misses, synonyms: synonyms };
}

/**
 * Stable content digest of a canonical fact set — usable as an explicit memo key
 * so identical projections short-circuit *even across re-prose*. Keys sorted so the
 * digest is order-independent.
 */
function digest( facts ) {
	return JSON.stringify(facts || {}, Object.keys(facts || {}).sort());
}

module.exports = { canonValue: canonValue, canonFacts: canonFacts, digest: digest, normToken: normToken, compileEnumMap: compileEnumMap };
