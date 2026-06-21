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
const { compileExpression } = require('../App/expr');

// $ref / $$ref token — IDENTICAL capture to the engine regex (App/expr.js:45) so we
// classify exactly the references the evaluator will resolve.
const REF_RE = /\$(\$?[A-Za-z_][\w.:$]*)/g;
const BLOCKED = /(?:^|[^\w$])(constructor|__proto__|prototype)(?![\w$])/;

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const providerName = (p) => (Array.isArray(p) ? p[0] : p);

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
		const prompt = c._schema && c._schema.prompt || c.prompt;
		if ( prompt && prompt.facts ) {
			for ( const k of Object.keys(prompt.facts) ) discrete.add(k);
			discrete.add(c._name + 'FactsDigest');
			prose.add(prompt.prose || (c._name + 'Prose'));
			prose.add(c._name + 'CanonMiss');
		}
	});

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
		//     evaluator, and must not poke the prototype chain.
		for ( const fld of ['assert', 'ensure'] ) {
			for ( const expr of asArray(schema[fld]) ) {
				if ( typeof expr !== 'string' ) continue;
				if ( BLOCKED.test(expr) ) err(name, 'blocked-prop', `${fld} touches constructor/__proto__/prototype`, expr);
				try { compileExpression(expr, { empty: true }); }
				catch ( e ) { err(name, 'unparseable', `${fld} does not parse: ${e.message}`, expr); }
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
			if ( prose.has(key) )
				err(name, 'prose-dependency', `${fld} depends on prose key "${key}" — fragments the memo every run (K1); key on a discrete fact instead`, r);
			else if ( collectionKeys.has(key) && !hasMember )
				warn(name, 'aggregating-dependency', `${fld} depends on child-set "${key}" without .length — getRef cannot quantify; use a {__push}+\`.length\` completion gate`, r);
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
