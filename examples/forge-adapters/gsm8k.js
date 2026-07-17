'use strict';
/**
 * A `sg forge` ADAPTER for GSM8K — the MATH stock (R3a, the P5 pipeline's fuel). GSM8K's calculator
 * annotations make the gold extraction DETERMINISTIC (no LLM at load): every `<<expr=result>>` is a
 * BINARY op over two numbers, re-EXECUTED at load; the chain must land exactly on the `#### N`
 * answer. Anything else — a wrong result, a compound expression, a chain that misses the final
 * answer — is skipped FAIL-CLOSED (the gold gate keeps the stock clean; coverage is honest, never
 * padded). The class = the op-sequence shape (`divide>add`), the finqa/wikisql contract.
 *
 *   node bin/sg forge --adapter examples/forge-adapters/gsm8k.js --data /mnt/d/hf-stocks/gsm8k \
 *        --model models/your.gguf --per 3 --name gsm8k-stock
 */
const fs = require('fs');

const stepEnum = ['add', 'subtract', 'multiply', 'divide'];
const OP = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' };
const ANNOT_RE = /<<([^=>]+)=([^>]+)>>/g;
const BIN_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*$/;

const num = ( s ) => Number(String(s).replace(/[,$\s]/g, ''));
const close = ( a, b ) => Math.abs(a - b) < 1e-6 || Math.abs(a - b) / Math.max(1e-9, Math.abs(b)) < 1e-6;

/** Parse ONE gold answer text → { shape:[op…], value } or null (fail-closed on any malformation):
 *  every annotation must be a BINARY op that re-executes to its stated result, and the LAST
 *  annotation's result must be the `#### N` final answer. */
function parseGold( answer ) {
	const text = String(answer || '');
	const final = text.match(/####\s*([-\d,.$]+)/);
	if ( !final ) return null;
	const goal = num(final[1]);
	if ( !isFinite(goal) ) return null;
	const shape = []; let last = null, m;
	ANNOT_RE.lastIndex = 0;
	while ( (m = ANNOT_RE.exec(text)) ) {
		const b = m[1].match(BIN_RE);
		if ( !b ) return null;                                // non-binary / non-numeric expression
		const a = num(b[1]), op = b[2], c = num(b[3]), stated = num(m[2]);
		if ( !isFinite(a) || !isFinite(c) || !isFinite(stated) ) return null;
		const v = op === '+' ? a + c : op === '-' ? a - c : op === '*' ? a * c : (c === 0 ? NaN : a / c);
		if ( !isFinite(v) || !close(v, stated) ) return null; // the annotation LIES → reject
		shape.push(OP[op]);
		last = v;
	}
	if ( !shape.length || last == null || !close(last, goal) ) return null;   // the chain must LAND on ####
	return { shape, value: goal };
}

function loadClasses( o ) {
	o = o || {};
	const per = o.per || 3;
	const want = o.classes || null;                          // default: every class that survives the gold gate
	const rows = o.rows || fs.readFileSync((o.data || '/mnt/d/hf-stocks/gsm8k') + '/train.jsonl', 'utf8')
		.split('\n').filter(Boolean).map(( l ) => JSON.parse(l) );
	const byClass = {};
	for ( const it of rows ) {
		const g = parseGold(it.answer);
		if ( !g ) continue;                                  // gold gate: fail-closed
		const sig = g.shape.join('>');
		if ( want && want.indexOf(sig) < 0 ) continue;
		(byClass[sig] = byClass[sig] || []).push({ problem: it.question, goldSteps: g.shape, value: g.value });
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
	const txt = await ask({
		system: 'You decompose a math word problem into the ORDERED sequence of calculator ops that solves it. '
			+ 'Use ONLY these ops: ' + stepEnum.join(', ') + '. Each op combines two numbers (a prior step result may be reused).\n'
			+ 'Idioms: "half as many / split among N" -> divide · "altogether / total / combined" -> add · '
			+ '"more than / left / remaining" -> subtract · "each of N costs X / N times" -> multiply.\n'
			+ 'Emit the MINIMAL sequence. Reply ONLY the JSON object {"steps":[...]}.',
		user: String(rec.problem || ''),
		maxTokens: 160, temperature: o.temperature || 0,
		grammar: { jsonSchema: { type: 'object', properties: { steps: { type: 'array', minItems: 1, items: { type: 'string', enum: stepEnum } } }, required: ['steps'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return (JSON.parse(m ? m[0] : txt).steps || []).map(snap); }
	catch ( _e ) { return []; }
}

module.exports = { name: 'gsm8k', stepEnum, loadClasses, decompose, parseGold };
