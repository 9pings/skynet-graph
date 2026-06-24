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
 *   const { validateConceptTree } = require('./validate');
 *   const { errors, warnings } = validateConceptTree(tree, { palette: ['LLM::complete'] });
 *
 * Returns `{ errors, warnings }`, each an array of `{ concept, kind, message, ref? }`.
 * `validateOrThrow(tree, opts)` throws on the first error (use in an authoring loop).
 */
const { compileExpression, parseExpression, REF_FN } = require('../graph/expr');

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
	eachConcept(tree, (c) => {
		if ( !c._name ) return;                                   // a nameless node declares nothing (flagged in pass 2)
		discrete.add(c._name);                                    // a self-flag is a discrete boolean fact
		const schema = c._schema || c;
		const prompt = schema.prompt;
		if ( prompt && prompt.facts ) {
			for ( const k of Object.keys(prompt.facts) ) discrete.add(k);
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

module.exports = { validateConceptTree, validateOrThrow };
