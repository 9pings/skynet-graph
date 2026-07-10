'use strict';
/**
 * A `sg forge` ADAPTER for FinQA — the 2nd-domain vehicle (HF survey #1, pilot 2026-07-10: 99.3% of the 6251
 * gold rows extract WITHOUT an LLM and re-execute against `exe_ans`; 114 shapes, top-20 = 94.7% — the ideal
 * amortization profile: financial table reasoning is STEREOTYPED).
 *
 * The gold `program` is a sequence over a CLOSED 10-op DSL (`divide(3.8, #0)`-style, #k = prior step result,
 * table_* ops aggregate a table row by label). Adapter contract (= wikisql.js reference):
 *   - stepEnum: the 10 DSL ops — the typed-step vocabulary;
 *   - loadClasses({ data, classes, per }) → class-grouped gold recs. THE GOLD GATE AT LOAD (fail-closed): an
 *     item is admitted ONLY if its program EXECUTES and matches exe_ans; the matching SCALE (1 / ×100 / ÷100 —
 *     FinQA's % convention is inconsistent per-item) is PINNED on the rec (`scale`) so a runtime verifier never
 *     inherits the multi-scale mask (the pilot's 1/155 neg-control escape);
 *   - decompose(ask, rec) → op steps (the model reads question + table and emits the op sequence, grammar-insured);
 *   - execProgram/matches exported à nu (the runtime verifier bricks).
 *
 *   node bin/sg forge --adapter examples/forge-adapters/finqa.js --data /mnt/d/hf-stocks/finqa \
 *        --model models/your.gguf --classes divide|subtract>divide --per 3 --out finqa.sgc --dossier finqa.md
 */
const fs = require('fs');

const stepEnum = ['add', 'subtract', 'multiply', 'divide', 'exp', 'greater', 'table_max', 'table_min', 'table_sum', 'table_average'];
const STEP_RE = /([a-z_]+)\(([^)]*)\)/g;

