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
 * Author-time concept validator (host-side tool, zero core change) — the enforcement
 * half of the typed-fact spine / canonicalization barrier (doc/MODELISATION.md §6.5,
 * roadmap #1) and the safety gate for declarative AI-authoring (#10).
 *
 * Standing directive: VALIDATE STRUCTURE, NEVER THE EXPRESSION GRAMMAR. We check field
 * presence/types, that `assert`/`ensure` *parse* under the real engine evaluator
 * (App/expr.js), that `provider` is in a host-vetted palette, and — the valuable one —
 * REF SOUNDNESS: a `require`/`ensure`/`assert` edge must not key on a PROSE fact (that
 * is the K1 footgun — a prose dependency fragments the memo every run). We never cap
 * what an expression may *compute*.
 *
 *   const { validateConceptTree } = require('../core/validate.js');
 *   const { errors, warnings } = validateConceptTree(tree, { palette: ['LLM::complete'] });
 *
 * Returns `{ errors, warnings }`, each an array of `{ concept, kind, message, ref? }`.
 * `validateOrThrow(tree, opts)` throws on the first error (use in an authoring loop).
 */
const { compileExpression, parseExpression, REF_FN } = require('../../graph/expr');
const { compileEnumMap } = require('../../providers/canonicalize');   // G-1: reuse the barrier's confluence check for synonym rings

// $ref / $$ref token — IDENTICAL capture to the engine regex (App/expr.js:45) so we
// classify exactly the references the evaluator will resolve.
const REF_RE = /\$(\$?[A-Za-z_][\w.:$]*)/g;
const BLOCKED = /(?:^|[^\w$])(constructor|__proto__|prototype)(?![\w$])/;

// Comparison operators that form a numeric GATE (the K1 continuous-gate footgun, A2).
const COMPARE_OPS = { '<': 1, '>': 1, '<=': 1, '>=': 1, '==': 1, '!=': 1, '===': 1, '!==': 1 };
// Fact-key suffixes that are conventionally a SNAPPED discrete grain (a fractional compare
// on one is not the footgun) — keeps the continuous-gate check from false-flagging ranks.
const DISCRETE_SUFFIX = /(?:Rank|Bucket|Band|Idx|Index|Digest)$/;

// A `$ref` AST node is the injected `__ref("key")` CallExpression — return its key, else null.
function astRefKey( n ) {
	if ( n && n.type === 'CallExpression' && n.callee && n.callee.name === REF_FN && n.arguments && n.arguments[0] )
		return String(n.arguments[0].value).replace(/^\$+/, '').split(':').pop().split('.')[0];
	return null;
}
// A non-integer numeric literal (incl. a unary-minus on one), else null.
function astFractionalLiteral( n ) {
	if ( n && n.type === 'Literal' && typeof n.value === 'number' && !Number.isInteger(n.value) ) return n.value;
	if ( n && n.type === 'UnaryExpression' && n.operator === '-' && n.argument && n.argument.type === 'Literal'
		&& typeof n.argument.value === 'number' && !Number.isInteger(n.argument.value) ) return -n.argument.value;
	return null;
}
// Walk an expression AST for `$ref <cmp> <fractional-literal>` comparisons (either operand
// order) — the raw-continuous-on-a-gate signature. Returns [{ refKey, literal }].
function continuousGateHits( ast ) {
	const hits = [];
	(function walk( n ) {
		if ( !n || typeof n !== 'object' ) return;
		if ( (n.type === 'BinaryExpression') && COMPARE_OPS[n.operator] ) {
			const lk = astRefKey(n.left), rk = astRefKey(n.right),
			      lf = astFractionalLiteral(n.left), rf = astFractionalLiteral(n.right);
			if ( lk != null && rf != null ) hits.push({ refKey: lk, literal: rf });
			else if ( rk != null && lf != null ) hits.push({ refKey: rk, literal: lf });
		}
		for ( const k in n ) {
			const c = n[k];
			if ( c && typeof c === 'object' ) Array.isArray(c) ? c.forEach(walk) : walk(c);
		}
	})(ast);
	return hits;
}

// G-1 interface coherence: walk for `$key ==|=== '<string>'` (either operand order) and `$key in ['a',…]` — the enum
// VALUE gate a consumer keys on. Returns [{ key, value }] (an `in` expands to one hit per array string member). Only
// EQUALITY/membership (a `!=` gate is satisfiable by other values → not a never-fire). Reuses `astRefKey`.
function enumValueGates( ast ) {
	const hits = [], strLit = ( n ) => (n && n.type === 'Literal' && typeof n.value === 'string') ? n.value : null;
	(function walk( n ) {
		if ( !n || typeof n !== 'object' ) return;
		if ( n.type === 'BinaryExpression' && (n.operator === '==' || n.operator === '===') ) {
			const lk = astRefKey(n.left), rk = astRefKey(n.right), ls = strLit(n.left), rs = strLit(n.right);
			if ( lk != null && rs != null ) hits.push({ key: lk, value: rs });
			else if ( rk != null && ls != null ) hits.push({ key: rk, value: ls });
		}
		if ( n.type === 'BinaryExpression' && n.operator === 'in' && astRefKey(n.left) != null && n.right && n.right.type === 'ArrayExpression' )
			for ( const el of (n.right.elements || []) ) { const s = strLit(el); if ( s != null ) hits.push({ key: astRefKey(n.left), value: s }); }
		for ( const k in n ) { const c = n[k]; if ( c && typeof c === 'object' ) Array.isArray(c) ? c.forEach(walk) : walk(c); }
	})(ast);
	return hits;
}

// the literal STRING values an applyMutations template WRITES per key (a template write of a closed-vocab value — so a
// consumer gating on it is reachable even when no prompt.facts enum lists it). A bare `key: 'v'` writes v; a `$`-prefixed
// key is a ref (not a literal write); a value that is itself a `$`-ref token is not a literal. Conservative (reduces
// false positives in the never-fire check).
function templateStringValues( tpl, out ) {
	out = out || {};
	(function walk( n ) {
		if ( Array.isArray(n) ) return n.forEach(walk);
		if ( n && typeof n === 'object' ) {
			for ( const k in n ) {
				const v = n[k];
				if ( typeof v === 'string' && k[0] !== '$' && k !== '_id' && v[0] !== '$' ) (out[k] = out[k] || new Set()).add(v);
				else if ( v && typeof v === 'object' ) walk(v);
			}
		}
	})(tpl);
	return out;
}

// Collect every `$ref` key in a subtree (for "everything under a `!` is negated").
function collectRefKeys( n, out ) {
	const rk = astRefKey(n);
	if ( rk ) out.add(rk);
	if ( n && typeof n === 'object' )
		for ( const k in n ) {
			const c = n[k];
			if ( c && typeof c === 'object' ) Array.isArray(c) ? c.forEach((x) => collectRefKeys(x, out)) : collectRefKeys(c, out);
		}
	return out;
}
const isFalsyLit = (n) => n && n.type === 'Literal' && (n.value === false || n.value === 0 || n.value === null || n.value === 'false');
const isTrueLit = (n) => n && n.type === 'Literal' && (n.value === true || n.value === 'true');
// The ref keys that appear NEGATED in an expression AST: anything under a unary `!`, plus
// `$F==false|0|null` and `$F!=true` (the "non-cast condition" patterns). Heuristic — it does
// not unfold De Morgan; it catches the common defeasance idioms (`!$skip`, `$sat==false`).
function negatedRefKeys( ast ) {
	const neg = new Set();
	(function walk( n ) {
		if ( !n || typeof n !== 'object' ) return;
		if ( n.type === 'UnaryExpression' && n.operator === '!' ) collectRefKeys(n.argument, neg);
		if ( n.type === 'BinaryExpression' ) {
			const lk = astRefKey(n.left), rk = astRefKey(n.right);
			if ( n.operator === '==' || n.operator === '===' ) {
				if ( lk && isFalsyLit(n.right) ) neg.add(lk);
				if ( rk && isFalsyLit(n.left) ) neg.add(rk);
			}
			if ( n.operator === '!=' || n.operator === '!==' ) {
				if ( lk && isTrueLit(n.right) ) neg.add(lk);
				if ( rk && isTrueLit(n.left) ) neg.add(rk);
			}
		}
		for ( const k in n ) {
			const c = n[k];
			if ( c && typeof c === 'object' ) Array.isArray(c) ? c.forEach(walk) : walk(c);
		}
	})(ast);
	return neg;
}

// Tarjan strongly-connected components over an adjacency map (name -> [toName]).
function tarjanSCC( nodes, adj ) {
	const index = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
	let idx = 0;
	function strongConnect( v ) {
		index.set(v, idx); low.set(v, idx); idx++;
		stack.push(v); onStack.add(v);
		for ( const w of (adj.get(v) || []) ) {
			if ( !index.has(w) ) { strongConnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
			else if ( onStack.has(w) ) low.set(v, Math.min(low.get(v), index.get(w)));
		}
		if ( low.get(v) === index.get(v) ) {
			const comp = [];
			let w;
			do { w = stack.pop(); onStack.delete(w); comp.push(w); } while ( w !== v );
			out.push(comp);
		}
	}
	for ( const v of nodes ) if ( !index.has(v) ) strongConnect(v);
	return out;
}

/**
 * Stratification lint (#5.3 / Tier 3): a recursion-through-negation in the concept-dependency
 * graph is unstratified and may OSCILLATE (K7 — a live risk once `ensure`-gated verdicts can
 * retract). Build directed edges D->C when D's require/ensure/assert references a fact C
 * *statically* produces (its self-flag or an applyMutations key — provider-written facts are
 * not tracked, which keeps monotone patterns like the nogood store from false-flagging), tag
 * the edge negative when the dependency is negated, and warn on any SCC that contains a
 * negative edge. Advisory: a flagged cycle is a POSSIBLE oscillation to verify, not a proof.
 * @returns array of `{ concept, kind:'unstratified-cycle', message, cycle:[names] }`
 */
function stratificationWarnings( tree ) {
	const concepts = [];
	eachConcept(tree, (c) => { if ( c._name ) concepts.push(c); });
	const names = concepts.map((c) => c._name);

	// fact -> concepts that statically produce it
	const producers = new Map();
	for ( const c of concepts ) {
		const schema = c._schema || c;
		const prod = new Set([c._name, ...templateKeys(schema.applyMutations)]);
		for ( const f of prod ) { if ( !producers.has(f) ) producers.set(f, []); producers.get(f).push(c._name); }
	}

	// directed dependency edges with polarity
	const adj = new Map();                 // name -> [toName]  (for SCC)
	const negEdges = new Set();            // "from->to" marked negative
	for ( const c of concepts ) {
		const schema = c._schema || c, from = c._name, pos = new Set(), neg = new Set();
		for ( const r of refsOf(schema.require, false) ) pos.add(refKeyOf(r).key);
		for ( const fld of ['ensure', 'assert'] )
			for ( const e of asArray(schema[fld]) ) {
				if ( typeof e !== 'string' ) continue;
				let ast; try { ast = parseExpression(e); } catch ( _e ) { ast = null; }
				const negs = negatedRefKeys(ast);
				for ( const r of refsOf(e, true) ) { const k = refKeyOf(r).key; (negs.has(k) ? neg : pos).add(k); }
			}
		const edges = adj.get(from) || [];
		const link = (keys, isNeg) => {
			for ( const k of keys ) for ( const p of (producers.get(k) || []) ) if ( p !== from ) {
				edges.push(p);
				if ( isNeg ) negEdges.add(from + '->' + p);
			}
		};
		link(pos, false); link(neg, true);
		adj.set(from, edges);
	}

	const out = [];
	for ( const comp of tarjanSCC(names, adj) ) {
		if ( comp.length < 2 ) {
			// a self-loop counts only if the concept negatively depends on its own product
			const v = comp[0];
			if ( !(adj.get(v) || []).includes(v) || !negEdges.has(v + '->' + v) ) continue;
		}
		const inComp = new Set(comp);
		// is there a negative edge WITHIN the SCC?
		let hasNeg = false;
		for ( const from of comp ) for ( const to of (adj.get(from) || []) )
			if ( inComp.has(to) && negEdges.has(from + '->' + to) ) hasNeg = true;
		if ( !hasNeg ) continue;          // a purely-positive cycle is monotone mutual support — fine
		out.push({
			concept: comp[0], kind: 'unstratified-cycle',
			message: `concepts {${comp.join(', ')}} form a dependency cycle through a NEGATED edge — unstratified, may oscillate (K7); break the negation out of the cycle or stage it across revisions`,
			cycle: comp.slice()
		});
	}
	return out;
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const providerName = (p) => (Array.isArray(p) ? p[0] : p);

// Structural keys the engine always resolves — never "unknown" regardless of the
// declared ref alphabet. (Domain facts are declared by the host via opts.knownFacts.)
const BUILTIN_KEYS = new Set(['_parent', '_id', '_name', '_incoming', '_outgoing', 'originNode', 'targetNode']);

// The fact keys a mutation template WRITES (so a dependency on one is sound). A
// template is an object (or array of objects); we collect its plain data keys,
// dropping `$`-control markers ($_id/$$_id/$ref) and structural nesting keys.
function templateKeys( tpl, out ) {
	out = out || [];
	for ( const obj of asArray(tpl) ) {
		if ( !obj || typeof obj !== 'object' ) continue;
		for ( const raw of Object.keys(obj) ) {
			const k = raw.replace(/^\$+/, '');               // `$key`/`$$key` -> key
			if ( k === '_incoming' || k === '_outgoing' ) {  // nested child segments — recurse
				templateKeys(obj[raw], out);
				continue;
			}
			if ( BUILTIN_KEYS.has(k) || k === '_id' ) continue;
			out.push(k);
		}
	}
	return out;
}

// The fact key a ref path actually reads + whether a `.member` (e.g. `.length`) is
// applied. `$$budget:spent.length` -> { key:'spent', hasMember:true }; 'Task' -> { key:'Task' }.
function refKeyOf( path ) {
	let body = String(path).replace(/^\$+/, '');      // drop $ / $$ ref markers
	const segs = body.split(':');                      // cross-object walk
	const last = segs[segs.length - 1];
	const dot = last.split('.');                        // member access on the final object
	return { key: dot[0], hasMember: dot.length > 1 };
}

// Pull every ref path out of an expression-or-ref field.
//   require items are bare ref paths ('Task', '_parent:originNode');
//   assert/ensure are expressions whose refs are `$...` tokens.
function refsOf( field, isExpr ) {
	const out = [];
	for ( const item of asArray(field) ) {
		if ( typeof item !== 'string' ) continue;
		if ( isExpr ) {
			let m;
			REF_RE.lastIndex = 0;
			while ( (m = REF_RE.exec(item)) ) out.push(m[1]);
		} else {
			out.push(item);
		}
	}
	return out;
}

// Walk the tree; call fn(concept, key) for every concept node. A node is a concept iff
// it is listed in a parent's `childConcepts` (so a missing `_name` IS still visited and
// flagged) OR it is a bare concept passed as the root. The synthetic root *container*
// (only `childConcepts`, no `_name`) is the one node that is never a concept.
function eachConcept( node, fn, key, isChild ) {
	if ( !node || typeof node !== 'object' ) return;
	if ( isChild || node._name ) fn(node, key);
	const kids = node.childConcepts;
	if ( kids ) for ( const k of Object.keys(kids) ) eachConcept(kids[k], fn, k, true);
}

/**
 * @param tree  the nested concept tree (root container or a concept node)
 * @param opts.palette         allowed `Ns::fn` provider strings (advisory: a non-palette
 *                             provider is a WARNING, or an ERROR when `opts.strict`)
 * @param opts.collectionKeys  keys known to hold child sets — a bare (non-`.length`)
 *                             dependency on one is the "all-children" aggregation footgun
 * @param opts.flagContinuousGates  opt-in (#P4): flag an `assert`/`ensure` comparing a fact
 *                             against a FRACTIONAL literal (`$x>=0.7`) — a raw continuous value
 *                             on a defeasant gate churns the memo (K1/A2). Heuristic -> a
 *                             WARNING (ERROR when `strict`); skips declared-discrete facts and
 *                             …Rank/Bucket/Band/Idx/Index/Digest conventions.
 * @param opts.continuousExempt  fact keys to whitelist for the above (discrete-but-fractional,
 *                             e.g. a k-of-n `confidence`)
 * @param opts.strict          promote palette warnings to errors
 */
function validateConceptTree( tree, opts ) {
	opts = opts || {};
	const palette = opts.palette ? new Set(opts.palette) : null;
	const collectionKeys = new Set(opts.collectionKeys || ['expandedInto', 'answeredBy', 'children', 'steps']);
	const errors = [], warnings = [];
	const err = (concept, kind, message, ref) => errors.push({ concept, kind, message, ref });
	const warn = (concept, kind, message, ref) => warnings.push({ concept, kind, message, ref });

	// --- pass 1: classify every declared fact key as discrete (tracked) or prose (untracked) ---
	const discrete = new Set();      // a require/ensure may depend on these
	const prose = new Set();         // a require/ensure must NOT depend on these (K1)
	// `Node`/`Segment` are the ROOT FACTS of the concept system — the engine pre-sets them on every
	// typed object, and concept trees ANCHOR on them via `require` (the Vertice/Edge entry-point
	// pattern: `require: "Node"`). What does NOT work is NAMING a concept after a root fact while
	// giving it conditions: the pre-set fact makes it map at instant zero — BEFORE late requires
	// (another concept's flag, a provider-written fact) can resolve — and once consumed from the
	// open stack its children are silently never descended (a measured trap: the tot plugin's
	// original `Node` requiring `Thought`). A condition-free concept so named is a harmless (if
	// redundant) all-objects root, so only the conditioned form is flagged. Author-time, zero core.
	const ENGINE_MARKERS = new Set(['Node', 'Segment']);
	eachConcept(tree, (c) => {
		if ( !c._name ) return;                                   // a nameless node declares nothing (flagged in pass 2)
		const cSchema = c._schema || c;
		if ( ENGINE_MARKERS.has(c._name) && (cSchema.require || cSchema.ensure || cSchema.assert) )
			warn(c._name, 'engine-marker-name', `concept "${c._name}" is named after a pre-set ROOT fact but carries require/ensure — it maps the instant the object exists, before late conditions resolve, and its children are then never descended. Anchor on the root via require (the Vertice/Edge pattern: require:"${c._name}") and give the concept its own name (e.g. TreeNode)`);
		discrete.add(c._name);                                    // a self-flag is a discrete boolean fact
		const schema = c._schema || c;
		const prompt = schema.prompt;
		if ( prompt && prompt.facts ) {
			for ( const k of Object.keys(prompt.facts) ) {
				discrete.add(k);
				// G-1: a curated synonym ring must be CONFLUENT — single-valued ∧ disjoint ∧ members valid. Compile it at
				// author-time (the critical-pair check) so a malformed ring is a validation ERROR here, not a runtime throw.
				const spec = prompt.facts[k];
				if ( spec && spec.enum && spec.synonyms ) {
					try { compileEnumMap(spec); }
					catch ( e ) { err(c._name, 'synonym-ring', `fact "${k}": ${e.message}`); }
				}
			}
			discrete.add(c._name + 'FactsDigest');
			prose.add(prompt.prose || (c._name + 'Prose'));
			prose.add(c._name + 'CanonMiss');
		}
		// facts written by the concept's applyMutations template are produced (sound to depend on)
		for ( const k of templateKeys(schema.applyMutations) ) discrete.add(k);
	});

	// ref-soundness layer 3 (#10): only active when the host declares its ref alphabet
	// (provider-emitted facts + seed/free-node keys it knows exist outside the tree).
	// Without it we cannot soundly judge an "unknown" ref — so the check stays off.
	const checkRefs = !!opts.knownFacts;
	const known = new Set([...discrete, ...BUILTIN_KEYS, ...(opts.knownFacts || [])]);

	// continuous-vs-snapped axis (#P4) is opt-in (a heuristic — see check 3b). `exempt`
	// lets a host whitelist a discrete-but-fractional fact (e.g. a k-of-n confidence).
	const checkContinuous = !!opts.flagContinuousGates;
	const exempt = new Set(opts.continuousExempt || []);

	// --- pass 2: per-concept structural + expression + ref-soundness checks ---
	eachConcept(tree, (c, key) => {
		const name = c._name;
		const schema = c._schema || c;

		// (1) structural — _name present (the self-flag the provider writes; without a
		// name to flag, the engine re-fires the concept forever — loop.js:88).
		if ( !name ) { err(c._id || key || '(anonymous)', 'no-name', 'concept has no _name (self-flag) — it will re-fire forever'); return; }

		// (2) provider in the vetted palette (advisory)
		const prov = schema.provider != null ? providerName(schema.provider) : null;
		if ( prov && palette && !palette.has(prov) ) {
			(opts.strict ? err : warn)(name, 'provider-not-in-palette', `provider "${prov}" is not in the vetted palette`);
		}

		// (3) expression well-formedness — assert/ensure must PARSE under the engine
		//     evaluator, and must not poke the prototype chain. Optionally (opt-in) flag a
		//     raw-continuous threshold on a gate (the K1/A2 footgun — see below).
		for ( const fld of ['assert', 'ensure'] ) {
			for ( const expr of asArray(schema[fld]) ) {
				if ( typeof expr !== 'string' ) continue;
				if ( BLOCKED.test(expr) ) err(name, 'blocked-prop', `${fld} touches constructor/__proto__/prototype`, expr);
				try { compileExpression(expr, { empty: true }); }
				catch ( e ) { err(name, 'unparseable', `${fld} does not parse: ${e.message}`, expr); continue; }

				// (3b) continuous-vs-snapped axis (#P4) — only when the host opts in (it is a
				// heuristic: a discrete-but-fractional fact like a k-of-n confidence is fine).
				// A defeasant gate (`ensure`) that compares a fact against a FRACTIONAL literal
				// (`$x>=0.7`) churns the memo every run under sub-threshold noise (A2: 5 re-runs
				// vs 1). Snap the fact to a grain/rank and gate on that. NOTE: a "produced" fact
				// (in `discrete`) is NOT necessarily discrete-VALUED — a provider/template can
				// write a raw float (pHat:0.5) — so we do NOT skip on `discrete`; only on a
				// conventionally-snapped name (…Rank/Bucket/…) or the host's exempt list.
				if ( checkContinuous ) {
					let ast;
					try { ast = parseExpression(expr); } catch ( e ) { ast = null; }
					for ( const hit of continuousGateHits(ast) ) {
						if ( DISCRETE_SUFFIX.test(hit.refKey) || exempt.has(hit.refKey) ) continue;
						(opts.strict ? err : warn)(name, 'continuous-gate',
							`${fld} compares "${hit.refKey}" against fractional ${hit.literal} — a raw continuous value on a defeasant gate churns the memo every run (K1/A2); snap it to a discrete grain/rank and gate on that`, expr);
					}
				}
			}
		}

		// (4) ref soundness — the valuable check. A dependency edge keyed on PROSE
		//     fragments the memo (K1); a bare dependency on a child-set is the
		//     "all-children-answered" aggregation footgun (getRef has no quantifier).
		const edges = [
			...refsOf(schema.require, false).map((r) => ({ r, fld: 'require' })),
			...refsOf(schema.ensure, true).map((r) => ({ r, fld: 'ensure' })),
			...refsOf(schema.assert, true).map((r) => ({ r, fld: 'assert' }))
		];
		for ( const { r, fld } of edges ) {
			const { key, hasMember } = refKeyOf(r);
			const isCrossWalk = /:/.test(String(r).replace(/^\$+/, ''));   // a:b walk — resolves on another object
			if ( prose.has(key) )
				err(name, 'prose-dependency', `${fld} depends on prose key "${key}" — fragments the memo every run (K1); key on a discrete fact instead`, r);
			else if ( collectionKeys.has(key) && !hasMember )
				warn(name, 'aggregating-dependency', `${fld} depends on child-set "${key}" without .length — getRef cannot quantify; use a {__push}+\`.length\` completion gate`, r);
			else if ( checkRefs && !isCrossWalk && !known.has(key) )
				(opts.strict ? err : warn)(name, 'unknown-ref', `${fld} keys on "${key}" — no concept produces it and the ref-alphabet does not declare it; this dependency may never resolve (silent never-fires)`, r);
		}
	});

	// --- pass 3: stratification (whole-tree) — a dependency cycle through a NEGATED edge is
	//     unstratified and may oscillate (K7). Structural + sound (static facts only), so a
	//     default warning (strict -> error). Opt out with opts.skipStratification.
	if ( !opts.skipStratification )
		for ( const s of stratificationWarnings(tree) )
			(opts.strict ? errors : warnings).push(s);   // s = { concept, kind, message, cycle }

	// --- pass 4 (G-1): cross-method INTERFACE COHERENCE over enum VALUES (the STAGE-1 keystone soundness core). The
	//     key-level never-fire is already caught above (unknown-ref); this adds the VALUE level. Two checks:
	//       (a) NEVER-FIRE — a consumer gates on `$key=='V'` but NO producer writes V for that enum-interface key → a
	//           silent dead edge (producer writes {intransit,delivered}; consumer gates =='shipped'). WARN (strict→err).
	//       (b) SYNONYM INTENT-COLLISION — the SAME alias maps to DIFFERENT members for one key across concepts: the
	//           shared vocabulary is non-confluent across the method graph (Laurie condition 3 — cross-method critical pair).
	//     Opt out with opts.skipInterfaceCoherence.
	if ( !opts.skipInterfaceCoherence ) {
		const producedValues = {};                                    // key -> Set(values any concept writes: enum members + template literals)
		const enumInterfaceKeys = new Set();                          // keys that carry a prompt.facts enum (a typed closed vocab)
		const synonymBy = {};                                         // key -> { normAlias -> { member -> [concept...] } }
		eachConcept(tree, (c) => {
			if ( !c._name ) return;
			const schema = c._schema || c, facts = schema.prompt && schema.prompt.facts;
			if ( facts ) for ( const key of Object.keys(facts) ) {
				const spec = facts[key];
				if ( !spec || !spec.enum ) continue;
				enumInterfaceKeys.add(key);
				for ( const m of spec.enum ) (producedValues[key] = producedValues[key] || new Set()).add(m);
				if ( spec.synonyms ) for ( const member of Object.keys(spec.synonyms) )
					for ( const alias of (spec.synonyms[member] || []) ) {
						const a = String(alias).trim().toLowerCase().replace(/\s+/g, ' ');
						const mm = ((synonymBy[key] = synonymBy[key] || {})[a] = (synonymBy[key] || {})[a] || {});
						(mm[member] = mm[member] || []).push(c._name);
					}
			}
			const tv = templateStringValues(schema.applyMutations);   // template literal writes broaden the reachable set
			for ( const key of Object.keys(tv) ) for ( const v of tv[key] ) (producedValues[key] = producedValues[key] || new Set()).add(v);
		});
		// (b) synonym intent-collision (cross-method confluence)
		for ( const key of Object.keys(synonymBy) )
			for ( const alias of Object.keys(synonymBy[key]) ) {
				const members = Object.keys(synonymBy[key][alias]);
				if ( members.length > 1 ) {
					const involved = [...new Set(members.flatMap((m) => synonymBy[key][alias][m]))];
					err(involved.join(','), 'synonym-intent-collision',
						`alias "${alias}" for "${key}" maps to DIFFERENT members across concepts (${members.join(' vs ')}) — the shared vocabulary is non-confluent across the method graph; use per-concept intent-scoped rings or reconcile the mapping`);
				}
			}
		// (a) value-level never-fire
		eachConcept(tree, (c) => {
			if ( !c._name ) return;
			const schema = c._schema || c;
			for ( const fld of ['ensure', 'assert'] )
				for ( const expr of asArray(schema[fld]) ) {
					if ( typeof expr !== 'string' ) continue;
					let ast; try { ast = parseExpression(expr); } catch ( e ) { continue; }
					for ( const g of enumValueGates(ast) ) {
						if ( !enumInterfaceKeys.has(g.key) ) continue;    // not a typed enum interface key → can't judge soundly
						const produced = producedValues[g.key] || new Set();
						if ( !produced.has(g.value) )
							(opts.strict ? err : warn)(c._name, 'interface-never-fire',
								`${fld} gates on ${g.key}=='${g.value}' but no concept writes that value for the enum interface "${g.key}" (produced: {${[...produced].join(', ')}}) — a silent never-fire; align the producer/consumer vocabulary or add "${g.value}" to the enum`, expr);
					}
				}
		});
	}

	return { errors, warnings };
}

function validateOrThrow( tree, opts ) {
	const res = validateConceptTree(tree, opts);
	if ( res.errors.length ) {
		const e = res.errors[0];
		throw new Error(`concept "${e.concept}" — ${e.kind}: ${e.message}` + (e.ref ? ` [${e.ref}]` : ''));
	}
	return res;
}

/**
 * Merge-projection contract validator (#P4 part b) — makes the fork/merge frontier a CHECKED
 * assume-guarantee contract. `validate.js` validates a concept tree but never sees `merge`'s
 * `project` function (opaque JS), so a projection that crosses a raw/undeclared fact onto the
 * parent passes everything (the D-experiment gap). Call this on the TEMPLATE the projection
 * returns, with the host-declared frontier alphabet (the keys permitted to cross a sub-graph
 * boundary — the snapped contract keys), to catch an undeclared crossing.
 *
 *   const { errors, warnings } = validateMergeProjection(
 *     { $$_id: 'belief', ellA: 0.6 }, { frontierAlphabet: ['ellA', 'ellB'], flagContinuous: true });
 *
 * @param template  the projection object (or array of them); `$$_id`/`$_id` are control keys.
 * @param opts.frontierAlphabet  keys permitted to cross (the check is inactive without it — like
 *                               the tree validator's `knownFacts`, we only judge what's declared).
 * @param opts.flagContinuous    advisory: also warn on a raw-fractional value crossing — fine ONLY
 *                               if the parent snaps before gating (C1/E4); a raw-gated parent is K1.
 * @param opts.strict            promote the undeclared-crossing warning to an error.
 * @returns { errors, warnings }  records shaped like validateConceptTree's.
 */
function validateMergeProjection( template, opts ) {
	opts = opts || {};
	const errors = [], warnings = [];
	const alpha = opts.frontierAlphabet ? new Set(opts.frontierAlphabet) : null;
	for ( const tpl of asArray(template) ) {
		if ( !tpl || typeof tpl !== 'object' ) continue;
		for ( const raw of Object.keys(tpl) ) {
			const k = raw.replace(/^\$+/, '');
			if ( BUILTIN_KEYS.has(k) || k === '_id' ) continue;     // $$_id / $_id select the target
			if ( alpha && !alpha.has(k) )
				(opts.strict ? errors : warnings).push({ concept: '(merge)', kind: 'frontier-leak',
					message: `merge projection crosses "${k}" — not in the declared frontier alphabet; only the snapped contract keys may cross a sub-graph boundary`, ref: k });
			if ( opts.flagContinuous ) {
				const v = tpl[raw];
				if ( typeof v === 'number' && !Number.isInteger(v) )
					warnings.push({ concept: '(merge)', kind: 'continuous-crossing',
						message: `merge projection crosses raw continuous "${k}"=${v} — sound ONLY if the parent snaps before gating (cross-continuous-then-snap, C1/E4); a parent that gates on it raw is the K1 breach`, ref: k });
			}
		}
	}
	return { errors, warnings };
}

module.exports = {
	validateConceptTree, validateOrThrow, stratificationWarnings, validateMergeProjection,
	// low-level extraction helpers — exported so the grammar-graph derivation (lib/authoring/
	// grammar-graph.js) reuses the SAME ref/polarity/produced-fact logic (single source of truth).
	eachConcept, refsOf, refKeyOf, templateKeys, negatedRefKeys
};
