/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * canon — the CANONICALIZATION BARRIER as a standalone brick (values AND structure).
 *
 * Two field-proven moves, promoted from experiment code where each served twice (2026-07-03):
 *
 *   1. VALUE snap (`snapToVocab`) — the intake barrier: a model-extracted SURFACE value is snapped onto the
 *      vocabulary of the system's OWN data (exact ci-match keeps the surface form; containment either way
 *      snaps to the canonical form; anything else survives RAW and is counted OOV — the honest path: a
 *      genuine out-of-vocabulary value must fail downstream verify, never be silently coerced).
 *
 *   2. STRUCTURAL canon (`makeStructuralCanon`) — the same barrier applied to a typed step-list: a model
 *      emits ONE plan at SEVERAL granularities (e.g. `[filter(f,v), aggregate]` vs `[aggregate(f,v)]`),
 *      related exactly by recurring digrams — the equivalence the system itself mines (`compress.js
 *      mineDigrams`, GO-gated 2026-07-03). The canon folds those digrams and whitelists per-step facts
 *      fail-closed, so emission STABILITY (and every downstream memo/LGG key) is claimed MODULO a learned
 *      equivalence, never modulo an ad-hoc regex.
 *
 * Both are K1 instruments: they keep dependency edges on DISCRETE, canonical keys (docs/API.md facts/prose
 * contract). Fail-closed throughout — a fact that cannot be certified is DROPPED, never guessed:
 *   - facts live only on declared `factKinds` steps;
 *   - if the gating fact (default `value`) is absent or out of the data vocabulary, ALL facts drop for
 *     that step (an operation word leaked into `value` must not survive as a param);
 *   - a fold merges facts per-key: one side present → carried; both present and ci-equal → kept; a
 *     CONFLICT → the key is dropped (parallel-over-collapse, the §9 rule at fact grain).
 */

const low = ( v ) => String(v).toLowerCase();

/**
 * Snap a surface value onto a canonical vocabulary.
 * @param value   the extracted surface form
 * @param vocab   array of canonical strings (the system's own data values — never test golds)
 * @param stats   optional { kept, snapped, oov } counters, incremented in place
 * @returns { value, verdict } — verdict ∈ exact|snapped|oov
 */
function snapToVocab( value, vocab, stats ) {
	stats = stats || {};
	const v = low(value == null ? '' : value);
	if ( vocab.some(( c ) => low(c) === v) ) {
		stats.kept = (stats.kept || 0) + 1;
		return { value: value, verdict: 'exact' };
	}
	// containment must be UNIQUE to snap: a hypernym surface ('plug' ⊂ europlug|usplug|ukplug) matches
	// several vocab words — snapping to the first is an arbitrary wrong pick that then OVERRIDES a correct
	// explicit fact downstream (measured: the G3 plugs domain). Ambiguous containment → OOV, fail-closed.
	const hits = v ? vocab.filter(( c ) => v.includes(low(c)) || low(c).includes(v) ) : [];
	if ( hits.length === 1 ) {
		stats.snapped = (stats.snapped || 0) + 1;
		return { value: hits[0], verdict: 'snapped' };
	}
	stats.oov = (stats.oov || 0) + 1;
	if ( hits.length > 1 ) { stats.ambiguous = (stats.ambiguous || 0) + 1; return { value: value, verdict: 'oov', ambiguous: hits }; }
	return { value: value, verdict: 'oov' };
}

/** Fold specs from a `compress.js#mineDigrams` result: each mined adjacent pair (a,b) above minSupport
 *  becomes a fold `[a, b] → b` (facts carried per the merge rule). The folds are thereby LEARNED from the
 *  system's own traces — the only legitimacy a structural rewrite gets. */
function foldsFromDigrams( digrams, opts ) {
	opts = opts || {};
	const min = opts.minSupport != null ? opts.minSupport : 2;
	return (digrams || []).filter(( d ) => d && d.a && d.b && (d.support == null || d.support >= min) )
		.map(( d ) => ({ a: d.a, b: d.b, into: opts.into || d.b }));
}