function numArg( s ) {
	s = String(s).trim();
	if ( /^#\d+$/.test(s) ) return { ref: Number(s.slice(1)) };
	if ( /^const_m?[\d_]+$/.test(s) ) { const v = Number(s.replace('const_', '').replace('m', '-').replace(/_/g, '.')); return isFinite(v) ? { v } : null; }
	const clean = s.replace(/[,$%]/g, '');
	if ( /^-?\d*\.?\d+$/.test(clean) ) { let v = Number(clean); if ( /%$/.test(s) ) v /= 100; return { v }; }
	return { row: s };                                   // a table row label (valid only for table_* ops)
}
function rowCells( table, label ) {
	const t = (table || []).find(( r ) => String(r[0]).trim().toLowerCase() === String(label).trim().toLowerCase());
	if ( !t ) return null;
	const cells = t.slice(1).map(( c ) => Number(String(c).replace(/[,$%()]/g, '')) ).filter(( v ) => isFinite(v));
	return cells.length ? cells : null;
}
/** Execute a DSL program against a table. → { value, shape:[op…] } or null (fail-closed on anything non-deterministic). */
function execProgram( program, table ) {
	const results = [], shape = []; let m; STEP_RE.lastIndex = 0;
	while ( (m = STEP_RE.exec(String(program))) ) {
		const op = m[1], args = m[2].split(',').map(numArg);
		if ( stepEnum.indexOf(op) < 0 || args.some(( a ) => !a) ) return null;
		shape.push(op);
		const val = ( a ) => a.ref != null ? results[a.ref] : a.v;
		let r;
		if ( op.indexOf('table_') === 0 ) {
			const cells = args[0] && args[0].row ? rowCells(table, args[0].row) : null;
			if ( !cells ) return null;
			r = op === 'table_max' ? Math.max(...cells) : op === 'table_min' ? Math.min(...cells)
				: op === 'table_sum' ? cells.reduce(( a, b ) => a + b, 0) : cells.reduce(( a, b ) => a + b, 0) / cells.length;
		} else {
			if ( args.length < 2 || !args[0] || !args[1] ) return null;
			const a = val(args[0]), b = val(args[1]);
			if ( !isFinite(a) || !isFinite(b) ) return null;
			r = op === 'add' ? a + b : op === 'subtract' ? a - b : op === 'multiply' ? a * b
				: op === 'divide' ? (b === 0 ? NaN : a / b) : op === 'exp' ? Math.pow(a, b) : (a > b ? 1 : 0);
		}
		if ( typeof r === 'number' && !isFinite(r) ) return null;
		results.push(r);
	}
	return results.length ? { value: results[results.length - 1], shape } : null;
}
/** Match a computed value against exe_ans at ONE pinned scale (1 | 100 | 0.01). → bool. */
function matchesAt( v, exeAns, scale ) {
	if ( exeAns === 'yes' ) return v === 1; if ( exeAns === 'no' ) return v === 0;
	const g = Number(exeAns); if ( !isFinite(g) ) return false;
	const x = v * (scale || 1);
	return Math.abs(x - g) < 5e-5 || Math.abs(x - g) / Math.max(1e-9, Math.abs(g)) < 1e-3;
}
/** Find the scale (1 / 100 / 0.01) at which the gold program matches exe_ans — pinned at load. → scale or null. */
function pinScale( v, exeAns ) {
	for ( const s of [1, 100, 0.01] ) if ( matchesAt(v, exeAns, s) ) return s;
	return null;
}

function loadClasses( o ) {
	o = o || {};
	const file = (o.data || '/mnt/d/hf-stocks/finqa') + '/train.json';
	const per = o.per || 3;
	const want = o.classes || null;                      // default: every class that survives the gold gate
	const rows = o.rows || JSON.parse(fs.readFileSync(file, 'utf8'));   // o.rows = inline fixture (tests)
	const byClass = {};
	for ( const it of rows ) {
		const q = it.qa || {};
		const r = execProgram(q.program, it.table);
		if ( !r ) continue;                              // gold gate: must execute
		const scale = pinScale(r.value, q.exe_ans);
		if ( scale == null ) continue;                   // gold gate: must match exe_ans (échelle épinglée)
		const sig = r.shape.join('>');
		if ( want && want.indexOf(sig) < 0 ) continue;
		(byClass[sig] = byClass[sig] || []).push({
			problem: q.question,
			table: it.table, scale,
			// the SUPPORTING FACTS (qa.gold_inds) — FinQA questions reference numbers from the TEXT, not only the
			// table; without them a forge model reaches for table_* ops it does not need (0/12 run-1). Forge-time
			// gold availability is legitimate (the runtime serving side owns retrieval).
			facts: Object.values(q.gold_inds || {}).join('\n').slice(0, 800),
			exeAns: q.exe_ans, goldProgram: q.program,
			goldSteps: r.shape,
		});
	}
	const out = {};
	for ( const sig of Object.keys(byClass) ) if ( byClass[sig].length >= 2 ) out[sig] = byClass[sig].slice(0, per);
	return out;
}

const snap = ( s ) => {
	if ( s && typeof s === 'object' ) s = s.kind || s.step || s.type || s.name || Object.values(s)[0];
	const str = String(s || '').toLowerCase().replace(/-/g, '_');
	return stepEnum.find(( e ) => str === e || str.indexOf(e) >= 0 ) || str;
};

async function decompose( ask, rec, o ) {
	o = o || {};
	if ( !ask ) return o.corrupt ? rec.goldSteps.slice(0, Math.max(1, rec.goldSteps.length - 1)) : rec.goldSteps.slice();
	const tbl = (rec.table || []).map(( r ) => r.join(' | ') ).join('\n').slice(0, 900);
	const txt = await ask({
		system: 'You decompose a financial question over given facts+table into the ORDERED sequence of calculator ops. Use ONLY these ops: '
			+ stepEnum.join(', ') + '.\n'
			+ 'add/subtract/multiply/divide/exp take two numbers (a prior step result may be reused); greater compares; '
			+ 'table_max/table_min/table_sum/table_average aggregate ONE WHOLE table row.\n'
			+ 'Emit the MINIMAL op sequence — if the needed numbers are already in the facts, use PLAIN ops, never table_* ops.\n'
			+ 'Idioms: "what portion/percentage/share is X of Y?" -> {"steps":["divide"]} · "change / growth rate from A to B?" -> {"steps":["subtract","divide"]} · '
			+ '"difference between A and B?" -> {"steps":["subtract"]} · "combined total of A and B?" -> {"steps":["add"]} · '
			+ '"average of row R over the years?" -> {"steps":["table_average"]} · "is A greater than B?" -> {"steps":["greater"]}.\n'
			+ 'Reply ONLY the JSON object {"steps":[...]}.',
		user: (rec.facts ? 'Facts:\n' + rec.facts + '\n' : '') + 'Table:\n' + tbl + '\nQuestion: ' + rec.problem,
		maxTokens: 160, temperature: o.temperature || 0,
		grammar: { jsonSchema: { type: 'object', properties: { steps: { type: 'array', minItems: 1, items: { type: 'string', enum: stepEnum } } }, required: ['steps'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return (JSON.parse(m ? m[0] : txt).steps || []).map(snap); }
	catch ( _e ) { return []; }
}

module.exports = { name: 'finqa', stepEnum, loadClasses, decompose, execProgram, matchesAt, pinScale };
