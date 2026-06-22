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
 * Safe expression evaluator for the concept mini-DSL — replaces the pervasive
 * `new Function(...)` usage (Concept asserts/ensure, Graph.queryMaps /
 * getChildMatching, Entity.doEval / test, PathMap queries).
 *
 * Why: `new Function` is an `eval` variant — RCE surface (LLM/host text flows
 * into expressions), CSP-incompatible, and a hard blocker for WASM. This module
 * parses the *full expression grammar* with `jsep` and interprets the AST with
 * no code generation, so expressiveness is NOT capped: member access (./[]),
 * method/function calls, ternary, array/object literals and every operator all
 * work — only statement-level JS (loops/assignments) is out of reach, which
 * `return (EXPR)` never meaningfully hosted anyway.
 *
 * Reference resolution preserves the engine's exact semantics: a `$ref` token
 * (including cross-object walks like `$originNode:Position.lat` and the `$$id`
 * bagRef/literal-id form) is captured *whole* by the original regex and handed
 * verbatim to the injected resolver — i.e. to `getRef`, which walks the path.
 * The regex rewrites `$ref` -> `__ref("ref")` (the same transformation the old
 * code applied to `scope.getRef("ref")`), then jsep parses the rest.
 *
 * Security: because member access + calls are allowed, the classic
 * `"".constructor.constructor("…")()` escape is blocked by refusing access to
 * `constructor` / `__proto__` / `prototype`. No assert/query legitimately needs
 * them, so this is not a cap on expressiveness — it is the whole point of
 * dropping `eval`.
 *
 * Runtime errors yield `undefined`, faithful to the original
 * `try{ … }catch{ return undefined }` wrapping.
 *
 * @author Skynet-Graph V1 (MOE) — Phase 0
 */

var _jsep = require('jsep');
var jsep = (_jsep && _jsep.default) ? _jsep.default : _jsep;

var _ternary = require('@jsep-plugin/ternary');
var _object = require('@jsep-plugin/object');
jsep.plugins.register(
	(_ternary && _ternary.default) ? _ternary.default : _ternary,
	(_object && _object.default) ? _object.default : _object
);

// $ref / $$ref  ->  __ref("ref")   (identical capture to the original engine regex)
var REF_RE = /\$(\$?[A-Za-z_][\w.:$]*)/g;
var REF_FN = '__ref';

// Properties that open a path back to the Function constructor / prototype chain.
var BLOCKED_PROPS = { constructor: true, __proto__: true, prototype: true };

// Curated, side-effect-free globals reachable by bare identifiers. Deliberately
// excludes Function/eval/require/process/globalThis etc. (absent -> undefined).
var GLOBALS = {
	Math: Math, JSON: JSON,
	Number: Number, String: String, Boolean: Boolean, Array: Array,
	parseInt: parseInt, parseFloat: parseFloat,
	isNaN: isNaN, isFinite: isFinite,
	undefined: undefined, NaN: NaN, Infinity: Infinity
};

function hasOwn( o, k ) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }

function safeProp( name ) {
	if ( BLOCKED_PROPS[name] ) throw new Error('expr: access to "' + name + '" is blocked');
	return name;
}

