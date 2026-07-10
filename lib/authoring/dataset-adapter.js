/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * dataset-adapter — the PROMOTED dataset-adapter brick (roadmap-use-cases: "promouvoir la brique dataset-adapter
 * en lib"). Turns a LABELLED query dataset (WikiSQL, a semantic-parsing set, a client corpus) into the neutral
 * shape the typed-grammar STOCK pipeline consumes, so "plusieurs datasets" is one registry away and their
 * distilled `.sgc` grammars are COMPARABLE (same explorer metrics on each).
 *
 * PURE + engine-free (an optional `fs` read for jsonl; no Graph, no model). An adapter maps one record →
 *   {
 *     query:     string        — the NL query (→ the model extractor / the frontier answer)
 *     context:   object|null   — typed context for the extractor prompt (e.g. {columns:[...]}), or null
 *     klass:     string        — the COVERAGE CLASS key = signature.structure (ONE method distilled per class)
 *     goldShape: string[]      — the gold typed decomposition = the ORACLE (goldGate admits iff model==gold)
 *   }
 * The class is the typed signature the proxy dispatches on (one frontier answer covers the class); the goldShape
 * is the gold-gate oracle (0-false stock). Same two fields ⇒ any dataset flows the SAME pipeline + SAME metrics.
 *
 *   const { getAdapter, loadDataset } = require('skynet-graph/lib/authoring/dataset-adapter');
 *   const byClass = loadDataset(getAdapter('wikisql'), { file, aux:{tablesFile}, perClass:4 });
 *
 * An adapter: { name, stepEnum:[kinds], adapt(record, aux) -> mapped|null }. Register more with registerAdapter.
 */

var _adapters = {};

/** register a dataset adapter (name → {name, stepEnum, adapt}). Later registration overrides. */
function registerAdapter( adapter ) {
	if ( !adapter || !adapter.name || typeof adapter.adapt !== 'function' ) throw new Error('registerAdapter needs { name, adapt(record, aux) }');
	_adapters[adapter.name] = adapter;
	return adapter;
}
/** fetch a registered adapter by name (throws if unknown). */
function getAdapter( name ) {
	if ( !_adapters[name] ) throw new Error('no dataset adapter "' + name + '" (registered: ' + Object.keys(_adapters).join(', ') + ')');
	return _adapters[name];
}
/** list registered adapter names. */
function listAdapters() { return Object.keys(_adapters); }

/**
 * Group a dataset's records by their coverage CLASS (the typed signature). Reads a jsonl file (or takes an
 * in-memory `records` array), maps each with the adapter, drops nulls, and buckets by `klass`.
 * @param adapter        a registered/inline adapter { adapt(record, aux) }.
 * @param opts.file      jsonl path (one JSON record per line) — OR opts.records (an array, no fs).
 * @param opts.aux       adapter-specific side data (e.g. {tables} / {tablesFile}); passed to adapt(record, aux).
 * @param opts.classes   optional string[] whitelist of class keys to keep (else all).
 * @param opts.perClass  optional cap on kept instances PER class (the extra are dropped; the caller slices held-out).
 * @returns { [klass]: [ {query,context,klass,goldShape}, … ] }
 */
function loadDataset( adapter, opts ) {
	opts = opts || {};
	var aux = resolveAux(adapter, opts.aux);
	var records = opts.records || readJsonl(opts.file);
	var byClass = {};
	for ( var i = 0; i < records.length; i++ ) {
		var m = adapter.adapt(records[i], aux);
		if ( !m || !m.klass || !Array.isArray(m.goldShape) ) continue;
		if ( opts.classes && opts.classes.indexOf(m.klass) < 0 ) continue;
		var b = (byClass[m.klass] = byClass[m.klass] || []);
		if ( opts.perClass != null && b.length >= opts.perClass ) continue;
		b.push(m);
	}
	return byClass;
}

// an adapter may declare aux it needs loaded from a file (e.g. WikiSQL's tables). Resolve a *File → parsed.
function resolveAux( adapter, aux ) {
	aux = aux || {};
	if ( typeof adapter.resolveAux === 'function' ) return adapter.resolveAux(aux);
	return aux;
}

function readJsonl( file ) {
	if ( !file ) return [];
	var fs = require('fs');
	var out = [], lines = fs.readFileSync(file, 'utf8').trim().split('\n');
	for ( var i = 0; i < lines.length; i++ ) { var l = lines[i].trim(); if ( l ) try { out.push(JSON.parse(l)); } catch ( e ) {} }
	return out;
}

// ── built-in: WikiSQL (github salesforce/WikiSQL). Its `sql:{sel,agg,conds}` is a PRE-TYPED decomposition →
//    the gold oracle with NO SQL parsing. class = {agg}|{nConds}; method shape = nConds×filter [+aggregate] +select.
var WIKISQL_AGG = ['none', 'max', 'min', 'count', 'sum', 'avg'];
function wikisqlGoldShape( sql ) {
	var steps = [];
	for ( var i = 0; i < (sql.conds || []).length; i++ ) steps.push('filter');
	if ( sql.agg !== 0 ) steps.push('aggregate');
	steps.push('select');
	return steps;
}
registerAdapter({
	name: 'wikisql',
	stepEnum: ['filter', 'aggregate', 'select'],
	// aux: { tables } (id→table) OR { tablesFile } (a jsonl of {id,header}); resolveAux loads the file once.
	resolveAux: function ( aux ) {
		if ( aux.tables ) return aux;
		if ( aux.tablesFile ) { var t = {}; readJsonl(aux.tablesFile).forEach(function ( x ) { t[x.id] = x; }); return { tables: t }; }
		return { tables: {} };
	},
	adapt: function ( r, aux ) {
		if ( !r || !r.sql || !Array.isArray(r.sql.conds) ) return null;
		var agg = WIKISQL_AGG[r.sql.agg] || 'none';
		return {
			query: r.question,
			context: { columns: ((aux.tables[r.table_id] || {}).header) || [] },
			klass: agg + '|' + r.sql.conds.length,          // the coverage class = {agg, nConds}
			goldShape: wikisqlGoldShape(r.sql)
		};
	}
});

// ── built-in: Spider (Yale text-to-SQL). Unlike WikiSQL, the HF release ships only the raw gold SQL string
//    (no pre-parsed AST), so this adapter is a SMALL structural SQL analyzer over the gold `query` — the typed
//    decomposition is a deterministic function of the gold SQL (parsing the gold IS reading the oracle, the same
//    way Spider's own evaluation parses gold). Its POINT vs WikiSQL: Spider is RECURSIVE — a WHERE operand can be
//    a nested `(SELECT …)` subquery, and two full queries combine via INTERSECT/UNION/EXCEPT. The subquery case is
//    exactly a graft-into-slot (blendMethods) — a nested query's method = a BLEND of the outer skeleton + the
//    subquery grammar (the "concepts combine" payoff). Set-ops are a SECOND, binary top-level composition (noted,
//    but out of blendMethods' scope). stepEnum = the typed step kinds; nesting is depth (not a step token).
var SPIDER_STEPS = ['join', 'filter', 'group', 'having', 'aggregate', 'order', 'select'];

// scan a lowercased SQL string tracking paren depth + single-quoted strings; call `at(i, ch, depth)` per char.
function scanSQL( s, at ) {
	var depth = 0, q = false;
	for ( var i = 0; i < s.length; i++ ) {
		var ch = s[i];
		if ( ch === "'" ) { q = !q; continue; }
		if ( q ) continue;
		if ( ch === '(' ) { at(i, ch, depth); depth++; continue; }
		if ( ch === ')' ) { depth--; at(i, ch, depth); continue; }
		at(i, ch, depth);
	}
}
// first index of any needle at paren-depth 0 (outside quotes); returns { index, token } or null.
function findTop( s, needles ) {
	var hit = null;
	scanSQL(s, function ( i, ch, depth ) {
		if ( hit || depth !== 0 ) return;
		for ( var k = 0; k < needles.length; k++ ) if ( s.startsWith(needles[k], i) ) { hit = { index: i, token: needles[k].trim() }; return; }
	});
	return hit;
}
// count occurrences of a needle at paren-depth 0.
function countTop( s, needle ) {
	var n = 0;
	scanSQL(s, function ( i, ch, depth ) { if ( depth === 0 && s.startsWith(needle, i) ) n++; });
	return n;
}
// the balanced-paren substring of the FIRST `(select …)` (original case), or null. Used to pull the subquery
// for the blend cell (the donor grammar). Scans the lowercased copy for the marker, cuts from the original.
function firstSubquery( orig, s ) {
	var start = -1;
	scanSQL(s, function ( i, ch, depth ) {
		if ( start >= 0 || ch !== '(' ) return;
		if ( /^\(\s*select\b/.test(s.slice(i, i + 12)) ) start = i;
	});
	if ( start < 0 ) return null;
	var d = 0, end = -1;
	for ( var i = start; i < orig.length; i++ ) { if ( orig[i] === '(' ) d++; else if ( orig[i] === ')' ) { d--; if ( d === 0 ) { end = i; break; } } }
	return end > start ? orig.slice(start + 1, end).trim() : null;
}
// MASK each balanced `(select …)` subquery to `(?)` so the OUTER structure is analyzed with the subquery as an
// opaque operand (else the subquery's own agg/join/group would pollute the outer skeleton — the blend host must be
// the clean outer shape, the subquery its own donor grammar). Operates on a lowercased string.
function maskSubqueries( s ) {
	var out = '', i = 0;
	while ( i < s.length ) {
		if ( s[i] === '(' && /^\(\s*select\b/.test(s.slice(i, i + 12)) ) {
			var d = 0, j = i;
			for ( ; j < s.length; j++ ) { if ( s[j] === '(' ) d++; else if ( s[j] === ')' ) { d--; if ( d === 0 ) { j++; break; } } }
			out += '(?)'; i = j;
		} else { out += s[i]; i++; }
	}
	return out;
}

// analyze ONE select block (no top-level set-op): counts + flags of the OUTER query (subqueries masked out).
function analyzeSelect( orig ) {
	var raw = orig.toLowerCase();
	var s = maskSubqueries(raw);                         // outer structure sees the subquery as an opaque operand
	var joins = countTop(s, ' join ');
	var whereAt = findTop(s, [' where ']);
	var filters = 0, nested = false;
	if ( whereAt ) {
		// the WHERE clause runs to the first top-level group by / order by / having / end.
		var rest = s.slice(whereAt.index + 7);
		var endAt = findTop(rest, [' group by ', ' order by ', ' having ']);
		var where = endAt ? rest.slice(0, endAt.index) : rest;
		// conditions = top-level ` and `/` or `-separated fragments (a subquery is masked → its ANDs don't count).
		var conds = 1;
		scanSQL(where, function ( i, ch, depth ) { if ( depth === 0 && (where.startsWith(' and ', i) || where.startsWith(' or ', i)) ) conds++; });
		filters = conds;
		nested = where.indexOf('(?)') >= 0;              // a subquery operand appeared in a WHERE condition
	}
	return {
		joins: joins, filters: filters,
		group: findTop(s, [' group by ']) != null,
		having: findTop(s, [' having ']) != null,
		agg: /\b(count|sum|avg|min|max)\s*\(/.test(s),   // masked → outer aggregates only
		order: findTop(s, [' order by ']) != null,
		nested: nested, subquery: nested ? firstSubquery(orig, raw) : null
	};
}

// the ordered typed decomposition of the OUTER query (subquery stays inside its filter operand → depth, not a step).
function spiderGoldShape( a ) {
	var steps = [];
	for ( var i = 0; i < a.joins; i++ ) steps.push('join');
	for ( var j = 0; j < a.filters; j++ ) steps.push('filter');
	if ( a.group ) steps.push('group');
	if ( a.having ) steps.push('having');
	if ( a.agg ) steps.push('aggregate');
	if ( a.order ) steps.push('order');
	steps.push('select');
	return steps;
}

// analyze a full gold SQL: detect a top-level set-op, else the single select. Returns { …counts, setop, subquery }.
function analyzeSpiderSQL( query ) {
	var orig = String(query || '').replace(/\s+/g, ' ').trim();
	var s = orig.toLowerCase();
	var so = findTop(s, [' intersect ', ' union ', ' except ']);
	if ( so ) { var left = analyzeSelect(orig.slice(0, so.index)); left.setop = so.token; return left; }
	var a = analyzeSelect(orig); a.setop = null; return a;
}

registerAdapter({
	name: 'spider',
	stepEnum: SPIDER_STEPS,
	analyze: analyzeSpiderSQL,                            // exposed for the blend cell (outer skeleton + subquery)
	goldShapeOf: spiderGoldShape,
	adapt: function ( r ) {
		if ( !r || !r.query ) return null;
		var a = analyzeSpiderSQL(r.query);
		var shape = spiderGoldShape(a);
		// the coverage class = the outer shape + a nesting flag + a set-op tag (both make a distinct, VISIBLE class).
		var klass = shape.join('>') + (a.nested ? '|n' : '') + (a.setop ? '|' + a.setop : '');
		return {
			query: r.question, context: { db_id: r.db_id },
			klass: klass, goldShape: shape,
			sql: r.query, nested: a.nested, subquery: a.subquery, setop: a.setop   // extras for the blend cell (kept by loadDataset)
		};
	}
});

module.exports = { registerAdapter: registerAdapter, getAdapter: getAdapter, listAdapters: listAdapters, loadDataset: loadDataset,
	analyzeSpiderSQL: analyzeSpiderSQL, spiderGoldShape: spiderGoldShape };
