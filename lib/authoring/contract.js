/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * contract — C-contract: the DEFEASIBLE SEPARATION TRIPLE checker (design doc §2 / §9.1 / §11.6, the "central
 * hole"). A learned METHOD carries a typed contract `{ read, write, pre, post, effect }` (the shape `lintMethod`
 * already lints for the static frame); this module adds the two things that make COMPOSITION-WITHOUT-OPENING-THE-
 * BOX sound:
 *
 *   1. COMPOSE-TIME ⊨ (`checkCompose`) — for every shared fact f ∈ write(M1) ∩ read(M2), is post(M1) ⊨ pre(M2)
 *      over f? Decided by PER-KEY ABSTRACT-DOMAIN entailment (interval + finite-domain, [Cousot-Cousot 1977];
 *      symbolic-heap-style precise footprints, [Berdine-Calcagno-O'Hearn 2004]) — NOT atom-by-atom (which misses
 *      `x≥5 ∧ x≤5 ⊨ x==5` and the integer gap `x>3 ∧ x<5 ⊨ x==4`). SOUND + DECIDABLE on the monadic, ground
 *      fragment; everything outside it (disjunction → QF-coNP; two-key/relational → difference logic; non-ground/
 *      ref-walked footprints → aliasing) is REFUSED → 'escalate' (a micro-LLM open-box step, the §0.1 cost
 *      gradient). The checker NEVER false-accepts: in doubt it escalates.
 *
 *   2. RUNTIME post-assert + BLAME (`assertPost`) — the post is an INDUCED hypothesis (sound on observed cases,
 *      maybe wrong on the next), so it is ASSERTED at settle (contracts-with-blame, [Findler-Felleisen 2002;
 *      Wadler-Findler 2009]; gradual verification, [Bader-Aldrich-Tanter 2018]) ⇒ EVENTUAL, not static,
 *      soundness. The adversary's three real holes are closed here, not by the ⊨ check:
 *        · G1 FRAME-COMPLETENESS — the keys the body actually TOUCHED ⊆ the declared write (an under-declared
 *          frame is the silent unsoundness; the only check that closes it is the runtime touched-vs-declared diff);
 *        · G2 EFFECT-TAG DISCIPLINE — an `external`/`irreversible` method's post may NOT be discharged by an
 *          internal recorded fact; it must be confirmed by a ground-truth ORACLE (a clean-but-incomplete post on
 *          an irreversible effect is the most dangerous failure — it caches as fully-typed, elides the oracle,
 *          commits real damage, and is BLESSED sound);
 *        · G3 FOOTPRINT-CYCLE rejection (`footprintCycles`) — two retractable methods that are each other's
 *          premise through coupled facts OSCILLATE to the apply-cap (`divergent`); reject the cycle at compose-time.
 *
 * Blame on a violated INDUCED post = contract REVISION (specialize the pre with the counterexample's discriminating
 * atom — CEGIS/ICE, [Solar-Lezama 2006; Garg et al. 2014]), not method removal (which oscillates). `reviseOnBlame`.
 *
 * HONEST CLAIM (the only one the literature supports): eventual soundness via a runtime monitor over a SOUND-but-
 * INCOMPLETE compose gate; the typed-coverage fraction is MEASURED (`acceptRate`), not proven — deciding whether an
 * arbitrary learned method's true contract lands in ANY finite typed alphabet is undecidable (Rice). So the runtime
 * assert is LOAD-BEARING; "compose without opening the box" is never an unconditional claim.
 *
 * ZERO-CORE: pure host logic over the typed contract; reuses `frameKeys` (method.js) + `expr.js` for evaluation.
 */

const { compileExpression } = require('../graph/expr.js');

// ───────────────────────────────────────────────────────── atom parsing → per-key abstract constraints ────────

const REL_OPS = ['==', '!=', '<=', '>=', '<', '>'];

// Parse ONE atom string into { key, op, value } or { refuse:<reason> }. An atom keys ONE fact on ONE constant
// (monadic, ground). `a && b` is split by the caller; `||` (disjunction), a two-key comparison (relational), and
// a function call leave the decidable fragment → refuse.
function parseAtom( s ) {
	const t = String(s).trim();
	if ( !t ) return null;
	if ( t.indexOf('||') >= 0 ) return { refuse: 'disjunction' };
	if ( /[a-zA-Z_]\w*\s*\(/.test(t) ) return { refuse: 'function-call' };
	// `key in [..]`
	let m = t.match(/^\$?\$?([A-Za-z_][\w.:]*)\s+in\s+\[(.*)\]$/);
	if ( m ) {
		const vals = m[2].split(',').map(( v ) => v.trim()).filter(( v ) => v.length).map(parseValue);
		// a bare id INSIDE an in-list is an unambiguous enum literal (no two-key ambiguity) → accept its value.
		if ( vals.some(( v ) => v.refuse && v.refuse !== 'bare-ref' ) ) return { refuse: 'in-list-value' };
		return { key: m[1], op: 'in', value: vals.map(( v ) => v.value) };
	}
	for ( const op of REL_OPS ) {                               // order matters: <=/>= before </>
		const i = t.indexOf(op);
		if ( i < 0 ) continue;
		const lhs = t.slice(0, i).trim().replace(/^\$\$?/, ''), rhs = t.slice(i + op.length).trim();
		if ( !/^[A-Za-z_][\w.:]*$/.test(lhs) ) return { refuse: 'non-key-lhs' };
		const v = parseValue(rhs);
		if ( v.refuse === 'bare-ref' ) return { refuse: 'relational' };   // rhs is another key (two-key compare)
		if ( v.refuse ) return { refuse: v.refuse };
		return { key: lhs, op, value: v.value, int: v.int };             // carry int so integer-gap reasoning survives
	}
	return { refuse: 'unparseable' };
}

// Parse an atom RHS literal. A QUOTED string / number / bool / bracketed-list is a constant; a BARE identifier is
// treated as an enum/id constant (the K1 vocabulary is symbolic) UNLESS it would alias a fact key in a comparison
// — that ambiguity is handled by the caller (a bare id on the rhs of a comparison = relational → refuse).
function parseValue( s ) {
	const t = String(s).trim();
	if ( /^'.*'$/.test(t) || /^".*"$/.test(t) ) return { value: t.slice(1, -1), num: false };
	if ( t === 'true' ) return { value: true, num: false };
	if ( t === 'false' ) return { value: false, num: false };
	if ( /^-?\d+$/.test(t) ) return { value: parseInt(t, 10), num: true, int: true };
	if ( /^-?\d*\.\d+$/.test(t) ) return { value: parseFloat(t), num: true, int: false };
	if ( /^\$\$?[A-Za-z_][\w.:]*$/.test(t) ) return { refuse: 'bare-ref', value: t.replace(/^\$\$?/, '') };   // a $ref rhs = two-key compare
	if ( /^[A-Za-z_][\w-]*$/.test(t) ) return { refuse: 'bare-ref', value: t };   // ambiguous: a key or an enum literal
	return { refuse: 'unparseable-value' };
}

// Fold a list of atom STRINGS (a pre/post; `&&` inside an entry is split) into per-key constraints + a refusal
// list. A constraint is { kind:'num', lo, loInc, hi, hiInc, int, ne:Set } or { kind:'cat', allow:Set|null, ne:Set }.
function normalize( entries ) {
	const byKey = {}, refuse = [];
	const atoms = [];
	for ( const e of (entries || []) ) {
		if ( typeof e !== 'string' ) { refuse.push({ reason: 'non-string-atom' }); continue; }
		for ( const part of e.split('&&') ) { const a = parseAtom(part); if ( a ) atoms.push(a); }
	}
	for ( const a of atoms ) {
		if ( a.refuse ) { refuse.push({ reason: a.refuse }); continue; }
		const numeric = (a.op !== 'in' && a.op !== '==' && a.op !== '!=') || (typeof a.value === 'number');
		let c = byKey[a.key];
		if ( !c ) c = byKey[a.key] = numeric ? { kind: 'num', lo: -Infinity, loInc: true, hi: Infinity, hiInc: true, int: true, ne: new Set() }
		                                      : { kind: 'cat', allow: null, ne: new Set() };
		// a key seen as both numeric and categorical → out of the monadic fragment for that key
		if ( numeric && c.kind !== 'num' ) { refuse.push({ reason: 'mixed-domain', key: a.key }); continue; }
		if ( !numeric && c.kind !== 'cat' ) { refuse.push({ reason: 'mixed-domain', key: a.key }); continue; }
		applyAtom(c, a);
	}
	return { byKey, refuse };
}

function applyAtom( c, a ) {
	if ( c.kind === 'num' ) {
		if ( typeof a.value !== 'number' && a.op !== 'in' ) { c._broken = 'non-numeric-on-num-key'; return; }
		if ( a.int === false ) c.int = false;                   // a rational literal demotes the key off integer reasoning
		switch ( a.op ) {
			case '==': c.lo = c.hi = a.value; c.loInc = c.hiInc = true; break;
			case '!=': c.ne.add(a.value); break;
			case '>':  if ( a.value > c.lo || (a.value === c.lo && !c.loInc) ) { c.lo = a.value; c.loInc = false; } break;
			case '>=': if ( a.value > c.lo ) { c.lo = a.value; c.loInc = true; } break;
			case '<':  if ( a.value < c.hi || (a.value === c.hi && !c.hiInc) ) { c.hi = a.value; c.hiInc = false; } break;
			case '<=': if ( a.value < c.hi ) { c.hi = a.value; c.hiInc = true; } break;
			case 'in': c.kind = 'cat'; c.allow = new Set(a.value); break;   // an `in` over numbers → an allow-set
		}
	} else {
		switch ( a.op ) {
			case '==': c.allow = c.allow ? intersect(c.allow, [a.value]) : new Set([a.value]); break;
			case '!=': c.ne.add(a.value); break;
			case 'in': c.allow = c.allow ? intersect(c.allow, a.value) : new Set(a.value); break;
			default:   c._broken = 'order-op-on-cat-key';
		}
	}
}

function intersect( set, vals ) { const out = new Set(); for ( const v of vals ) if ( set.has(v) ) out.add(v); return out; }

// integer-normalise open bounds: x>3 ⇒ x>=4 ; x<5 ⇒ x<=4 (so [>3,<5] over ints == {4}).
function intNorm( c ) {
	if ( c.kind !== 'num' || !c.int ) return c;
	const d = { lo: c.lo, loInc: c.loInc, hi: c.hi, hiInc: c.hiInc, int: true, ne: c.ne, kind: 'num' };
	if ( d.lo > -Infinity && !d.loInc ) { d.lo = d.lo + 1; d.loInc = true; }
	if ( d.hi < Infinity && !d.hiInc ) { d.hi = d.hi - 1; d.hiInc = true; }
	return d;
}

// ───────────────────────────────────────────────────────── per-key entailment: post ⊆ pre ────────────────────

// Does the POST constraint entail (⊆) the PRE constraint for one key? 'yes' (sound) | 'no' (a counterexample
// exists — post admits a value pre forbids) | 'unknown' (can't decide in-fragment → escalate). NEVER false-'yes'.
function entailsKey( postC, preC ) {
	if ( !preC ) return 'yes';                                  // pre constrains nothing on this key → trivially ⊨
	if ( !postC ) return 'unknown';                             // the UNDER-DETERMINED gap (post leaves it free) → escalate
	if ( postC._broken || preC._broken ) return 'unknown';
	if ( postC.kind !== preC.kind ) return 'unknown';           // different domains → can't compare in-fragment
	if ( postC.kind === 'num' ) {
		const p = intNorm(postC), q = intNorm(preC);
		if ( p.lo > p.hi || (p.lo === p.hi && !(p.loInc && p.hiInc)) ) return 'yes';   // post is EMPTY ⇒ vacuously ⊆
		const loOk = p.lo > q.lo || (p.lo === q.lo && (q.loInc || !p.loInc));
		const hiOk = p.hi < q.hi || (p.hi === q.hi && (q.hiInc || !p.hiInc));
		if ( !loOk || !hiOk ) return 'no';                      // post's interval pokes outside pre's
		for ( const n of q.ne ) if ( admitsNum(p, n) ) return 'no';   // pre excludes n but post admits it
		return 'yes';
	}
	// categorical
	if ( postC.allow ) {                                        // post admits a FINITE set → check each is pre-admitted
		for ( const v of postC.allow ) if ( !catAdmits(preC, v) ) return 'no';
		return 'yes';
	}
	// post is allow=any minus ne (an INFINITE admit set) → ⊆ pre only if pre is also any-minus-ne with ne ⊆ post.ne
	if ( preC.allow ) return 'no';                              // post infinite, pre finite → post ⊄ pre
	for ( const n of preC.ne ) if ( !postC.ne.has(n) ) return 'no';   // pre excludes n that post admits
	return 'yes';
}

function admitsNum( c, n ) {
	if ( c.ne.has(n) ) return false;
	const aboveLo = n > c.lo || (n === c.lo && c.loInc);
	const belowHi = n < c.hi || (n === c.hi && c.hiInc);
	return aboveLo && belowHi;
}
function catAdmits( c, v ) { if ( c.ne.has(v) ) return false; return c.allow ? c.allow.has(v) : true; }

// ───────────────────────────────────────────────────────── the COMPOSE-TIME gate ─────────────────────────────

const EFFECTING = new Set(['external', 'irreversible']);

/**
 * checkCompose(m1, m2, opts) — is the composition M1→M2 sound on the typed contracts alone (box CLOSED)?
 * @param m1,m2  { name?, contract:{ read, write, pre, post, effect } }
 * @param opts   { oracle?: (m1, key) => bool }   — a ground-truth probe for an effecting post (G2)
 * @returns { verdict:'sound'|'unsound'|'escalate', shared:[keys], perKey:{key:'yes'|'no'|'unknown'}, reasons:[],
 *            needsOracle:bool }
 */
function checkCompose( m1, m2, opts ) {
	opts = opts || {};
	const c1 = (m1 && m1.contract) || {}, c2 = (m2 && m2.contract) || {};
	const write1 = new Set(c1.write || []), read2 = new Set(c2.read || []);
	const shared = [...write1].filter(( k ) => read2.has(k));
	const reasons = [], perKey = {};
	if ( !c1.post && !c1.write ) { reasons.push('m1 uncontracted'); return { verdict: 'escalate', shared, perKey, reasons, needsOracle: false }; }

	const post1 = normalize(c1.post), pre2 = normalize(c2.pre);
	for ( const r of post1.refuse ) reasons.push('post(m1) out-of-fragment: ' + r.reason);
	for ( const r of pre2.refuse )  reasons.push('pre(m2) out-of-fragment: ' + r.reason);
	const fragmentClean = post1.refuse.length === 0 && pre2.refuse.length === 0;

	let anyNo = false, anyUnknown = !fragmentClean;
	for ( const k of shared ) {
		const v = entailsKey(post1.byKey[k], pre2.byKey[k]);
		perKey[k] = v;
		if ( v === 'no' ) anyNo = true; else if ( v === 'unknown' ) anyUnknown = true;
	}
	// a pre(m2) key that M1 WRITES but is not constrained by post(m1) = the under-determined gap (already 'unknown'
	// above via entailsKey(undefined, preC)); a pre(m2) key M1 does NOT write is framed-through (M2's own concern).

	// G2 — effect-tag discipline: an effecting M1's post is about a real-world effect the internal fact can't vouch
	// for; it must be confirmed by a ground-truth oracle, else escalate (never silently bless).
	let needsOracle = false;
	if ( EFFECTING.has(c1.effect) && shared.length ) {
		needsOracle = true;
		const oracleOk = opts.oracle && shared.every(( k ) => opts.oracle(m1, k));
		if ( !oracleOk ) { reasons.push('effecting M1 (' + c1.effect + ') post needs a ground-truth oracle (G2)'); anyUnknown = true; }
	}

	let verdict;
	if ( anyNo ) verdict = 'unsound';
	else if ( anyUnknown ) verdict = 'escalate';
	else verdict = 'sound';
	return { verdict, shared, perKey, reasons, needsOracle };
}

// ───────────────────────────────────────────────────────── G3 — footprint-cycle rejection ────────────────────

/**
 * footprintCycles(methods) — a directed edge M_a → M_b iff write(M_a) ∩ read(M_b) ≠ ∅. A cycle of RETRACTABLE
 * (non-`pure`) methods = mutual premises through coupled facts → JTMS oscillation to the apply-cap. Returns the
 * cycles (arrays of method names) so the supervisor rejects / priority-orders them (Tarjan SCC, size > 1, or a self-loop).
 */
function footprintCycles( methods ) {
	const ms = methods || [], idx = {}, retract = {};
	ms.forEach(( m, i ) => { idx[m.name == null ? i : m.name] = m; retract[m.name == null ? i : m.name] = (m.contract || {}).effect !== 'pure'; });
	const adj = {};
	for ( const a of ms ) {
		const an = a.name, wa = new Set((a.contract || {}).write || []);
		adj[an] = [];
		for ( const b of ms ) {
			const rb = (b.contract || {}).read || [];
			if ( rb.some(( k ) => wa.has(k) ) ) adj[an].push(b.name);
		}
	}
	// Tarjan SCC
	let id = 0; const ids = {}, low = {}, onStack = {}, stack = [], sccs = [];
	function dfs( at ) {
		ids[at] = low[at] = id++; stack.push(at); onStack[at] = true;
		for ( const to of adj[at] || [] ) {
			if ( ids[to] === undefined ) { dfs(to); low[at] = Math.min(low[at], low[to]); }
			else if ( onStack[to] ) low[at] = Math.min(low[at], ids[to]);
		}
		if ( low[at] === ids[at] ) {
			const comp = []; let w;
			do { w = stack.pop(); onStack[w] = false; comp.push(w); } while ( w !== at );
			sccs.push(comp);
		}
	}
	for ( const m of ms ) if ( ids[m.name] === undefined ) dfs(m.name);
	const cycles = [];
	for ( const comp of sccs ) {
		const selfLoop = comp.length === 1 && (adj[comp[0]] || []).indexOf(comp[0]) >= 0;
		if ( (comp.length > 1 || selfLoop) && comp.some(( n ) => retract[n]) ) cycles.push(comp);
	}
	return cycles;
}

// ───────────────────────────────────────────────────────── the RUNTIME post-assert + blame ───────────────────

/**
 * assertPost(contract, factsAfter, touchedKeys, opts) — the runtime monitor (settle-time). Closes the holes the
 * compose-time ⊨ structurally cannot: G1 frame-completeness + G2 effect-tag oracle.
 * @param contract     { write, post, effect }
 * @param factsAfter   the realized facts (a flat object) the body produced
 * @param touchedKeys  the keys the body ACTUALLY wrote (from the engine's sequenced mutation) — for G1
 * @param opts         { oracle?: (contract, factsAfter) => bool }
 * @returns { ok, violations:[{kind,detail}], blame:{by,kind,...}|null }
 */
function assertPost( contract, factsAfter, touchedKeys, opts ) {
	opts = opts || {};
	const violations = [];
	const write = new Set(contract.write || []);

	// G1 — FRAME COMPLETENESS: every key the body touched must be declared (an under-declared write is the silent
	// frame hole the ⊨ check ranges right past — the only check that closes it is this touched-vs-declared diff).
	for ( const k of (touchedKeys || []) ) if ( !write.has(k) )
		violations.push({ kind: 'undeclared-write', detail: k });

	// the post must actually HOLD on the realized facts (the induced hypothesis, asserted). Evaluated from the
	// PARSED atoms (the same monadic fragment as the ⊨ check — no `$`-syntax dependence); an out-of-fragment post
	// atom falls back to the engine's `expr.js` (the `$ref` convention).
	for ( const atom of (contract.post || []) ) {
		if ( typeof atom !== 'string' ) continue;
		if ( !holdsAtoms(factsAfter, atom) ) violations.push({ kind: 'post-violated', detail: atom });
	}

	// G2 — EFFECTING post must be confirmed by a ground-truth oracle, not the internal fact (the most dangerous
	// hole: a clean post HOLDS on what we recorded while the world disagrees).
	if ( EFFECTING.has(contract.effect) ) {
		if ( !opts.oracle ) violations.push({ kind: 'effecting-post-unverified', detail: contract.effect });
		else if ( !opts.oracle(contract, factsAfter) ) violations.push({ kind: 'oracle-disagrees', detail: contract.effect });
	}

	const ok = violations.length === 0;
	return { ok, violations, blame: ok ? null : { by: 'post', kind: violations[0].kind, violations } };
}

function resolve( facts, ref ) {
	const r = String(ref).replace(/^\$\$?/, '');
	if ( r.indexOf('.') < 0 ) return facts == null ? undefined : facts[r];
	return r.split('.').reduce(( o, k ) => (o == null ? undefined : o[k]), facts);
}

// does a post atom-string (a `&&`-conjunction) HOLD on the realized facts? Simple monadic atoms eval directly;
// an out-of-fragment atom (`||`/relational/function) falls back to the engine's safe `expr.js`. The fallback must
// resolve BOTH `$ref` tokens (via `resolve`, 1st arg) AND BARE fact keys (via `names`, 2nd arg = `facts`) — the
// contract DSL writes bare keys (`decision=="approve"`, `a < b`), which expr.js resolves through `names`, not the
// `$ref` path. (BUG FIX: previously `names` was omitted → bare keys in a refused atom resolved to `undefined` →
// the post silently mis-evaluated, e.g. a `||` implication post passed when it should have failed.)
function holdsAtoms( facts, atomStr ) {
	for ( const part of String(atomStr).split('&&') ) {
		const a = parseAtom(part);
		if ( !a ) continue;                                          // an EMPTY conjunct (trailing `&&`) is vacuously true
		if ( a.refuse ) { const fn = compileExpression(part, { empty: false }); if ( !fn(( ref ) => resolve(facts, ref), facts) ) return false; continue; }
		if ( !evalAtom(facts, a) ) return false;
	}
	return true;
}

function evalAtom( facts, a ) {
	const v = resolve(facts, a.key);
	switch ( a.op ) {
		case '==': return v === a.value;
		case '!=': return v !== a.value;
		case '<':  return v < a.value;
		case '<=': return v <= a.value;
		case '>':  return v > a.value;
		case '>=': return v >= a.value;
		case 'in': return (a.value || []).indexOf(v) >= 0;
	}
	return false;
}

/**
 * reviseOnBlame(contract, counterexample) — a violated INDUCED post means the hypothesis OVER-GENERALIZED; specialize
 * the PRECONDITION with the counterexample's discriminating atom (CEGIS/ICE) so the method no longer claims the case
 * it failed — NOT remove the method (which oscillates). Returns a NEW contract (versioned by the caller / B8).
 * @param contract       the lying contract
 * @param counterexample { key, value }  a discrete fact that distinguishes the failing case
 */
function reviseOnBlame( contract, counterexample ) {
	const ce = counterexample || {};
	const pre = (contract.pre || []).slice();
	if ( ce.key != null && ce.value !== undefined ) {
		const atom = '$' + ce.key + "!=" + (typeof ce.value === 'string' ? "'" + ce.value + "'" : ce.value);
		if ( pre.indexOf(atom) < 0 ) pre.push(atom);            // exclude the failing case from applicability
	}
	const read = (contract.read || []).slice();
	if ( ce.key != null && read.indexOf(ce.key) < 0 ) read.push(ce.key);
	return Object.assign({}, contract, { pre, read });
}

// Does a case satisfy a pre/atom list (is the method APPLICABLE to it)? The selection-side dual of assertPost —
// the supervisor uses it to admit/exclude a method per case (e.g. after `reviseOnBlame` specialized the pre).
function satisfies( atoms, facts ) {
	for ( const a of (atoms || []) ) if ( typeof a === 'string' && !holdsAtoms(facts, a) ) return false;
	return true;
}

// the typed-coverage fraction of a workload (the §11 #5/#6 currency — MEASURED, never proven).
function acceptRate( results ) {
	const xs = results || []; if ( !xs.length ) return { sound: 0, escalate: 0, unsound: 0, n: 0, rate: 0 };
	const tally = { sound: 0, escalate: 0, unsound: 0 };
	for ( const v of xs ) tally[v] = (tally[v] || 0) + 1;
	return Object.assign(tally, { n: xs.length, rate: tally.sound / xs.length });
}

module.exports = { parseAtom, parseValue, normalize, entailsKey, checkCompose, footprintCycles, assertPost,
	reviseOnBlame, satisfies, acceptRate };
