'use strict';
/**
 * A `sg forge` ADAPTER for WikiSQL — the reference example of the adapter contract.
 *
 * An adapter turns a raw dataset into the class-grouped, gold-labelled corpus the forge consumes, and
 * knows how to parse THIS dataset's model output into typed steps. It exports:
 *   - stepEnum:  the typed-step vocabulary
 *   - loadClasses({ data, classes, per }) -> { sig: [ { problem, header?, goldSteps:[kind] } ] }
 *   - decompose(ask, rec, opts) -> steps[]   (called with the model `ask`; parse its reply into steps)
 *
 * WikiSQL's `sql:{sel,agg,conds}` is a PRE-TYPED decomposition → the gold ORACLE with no SQL parsing.
 * Class = {agg, nConds}; the gold method shape = nConds×filter [+ aggregate] + select.
 *
 *   node bin/sg forge --adapter examples/forge-adapters/wikisql.js --data /path/to/wikisql/data \
 *        --model models/your.gguf --classes none|1,count|1,sum|1 --per 3 --out wikisql.sgc --dossier wikisql.md
 */
const fs = require('fs');
const AGG = ['none', 'max', 'min', 'count', 'sum', 'avg'];
const stepEnum = ['filter', 'aggregate', 'select'];

const snap = ( s ) => {
	if ( s && typeof s === 'object' ) s = s.kind || s.step || s.type || s.name || Object.values(s)[0];   // tolerate object-form steps
	const str = String(s || '').toLowerCase();
	return stepEnum.find(( e ) => str.includes(e)) || str;
};

function goldSteps( sql ) {
	const steps = [];
	for ( let i = 0; i < sql.conds.length; i++ ) steps.push('filter');
	if ( sql.agg !== 0 ) steps.push('aggregate');
	steps.push('select');
	return steps;
}

function loadClasses( o ) {
	o = o || {};
	const data = o.data || '/mnt/d/wikisql-stock/data';
	const per = o.per || 3;
	const want = o.classes || ['none|1', 'none|2', 'count|1', 'max|1', 'min|1', 'sum|1'];
	const tables = {};
	fs.readFileSync(data + '/dev.tables.jsonl', 'utf8').trim().split('\n').forEach(( l ) => { const t = JSON.parse(l); tables[t.id] = t; });
	const byClass = {};
	for ( const l of fs.readFileSync(data + '/dev.jsonl', 'utf8').trim().split('\n') ) {
		const r = JSON.parse(l);
		const sig = AGG[r.sql.agg] + '|' + r.sql.conds.length;
		if ( want.indexOf(sig) < 0 ) continue;
		(byClass[sig] = byClass[sig] || []).push({ problem: r.question, header: (tables[r.table_id] || {}).header || [], goldSteps: goldSteps(r.sql) });
	}
	const out = {};
	for ( const s of want ) if ( (byClass[s] || []).length >= 2 ) out[s] = byClass[s].slice(0, per);
	return out;
}

async function decompose( ask, rec, o ) {
	o = o || {};
	if ( !ask ) return o.corrupt ? rec.goldSteps.slice(0, Math.max(1, rec.goldSteps.length - 1)) : rec.goldSteps.slice();
	const txt = await ask({
		system: 'You break a natural-language table query into an ORDERED list of typed steps. Kinds (use ONLY these): ' + stepEnum.join(', ') + '.\n'
			+ 'RULES:\n'
			+ '- one "filter" for EACH condition that restricts a column to a specific value.\n'
			+ '- add EXACTLY ONE "aggregate" (right before the final select) if the query asks for a count/number/total/sum/average, '
			+ 'OR the highest/largest/most/maximum/greatest, OR the lowest/smallest/least/minimum/fewest. If it just asks which/what/who value, there is NO aggregate.\n'
			+ '- always end with exactly one "select".\n'
			+ 'Worked examples:\n'
			+ '  "How many players are from Butler?" -> {"steps":["filter","aggregate","select"]}\n'
			+ '  "What is the highest score in 2010?" -> {"steps":["filter","aggregate","select"]}\n'
			+ '  "What is the lowest attendance when the away team was X?" -> {"steps":["filter","aggregate","select"]}\n'
			+ '  "What is the total number of points for team Y?" -> {"steps":["filter","aggregate","select"]}\n'
			+ '  "What position does player X play?" -> {"steps":["filter","select"]}\n'
			+ '  "What team is in city C and division D?" -> {"steps":["filter","filter","select"]}\n'
			+ 'Reply ONLY JSON, steps are STRINGS: {"steps":["filter","aggregate","select"]}.',
		user: 'Columns: ' + (rec.header || []).join(', ') + '\nQuery: ' + rec.problem, maxTokens: 80, temperature: o.temperature || 0
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return (JSON.parse(m ? m[0] : txt).steps || []).map(snap); }
	catch ( e ) { return []; }
}

module.exports = { name: 'wikisql', stepEnum, loadClasses, decompose };
