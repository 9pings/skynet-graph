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

module.exports = { registerAdapter: registerAdapter, getAdapter: getAdapter, listAdapters: listAdapters, loadDataset: loadDataset };