/**
 * Build a structural canonicalizer over typed step-lists.
 * @param opts {
 *   kindKey   = 'stepKind'          — the step's kind fact
 *   factKeys  = []                  — per-step content facts under whitelist discipline (e.g. ['field','value'])
 *   factKinds = null                — kinds allowed to carry facts (null = all kinds)
 *   gateKey   = 'value'             — the fact whose vocabulary membership gates ALL facts of the step
 *   vocab     = null                — array/Set of data values (ci); null = no vocabulary gate
 *   folds     = []                  — [{a, b, into}] adjacent-digram folds (see foldsFromDigrams)
 * }
 * @returns ( steps ) => canonical steps (null in → null out; input never mutated)
 */
function makeStructuralCanon( opts ) {
	opts = opts || {};
	const kindKey = opts.kindKey || 'stepKind';
	const factKeys = opts.factKeys || [];
	const factKinds = opts.factKinds ? new Set(opts.factKinds) : null;
	const gateKey = opts.gateKey || 'value';
	const vocab = opts.vocab ? new Set([...opts.vocab].map(low)) : null;
	const folds = opts.folds || [];

	const clean = ( s ) => {
		const kind = s[kindKey];
		let keep = !factKinds || factKinds.has(kind);
		if ( keep && vocab && factKeys.includes(gateKey) )
			keep = s[gateKey] != null && vocab.has(low(s[gateKey]));
		const out = Object.assign({}, s);
		for ( const k of factKeys ) if ( !keep || out[k] == null ) delete out[k];
		return out;
	};

	// per-key fact merge: one side → carried · ci-equal → kept · conflict → DROPPED (fail-closed)
	const mergeFacts = ( a, b ) => {
		const m = {};
		for ( const k of factKeys ) {
			if ( a[k] != null && b[k] != null ) { if ( low(a[k]) === low(b[k]) ) m[k] = a[k]; }
			else if ( a[k] != null ) m[k] = a[k];
			else if ( b[k] != null ) m[k] = b[k];
		}
		return m;
	};

	return function canon( steps ) {
		if ( !Array.isArray(steps) ) return null;
		let cur = steps.map(clean);
		for ( let pass = 0; pass < steps.length; pass++ ) {                     // to fixpoint, bounded
			const out = [];
			let folded = false;
			for ( let i = 0; i < cur.length; i++ ) {
				const nxt = cur[i + 1];
				const f = nxt && folds.find(( f ) => cur[i][kindKey] === f.a && nxt[kindKey] === f.b );
				if ( f ) {
					const facts = mergeFacts(cur[i], nxt);
					const base = Object.assign({}, nxt);
					for ( const k of factKeys ) delete base[k];
					Object.assign(base, facts);
					base[kindKey] = f.into || f.b;
					out.push(base);
					i++; folded = true;
				}
				else out.push(cur[i]);
			}
			cur = out;
			if ( !folded ) break;
		}
		return cur;
	};
}

/** The kinds-only key of a step-list — the SHAPE face of stability (G1's post-canon comparison). */
const shapeKey = ( steps, opts ) => steps == null ? null
	: JSON.stringify(steps.map(( s ) => s[(opts && opts.kindKey) || 'stepKind'] ));

/** The shape+facts key (ci values) — the full canonical digest both experiments compared on. */
function canonKey( steps, opts ) {
	if ( steps == null ) return null;
	const kindKey = (opts && opts.kindKey) || 'stepKind';
	const factKeys = (opts && opts.factKeys) || [];
	return JSON.stringify(steps.map(( s ) => {
		const o = { k: s[kindKey] };
		for ( const f of factKeys ) o[f] = s[f] != null ? low(s[f]) : '';
		return o;
	}));
}

module.exports = { snapToVocab, foldsFromDigrams, makeStructuralCanon, shapeKey, canonKey };
