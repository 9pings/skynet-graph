'use strict';
/*
 * _data — la sélection MÉCANIQUE pré-enregistrée (DESIGN §scénario + confront fix #3).
 * Rapport = groupement par TICKER/ANNÉE (préfixe d'id FinQA). Le PREMIER rapport (ordre du fichier) avec :
 *   ≥ 4 items gold-vérifiés, couverts (shape ∈ stock forgé Q6) ET table-résolvables (tous les littéraux du
 *   programme gold présents dans LA table) · ≥ 3 shapes couvertes distinctes · ≥ 1 item PIÈGE (shape ∉ stock)
 *   lui aussi table-résolvable (son refus doit être PUREMENT forme).
 * Les items texte-dépendants du rapport sont retournés à part (la FRONTIÈRE affichée, jamais résolus en douce).
 */
const fs = require('fs');
const NRG = require('path').join(__dirname, '..', '..');    // le repo lui-même (fusion NRG→skynet-graph faite)
const A = require(NRG + '/examples/forge-adapters/finqa.js');

const STOCK_PATH = __dirname + '/finqa-stock-q6.sgc';                       // stock forgé embarqué (23 Ko, dossier sha256)

function certifiedShapes() {
	const b = JSON.parse(fs.readFileSync(STOCK_PATH, 'utf8'));
	return { shapes: [...new Set(b.methods.map(( m ) => m.structure.taskKind ))].sort(), bundle: b };
}

/** tous les nombres d'une table → Map(valeur → {row, col, label}) ; ambigus (≥2 cellules) → marked. */
function tableNumbers( table ) {
	const nums = new Map();
	(table || []).forEach(( r, ri ) => r.forEach(( c, ci ) => {
		const v = Number(String(c).replace(/[,$%()]/g, ''));
		if ( !isFinite(v) || String(c).trim() === '' ) return;
		if ( nums.has(v) ) nums.get(v).ambiguous = true;
		else nums.set(v, { row: ri, col: ci, label: String(r[0]).trim(), ambiguous: false });
	}));
	return nums;
}

/** littéraux d'un programme DSL (null si labels de ligne = hors périmètre args) */
function literalArgs( program ) {
	const out = []; let m; const re = /([a-z_]+)\(([^)]*)\)/g;
	while ( (m = re.exec(String(program))) ) for ( const raw of m[2].split(',') ) {
		const s = raw.trim();
		if ( /^#\d+$/.test(s) || /^const_/.test(s) ) continue;
		const clean = s.replace(/[,$%]/g, '');
		if ( /^-?\d*\.?\d+$/.test(clean) ) out.push(/%$/.test(s) ? Number(clean) / 100 : Number(clean));
		else return null;
	}
	return out;
}

const reportOf = ( id ) => String(id).split('/').slice(0, 2).join('/');

/** la sélection mécanique. → { report, certified, items:[…couverts+résolvables], trap, textBound:[…], all } */
function pickReport( o ) {
	o = o || {};
	// mission-data.json = the mechanical selection, serialized once from the FinQA dataset — the demo
	// ships self-contained (75 MB dataset NOT required). To regenerate from source: FINQA_DATA=<dir>.
	const CACHE = __dirname + '/mission-data.json';
	if ( !o.data && !process.env.FINQA_DATA && fs.existsSync(CACHE) ) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
	const { shapes: certified } = certifiedShapes();
	const rows = JSON.parse(fs.readFileSync((o.data || process.env.FINQA_DATA || '/mnt/d/hf-stocks/finqa') + '/train.json', 'utf8'));
	const byReport = new Map();
	for ( const it of rows ) {
		const k = reportOf(it.id);
		if ( !byReport.has(k) ) byReport.set(k, []);
		byReport.get(k).push(it);
	}
	for ( const [ report, its ] of byReport ) {
		const items = [], textBound = [], traps = [];
		for ( const it of its ) {
			const q = it.qa || {};
			const r = A.execProgram(q.program, it.table);
			if ( !r ) continue;
			const scale = A.pinScale(r.value, q.exe_ans);
			if ( scale == null ) continue;
			const sig = r.shape.join('>');
			const lits = literalArgs(q.program);
			const nums = tableNumbers(it.table);
			const resolvable = !!lits && lits.length > 0 && lits.every(( v ) => nums.has(v) );
			const rec = { id: it.id, problem: q.question, table: it.table, gold: sig,
				goldProgram: q.program, exeAns: q.exe_ans, scale, covered: certified.indexOf(sig) >= 0, resolvable };
			if ( rec.covered && resolvable ) items.push(rec);
			else if ( !rec.covered && resolvable ) traps.push(rec);
			else textBound.push(rec);
		}
		const shapeSet = new Set(items.map(( i ) => i.gold ));
		if ( items.length >= 4 && shapeSet.size >= 3 && traps.length >= 1 )
			return { report, certified, items, trap: traps[0], textBound, criteria: '≥4 covered table-resolvable · ≥3 shapes · ≥1 table-resolvable trap' };
	}
	throw new Error('no qualifying report (mechanical criterion)');
}

module.exports = { pickReport, certifiedShapes, tableNumbers, literalArgs, STOCK_PATH };

if ( require.main === module ) {
	const r = pickReport();
	console.log('report:', r.report, '· covered+resolvable:', r.items.length, '· shapes:', [...new Set(r.items.map(( i ) => i.gold ))].join(', '));
	console.log('trap:', r.trap.id, '[' + r.trap.gold + ']', '· boundary (text/uncovered):', r.textBound.length);
	r.items.forEach(( i ) => console.log('  ·', i.id, '[' + i.gold + ']', i.problem.slice(0, 90)));
}
