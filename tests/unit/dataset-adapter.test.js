'use strict';
// dataset-adapter — the promoted brick: a labelled query dataset → {query, context, klass, goldShape}, the
// neutral shape the typed-grammar stock pipeline consumes. WikiSQL built-in; a 2nd inline adapter proves the
// abstraction is generic (so "plusieurs datasets" flow the SAME pipeline + SAME comparable metrics).
const test = require('node:test');
const assert = require('node:assert');
const A = require('../../lib/authoring/forge/dataset-adapter.js');

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

// ── Spider (built-in #2, the RECURSIVE query dataset): a structural SQL analyzer over the raw gold `query`
//    (the HF release ships no parsed AST). Its point vs WikiSQL = nesting (subquery-in-WHERE) + set-ops, the
//    compositional structure that makes a blend MEANINGFUL (a nested query's method = outer skeleton + subquery). ─
test('spider adapter — flat queries → {query=question, klass=shape, goldShape} (structural parse of the gold SQL)', () => {
	const sp = A.getAdapter('spider');
	const m = ( q ) => sp.adapt({ db_id: 'd', question: 'nl?', query: q });
	// count(*) → one aggregate + select; no where
	assert.deepEqual(m('SELECT count(*) FROM singer').goldShape, ['aggregate', 'select']);
	assert.equal(m('SELECT count(*) FROM singer').query, 'nl?');
	// 1 filter + aggregate
	assert.deepEqual(m("SELECT avg(age) FROM singer WHERE country = 'France'").goldShape, ['filter', 'aggregate', 'select']);
	assert.equal(m("SELECT avg(age) FROM singer WHERE country = 'France'").klass, 'filter>aggregate>select');
	// 2 joins + 2 filters + aggregate (an AND-condition counts 2 filters; joins counted top-level)
	assert.deepEqual(m("SELECT count(*) FROM student AS T1 JOIN has_pet AS T2 ON T1.stuid = T2.stuid JOIN pets AS T3 ON T2.petid = T3.petid WHERE T1.sex = 'F' AND T3.pettype = 'dog'").goldShape,
		['join', 'join', 'filter', 'filter', 'aggregate', 'select']);
	// group + order (agg from ORDER BY count(*))
	assert.deepEqual(m('SELECT YEAR FROM concert GROUP BY YEAR ORDER BY count(*) DESC LIMIT 1').goldShape, ['group', 'aggregate', 'order', 'select']);
});

test('spider adapter — a NESTED query: the outer skeleton is CLEAN (subquery masked) + the subquery is extracted (the blend material)', () => {
	const sp = A.getAdapter('spider');
	const m = sp.adapt({ db_id: 'concert_singer', question: 'songs by older-than-average singers', query: 'SELECT song_name FROM singer WHERE age > (SELECT avg(age) FROM singer)' });
	assert.equal(m.nested, true, 'a WHERE-operand subquery is detected');
	assert.deepEqual(m.goldShape, ['filter', 'select'], 'the OUTER skeleton is filter>select — the subquery avg does NOT pollute it (masked)');
	assert.equal(m.klass, 'filter>select|n', 'the nesting flag makes it a DISTINCT class from a plain filter>select');
	assert.equal(m.subquery, 'SELECT avg(age) FROM singer', 'the subquery SQL is pulled — it becomes the donor grammar');
	// the subquery, analyzed on its own, is the aggregate grammar the blend grafts into the filter slot.
	assert.deepEqual(A.spiderGoldShape(A.analyzeSpiderSQL(m.subquery)), ['aggregate', 'select'], 'donor = aggregate>select');
});

test('spider adapter — a SET-OP query is tagged (a 2nd, binary top-level composition; classified, out of blend scope)', () => {
	const sp = A.getAdapter('spider');
	const m = sp.adapt({ db_id: 'd', question: 'x', query: 'SELECT country FROM singer WHERE age > 40 INTERSECT SELECT country FROM singer WHERE age < 30' });
	assert.equal(m.setop, 'intersect');
	assert.equal(m.klass, 'filter>select|intersect', 'the set-op tags the class (left-operand shape + the combinator)');
});

test('spider adapter — NEG: no query / malformed → null (skipped, never crashes the load)', () => {
	const sp = A.getAdapter('spider');
	assert.equal(sp.adapt({ db_id: 'd', question: 'q' }), null, 'no query → null');
	assert.equal(sp.adapt(null), null);
});

test('spider — loadDataset buckets by structural class; nesting/set-ops form their own classes (population richness)', () => {
	const sp = A.getAdapter('spider');
	const records = [
		{ db_id: 'd', question: 'a', query: 'SELECT count(*) FROM t' },                                  // aggregate>select
		{ db_id: 'd', question: 'b', query: "SELECT x FROM t WHERE y = 'k'" },                            // filter>select
		{ db_id: 'd', question: 'c', query: 'SELECT x FROM t WHERE y > (SELECT avg(z) FROM t)' },         // filter>select|n
		{ db_id: 'd', question: 'd', query: 'SELECT x FROM t EXCEPT SELECT x FROM u' }                    // select|except
	];
	const by = A.loadDataset(sp, { records });
	assert.deepEqual(Object.keys(by).sort(), ['aggregate>select', 'filter>select', 'filter>select|n', 'select|except']);
});

test('getAdapter — unknown name throws with the registered list', () => {
	assert.throws(() => A.getAdapter('nope'), /no dataset adapter "nope"/);
});

test('exposed on the facade Graph.authoring.datasetAdapter', () => {
	const authoring = require('../../lib/authoring/index.js');
	assert.equal(typeof authoring.datasetAdapter.loadDataset, 'function');
	assert.ok(authoring.datasetAdapter.listAdapters().includes('wikisql'));
});