// ----------------------------------------------------------- interpreter
function evalNode( node, ctx ) {
	switch ( node.type ) {
		case 'Literal':
			return node.value;

		case 'Identifier': {
			var nm = node.name;
			if ( hasOwn(ctx.names, nm) ) return ctx.names[nm];
			if ( hasOwn(GLOBALS, nm) ) return GLOBALS[nm];
			return undefined;
		}

		case 'MemberExpression': {
			var obj = evalNode(node.object, ctx);
			if ( obj == null ) return undefined;
			var key = node.computed ? evalNode(node.property, ctx) : node.property.name;
			return obj[safeProp(key)];
		}

		case 'CallExpression': {
			var callee = node.callee;

			// `$ref` marker: callee is the injected __ref(<string literal>)
			if ( callee.type === 'Identifier' && callee.name === REF_FN ) {
				return ctx.resolve(node.arguments[0].value);
			}

			var thisObj, fn;
			if ( callee.type === 'MemberExpression' ) {
				thisObj = evalNode(callee.object, ctx);
				if ( thisObj == null ) return undefined;
				var mkey = callee.computed ? evalNode(callee.property, ctx) : callee.property.name;
				fn = thisObj[safeProp(mkey)];
			} else {
				thisObj = undefined;
				fn = evalNode(callee, ctx);
			}
			if ( typeof fn !== 'function' ) return undefined;
			return fn.apply(thisObj, node.arguments.map(function ( a ) { return evalNode(a, ctx); }));
		}

		case 'BinaryExpression':
		case 'LogicalExpression':
			return evalBinary(node, ctx);

		case 'UnaryExpression': {
			var v = evalNode(node.argument, ctx);
			switch ( node.operator ) {
				case '!': return !v;
				case '-': return -v;
				case '+': return +v;
				case '~': return ~v;
				case 'typeof': return typeof v;
			}
			throw new Error('expr: unsupported unary "' + node.operator + '"');
		}

		case 'ConditionalExpression':
			return evalNode(node.test, ctx)
				? evalNode(node.consequent, ctx)
				: evalNode(node.alternate, ctx);

		case 'ArrayExpression':
			return node.elements.map(function ( e ) { return evalNode(e, ctx); });

		case 'ObjectExpression': {
			var o = {};
			node.properties.forEach(function ( pr ) {
				var k = pr.computed ? evalNode(pr.key, ctx)
					: (pr.key.name != null ? pr.key.name : pr.key.value);
				o[safeProp(String(k))] = evalNode(pr.value, ctx);
			});
			return o;
		}

		case 'Compound': {
			var last;
			node.body.forEach(function ( n ) { last = evalNode(n, ctx); });
			return last;
		}

		case 'ThisExpression':
			return undefined;
	}
	throw new Error('expr: unsupported node "' + node.type + '"');
}

function evalBinary( node, ctx ) {
	var op = node.operator;
	// logical operators short-circuit and return the operand (like JS / the
	// original `return (expr)`)
	if ( op === '&&' ) return evalNode(node.left, ctx) && evalNode(node.right, ctx);
	if ( op === '||' ) return evalNode(node.left, ctx) || evalNode(node.right, ctx);

	var l = evalNode(node.left, ctx), r = evalNode(node.right, ctx);
	switch ( op ) {
		case '==':  return l == r;   // loose, matching original DSL semantics
		case '!=':  return l != r;
		case '===': return l === r;
		case '!==': return l !== r;
		case '<':   return l < r;
		case '>':   return l > r;
		case '<=':  return l <= r;
		case '>=':  return l >= r;
		case '+':   return l + r;
		case '-':   return l - r;
		case '*':   return l * r;
		case '/':   return l / r;
		case '%':   return l % r;
		case '**':  return Math.pow(l, r);
		case '&':   return l & r;
		case '|':   return l | r;
		case '^':   return l ^ r;
		case '<<':  return l << r;
		case '>>':  return l >> r;
		case '>>>': return l >>> r;
	}
	throw new Error('expr: unsupported binary "' + op + '"');
}

// -------------------------------------------------------------- public API
function preprocessRefs( src ) {
	return src.replace(REF_RE, function ( _m, ref ) {
		return REF_FN + '(' + JSON.stringify(ref) + ')';
	});
}

// Join an array of sub-expressions with AND, mirroring the original
// `query.join(") && (")` wrapped in `(...)`.
function normalize( source ) {
	if ( Array.isArray(source) ) {
		var parts = source.filter(function ( s ) { return s != null && String(s).trim() !== ''; });
		if ( !parts.length ) return '';
		return '(' + parts.join(') && (') + ')';
	}
	return source == null ? '' : String(source);
}

/**
 * Compile a mini-DSL expression into a safe evaluator.
 *
 * @param   {string|string[]} source   expression, or array AND-joined together
 * @param   {{empty?: *}}    [options]  `empty` is returned for an empty source
 *                                      (default `true`, matching Concept/queryMaps;
 *                                      pass `false` for getChildMatching/test)
 * @returns {function(resolve, names=): *}  `resolve(refName)` resolves `$ref`s,
 *                                      `names` (optional) resolves bare identifiers
 *                                      (stands in for doEval's `with(refMap)`).
 *                                      Returns `undefined` on any runtime error.
 * @throws  {Error} on syntax errors (faithful: `new Function` also threw at compile)
 */
function compileExpression( source, options ) {
	var fallback = ( options && 'empty' in options ) ? options.empty : true;
	var src = normalize(source).trim();

	if ( !src ) {
		return function () { return fallback; };
	}

	var ast = jsep(preprocessRefs(src));

	return function ( resolve, names ) {
		try {
			return evalNode(ast, { resolve: resolve, names: names });
		} catch ( e ) {
			return undefined;
		}
	};
}

module.exports = { compileExpression: compileExpression };
