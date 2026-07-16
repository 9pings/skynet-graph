/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * lattice-morphism — STRUCTURAL reconciliation between two CARVINGS of a shared grounded domain (owner 2026-07-09;
 * ZERO-CORE). The LEXICAL case (same classes, different labels: `high` vs `elevated`) is handled by the synonym ring
 * (`canonicalize.js`). The STRUCTURAL case — two DIFFERENT partitions of the same ordered base ({low,mid,high} vs
 * {cold,cool,warm,hot}) — is NOT a synonym: it is a MORPHISM derived from INTERVAL OVERLAP on the shared base. It is
 *   • GROUNDED — computed from the intervals, not guessed;
 *   • DETERMINISTIC on a known VALUE (both carvings classify the same v);
 *   • SET-VALUED on a coarse MEMBER (a member that spans several target members = the coarsening loss);
 *   • DEFEASIBLE at boundaries (a value within `eps` of a disputed cut is flagged `ambiguous` → escalate, never a
 *     forced map) and FAIL-CLOSED off the base (a value outside every interval → null, never a forced nearest).
 *
 * REGIME (the honest ceiling): this works when both carvings anchor to a SHARED, GROUNDED base (a numeric grain, a
 * measurable). Two UNGROUNDED carvings (no shared measurable) have no base to factor through → the morphism must be
 * LEARNED from co-assignment on shared instances (paired data) — the harder residual, out of scope here.
 *
 *   const m = memberMorphism(A, B);   m.reconcile('high')      // -> ['warm','hot']  (A-high is coarser)
 *   classifyValue(B, 70)              // -> { member:'warm' }   (a known value reconciles exactly)
 *
 * A carving = [{ member, lo, hi }] over a shared numeric base; intervals are [lo, hi) with the TOP interval closed.
 */

// do two intervals overlap on the shared base?
function overlaps( a, b ) { return a.lo < b.hi && b.lo < a.hi; }

/**
 * classifyValue(carving, v, opts) → { member, ambiguous }
 * The member whose interval contains v (deterministic). `ambiguous:true` when v is within `opts.eps` of an INTERNAL
 * boundary (a disputed cut) — the defeasible signal. `member:null` when v is outside every interval (fail-closed).
 */
function classifyValue( carving, v, opts ) {
	opts = opts || {};
	const eps = opts.eps || 0;
	const his = carving.map(( c ) => c.hi ), los = carving.map(( c ) => c.lo );
	const maxHi = Math.max.apply(null, his), minLo = Math.min.apply(null, los);
	let member = null;
	for ( const c of carving ) if ( v >= c.lo && (v < c.hi || (c.hi === maxHi && v <= c.hi)) ) { member = c.member; break; }
	let ambiguous = false;
	for ( const c of carving ) if ( c.lo !== minLo && Math.abs(v - c.lo) <= eps ) ambiguous = true;   // near an internal cut
	return { member: member, ambiguous: ambiguous };
}

/**
 * memberMorphism(from, to) → { map, reconcile(member) }
 * The member→member morphism by interval overlap. `map[m]` / `reconcile(m)` = the target members `m` overlaps: a
 * SINGLETON = clean (from ⊆ to at that region), MULTI = `m` is COARSER (coarsening loss), EMPTY = disjoint (no
 * fabricated overlap). Symmetric — call both directions for the full picture.
 */
function memberMorphism( from, to ) {
	const map = Object.create(null);
	for ( const f of (from || []) ) map[f.member] = (to || []).filter(( t ) => overlaps(f, t) ).map(( t ) => t.member );
	return { map: map, reconcile: ( m ) => map[m] || [] };
}

module.exports = { classifyValue, memberMorphism, overlaps };
