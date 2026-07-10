'use strict';
/**
 * A `sg forge` ADAPTER for Spider — the 2nd-domain specialization (2026-07-09). Reuses the lib's Spider ORACLE
 * (`lib/authoring/dataset-adapter.js`: `analyzeSpiderSQL` → `spiderGoldShape`, the reliable DEPTH-AWARE SQL scanner
 * that masks subqueries + top-level set-ops) as the gold decomposition, and FEEDS THE SCHEMA
 * (`spider_schema_rows_v2.json`, keyed by db_id) into the decompose prompt — so the model CAN infer `join` steps (the
 * exact confound the schema-less 2026-07-06 live run hit: join-classes were rejected because the model couldn't see
 * the tables). Spider's grammar is RICHER/recursive than WikiSQL's → a genuine 2nd domain for the gate's generality.
 *
 * Contract: { stepEnum, loadClasses({data,classes,per}) -> {sig:[recs{problem,schema,goldSteps}]}, decompose(ask,rec,o) }.
 *
 *   node bin/sg forge --adapter examples/forge-adapters/spider.js --data /mnt/d/spider \
 *        --model models/your.gguf --classes 'aggregate>select,filter>select,join>filter>select' --per 4 \
 *        --room /path/SG-Rooms/lib1 --name spider-stock --version 0.1.0
 */
const path = require('path');
const { getAdapter, loadDataset } = require('../../lib/authoring/dataset-adapter.js');

const spider = getAdapter('spider');
const stepEnum = spider.stepEnum;                      // ['join','filter','group','having','aggregate','order','select']

// spider_schema_rows_v2.json → { db_id: "table : col (type) , … | table2 : …" } — the schema the model needs for joins.
function loadSchemas( data ) {
	let rows = [];
	try { rows = require(path.resolve(path.join(data, 'spider_schema_rows_v2.json'))); } catch ( _e ) { return {}; }
	rows = Array.isArray(rows) ? rows : Object.values(rows);
	const map = {};
	for ( const r of rows ) if ( r && r.db_id ) map[r.db_id] = r['Schema (values (type))'] || '';
	return map;
}

function loadClasses( o ) {
	o = o || {};
	const data = o.data || '/mnt/d/spider';
	const per = o.per || 4;
	const want = o.classes || null;
	const schemas = loadSchemas(data);
	const byClass = loadDataset(spider, { file: path.join(data, 'dev.jsonl'), perClass: 9999 });   // group all, slice below
	const out = {};
	for ( const sig of Object.keys(byClass) ) {
		if ( want && want.indexOf(sig) < 0 ) continue;
		const recs = byClass[sig];
		if ( recs.length < 2 ) continue;
		out[sig] = recs.slice(0, per).map(( r ) => ({
			problem: r.query,                          // r.query = the NL QUESTION (adapt() maps question→query)
			schema: schemas[(r.context || {}).db_id] || '',
			goldSteps: r.goldShape,
		}));
	}
	return out;
}

const snap = ( s ) => {
	if ( s && typeof s === 'object' ) s = s.kind || s.step || s.type || s.name || Object.values(s)[0];
	const str = String(s || '').toLowerCase();
	return stepEnum.find(( e ) => str.includes(e)) || str;
};

async function decompose( ask, rec, o ) {
	o = o || {};
	if ( !ask ) return o.corrupt ? rec.goldSteps.slice(0, Math.max(1, rec.goldSteps.length - 1)) : rec.goldSteps.slice();
	const txt = await ask({
		system: 'You decompose a natural-language database question into the ORDERED list of typed SQL steps its query needs. Use ONLY these kinds: '
			+ stepEnum.join(', ') + '.\n'
			+ 'Emit the MINIMAL steps — do NOT add a step speculatively. Most questions are just ["select"], or ["aggregate","select"], or ["filter","select"].\n'
			+ 'RULES:\n'
			+ '- "join" ONLY if answering genuinely needs columns from TWO OR MORE different tables (check the schema\'s foreign keys). If ONE table holds the answer, NO join.\n'
			+ '- "filter" for EACH explicit WHERE condition (a named value the question restricts to). A question with no restriction has NO filter.\n'
			+ '- "group" ONLY for per/each/for-every/by-category aggregation. "having" ONLY for a condition ON a group aggregate.\n'
			+ '- "aggregate" if it asks a count/number/total/sum/average, OR the highest/most/largest/maximum, OR the lowest/least/smallest/minimum.\n'
			+ '- "order" if it sorts or asks for top-N / the most / the least by a value.\n'
			+ '- ALWAYS end with EXACTLY ONE "select". Never output an empty list.\n'
			+ 'CANONICAL ORDER (only those present, in this order): join… filter… group having aggregate order select.\n'
			+ 'Examples: "How many singers?" -> {"steps":["aggregate","select"]}  ·  "What are all the models?" -> {"steps":["select"]}  ·  '
			+ '"Countries of singers over 20?" -> {"steps":["filter","select"]}  ·  "Name of the pet owned by student Smith?" (pet+student tables) -> {"steps":["join","filter","select"]}.\n'
			+ 'Reply ONLY the JSON object.',
		user: 'Schema (tables : columns | foreign keys):\n' + (rec.schema || '(single table)') + '\nQuestion: ' + rec.problem,
		maxTokens: 200, temperature: o.temperature || 0,
		grammar: { jsonSchema: { type: 'object', properties: { steps: { type: 'array', minItems: 1, items: { type: 'string', enum: stepEnum } } }, required: ['steps'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return (JSON.parse(m ? m[0] : txt).steps || []).map(snap); }
	catch ( e ) { return []; }
}

module.exports = { name: 'spider', stepEnum, loadClasses, decompose };
