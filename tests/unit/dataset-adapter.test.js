'use strict';
// dataset-adapter — the promoted brick: a labelled query dataset → {query, context, klass, goldShape}, the
// neutral shape the typed-grammar stock pipeline consumes. WikiSQL built-in; a 2nd inline adapter proves the
// abstraction is generic (so "plusieurs datasets" flow the SAME pipeline + SAME comparable metrics).
const test = require('node:test');
const assert = require('node:assert');
const A = require('../../lib/authoring/dataset-adapter.js');

test('wikisql adapter — a record maps to {query, context.columns, klass=agg|nConds, goldShape}', () => {
	const wk = A.getAdapter('wikisql');
	const aux = { tables: { 't1': { id: 't1', header: ['Name', 'Age', 'City'] } } };
	// agg=3 (count), 1 cond → shape [filter, aggregate, select], class "count|1"
	const m = wk.adapt({ question: 'how many people live in Paris?', table_id: 't1', sql: { sel: 0, agg: 3, conds: [[2, 0, 'Paris']] } }, aux);
	assert.equal(m.query, 'how many people live in Paris?');
	assert.deepEqual(m.context.columns, ['Name', 'Age', 'City']);
	assert.equal(m.klass, 'count|1');
	assert.deepEqual(m.goldShape, ['filter', 'aggregate', 'select']);
	// agg=0 (none), 0 conds → [select] only, class "none|0"
	const m2 = wk.adapt({ question: 'list everyone', table_id: 't1', sql: { sel: 0, agg: 0, conds: [] } }, aux);
	assert.deepEqual(m2.goldShape, ['select']);
	assert.equal(m2.klass, 'none|0');
	// 2 conds, none → [filter, filter, select], class "none|2"
	const m3 = wk.adapt({ question: 'x', table_id: 't1', sql: { sel: 0, agg: 0, conds: [[0, 0, 'a'], [1, 0, 'b']] } }, aux);
	assert.deepEqual(m3.goldShape, ['filter', 'filter', 'select']);
	assert.equal(m3.klass, 'none|2');
});

test('wikisql adapter — a malformed record maps to null (skipped, never crashes the load)', () => {
	const wk = A.getAdapter('wikisql');
	assert.equal(wk.adapt({ question: 'no sql' }, { tables: {} }), null);
	assert.equal(wk.adapt(null, { tables: {} }), null);
});

test('loadDataset — groups in-memory records by class, honors classes whitelist + perClass cap', () => {
	const wk = A.getAdapter('wikisql');
	const records = [
		{ question: 'q1', table_id: 't', sql: { sel: 0, agg: 0, conds: [[0, 0, 'a']] } },   // none|1
		{ question: 'q2', table_id: 't', sql: { sel: 0, agg: 0, conds: [[0, 0, 'b']] } },   // none|1
		{ question: 'q3', table_id: 't', sql: { sel: 0, agg: 0, conds: [[0, 0, 'c']] } },   // none|1
		{ question: 'q4', table_id: 't', sql: { sel: 0, agg: 3, conds: [[0, 0, 'd']] } }    // count|1
	];
	const all = A.loadDataset(wk, { records, aux: { tables: {} } });
	assert.deepEqual(Object.keys(all).sort(), ['count|1', 'none|1']);
	assert.equal(all['none|1'].length, 3);
	assert.equal(all['count|1'].length, 1);
	// whitelist + cap
	const some = A.loadDataset(wk, { records, aux: { tables: {} }, classes: ['none|1'], perClass: 2 });
	assert.deepEqual(Object.keys(some), ['none|1']);
	assert.equal(some['none|1'].length, 2, 'perClass cap applied; count|1 excluded by whitelist');
});

test('registerAdapter — a 2nd inline adapter (generic proof): any dataset flows the same shape', () => {
	// a toy "logical-form" dataset: {q, lf} where lf is a nested predicate; class = the outer predicate name,
	// goldShape = the predicate nesting kinds. Different surface, SAME neutral {query,klass,goldShape}.
	A.registerAdapter({
		name: 'toylf',
		stepEnum: ['scope', 'filter', 'project'],
		adapt: function ( r ) {
			if ( !r || !r.lf ) return null;
			const outer = r.lf.op;
			const shape = (r.lf.args || []).map(( a ) => a === 'filter' ? 'filter' : 'scope').concat('project');
			return { query: r.q, context: null, klass: outer, goldShape: shape };
		}
	});
	assert.ok(A.listAdapters().includes('toylf'));
	const adp = A.getAdapter('toylf');
	const by = A.loadDataset(adp, { records: [
		{ q: 'largest state', lf: { op: 'argmax', args: ['scope'] } },
		{ q: 'states bordering texas', lf: { op: 'filter', args: ['filter'] } }
	] });
	assert.deepEqual(Object.keys(by).sort(), ['argmax', 'filter']);
	assert.deepEqual(by['argmax'][0].goldShape, ['scope', 'project']);
	assert.equal(by['argmax'][0].query, 'largest state');
});

test('getAdapter — unknown name throws with the registered list', () => {
	assert.throws(() => A.getAdapter('nope'), /no dataset adapter "nope"/);
});

test('exposed on the facade Graph.authoring.datasetAdapter', () => {
	const authoring = require('../../lib/authoring/index.js');
	assert.equal(typeof authoring.datasetAdapter.loadDataset, 'function');
	assert.ok(authoring.datasetAdapter.listAdapters().includes('wikisql'));
});
