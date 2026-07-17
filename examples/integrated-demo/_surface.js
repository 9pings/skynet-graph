'use strict';
/*
 * _surface — la surface ASSISTANT (les lanes MCP réelles) câblée sur le stock forgé + la mission.
 *
 * `analyze` = LE gate déterministe, une seule source de vérité (gate.check ET la construction de la méthode
 * admise) : programme → exec (calculette adapter, inchangée) → forme ∈ référentiel gelé → PROVENANCE (chaque
 * littéral mappé à sa cellule ; introuvable = refus typé `opérande-non-résolvable`, distinct du refus forme —
 * confront fix #3/#5). Ce que le gate GARANTIT : forme certifiée + nombres tracés à leur cellule + calcul
 * déterministe. Ce qu'il ne garantit PAS (et ne prétend pas) : le choix de la bonne cellule (confront fix #1).
 * La négociation (options énumérées) ne porte QUE sur la forme ; le refus args est binaire, sans options.
 */
const crypto = require('crypto');
const fs = require('fs');
const NRG = require('path').join(__dirname, '..', '..');    // le repo lui-même (fusion NRG→skynet-graph faite)
const A = require(NRG + '/examples/forge-adapters/finqa.js');
const { tableNumbers } = require('./_data.js');

const progOf = ( steps ) => steps.map(( s ) => s.op + '(' + s.a + (s.b != null && s.b !== '' ? ', ' + s.b : '') + ')' ).join(', ');

/** analyze(steps, table, certified) → {ok, shape, value, program, methodSteps} | {ok:false, kind, blame} */
function analyze( steps, table, certified ) {
	if ( !steps || !steps.length ) return { ok: false, kind: 'no-exec', blame: 'empty emission' };
	const program = progOf(steps);
	const r = A.execProgram(program, table);
	if ( !r ) return { ok: false, kind: 'no-exec', blame: 'program not executable (invalid op/args)', program };
	const shape = r.shape.join('>');
	if ( certified.indexOf(shape) < 0 )
		return { ok: false, kind: 'shape', blame: 'shape "' + shape + '" ∉ frozen referential (' + certified.length + ' certified shapes)', program, shape };
	// provenance : chaque littéral doit provenir d'une cellule de LA table (sinon = nombre inventé possible)
	const nums = tableNumbers(table);
	const methodSteps = [];
	for ( const s of steps ) {
		const args = [];
		for ( const raw of [s.a, s.b] ) {
			if ( raw == null || raw === '' ) continue;
			const str = String(raw).trim();
			if ( /^#\d+$/.test(str) ) { args.push({ k: Number(str.slice(1)) }); continue; }
			const v = Number(str.replace(/[,$%]/g, ''));
			if ( !isFinite(v) ) return { ok: false, kind: 'args', blame: 'operand "' + str + '" neither number nor #ref', program, shape };
			const hit = nums.get(v);
			if ( !hit ) return { ok: false, kind: 'args', blame: 'operand ' + v + ' not found in the table (not resolvable — invented number?)', program, shape };
			args.push(hit.ambiguous ? { v, ambiguous: true } : { cell: { r: hit.row, c: hit.col }, label: hit.label });
		}
		methodSteps.push({ op: s.op, args });
	}
	return { ok: true, shape, value: r.value, program, methodSteps };
}

/**
 * createWiring({ certified, tableOf, mission, forcedLog }) → le `w` de defaultTools (hints/gate/state/plan).
 * `mission` peut être posé APRÈS coup (setMission) — l'acte 2 admet avant de construire le graphe.
 */
function createWiring( o ) {
	const wiring = {
		hints: { certifiedShapes: o.certified.slice() },
		gate: {
			check: ( p ) => {
				if ( p && p.steps ) {
					const a = analyze(p.steps, o.tableOf(p.stepId), o.certified);
					wiring.lastAnalyze = a;
					return a.ok ? { ok: true } : { ok: false, blame: a.blame };
				}
				// candidat de FORME (l'énumération d'options du propose) : membership du référentiel gelé
				return o.certified.indexOf(p && p.shape) >= 0 ? { ok: true }
					: { ok: false, blame: 'shape "' + (p && p.shape) + '" ∉ frozen referential' };
			},
			optionsOf: ( p ) => {
				// négociation SUR LA FORME uniquement ; un refus args est binaire → aucune option (refus honnête)
				if ( p && p.steps ) {
					const a = analyze(p.steps, o.tableOf(p.stepId), o.certified);
					if ( !a.ok && a.kind === 'args' ) return [];
				}
				return o.certified.map(( shape ) => ({ shape }));
			},
			record: ( p, meta ) => o.forcedLog.push({ proposal: p, meta }),
		},
		state: {
			recall: async () => {
				if ( !wiring.mission ) return { facts: {}, note: 'mission not materialized yet' };
				const facts = wiring.mission.facts();
				const bounded = {};
				for ( const [ id, f ] of Object.entries(facts) ) bounded[id] = f.cast ? { value: f.value, status: 'admitted-derived' } : { status: 'retracted/open' };
				return { facts: bounded, constats: wiring.mission.constats().length };
			},
		},
		plan: { snapshot: () => wiring.mission ? wiring.mission.snapshotPlan()
			: { steps: (wiring.prePlan || []).map(( s ) => ({ id: s.id, title: s.title, needs: s.needs || [], status: 'open' })) } },
		setMission: ( m ) => { wiring.mission = m; },
		setPrePlan: ( p ) => { wiring.prePlan = p; },
	};
	return wiring;
}

/** l'émission Q2 : programme complet {op,a,b}* sous grammaire, menu certifié (oriented) ou libre (raw). */
async function emitProgram( ask, rec, menu, feedback ) {
	const tbl = rec.table.map(( r ) => r.join(' | ') ).join('\n').slice(0, 1200);
	const argSchema = { type: 'string', maxLength: 24 };
	const out = await ask({
		system: 'You solve a financial question over a table by emitting the ORDERED calculator program. Ops: '
			+ A.stepEnum.join(', ') + '.\n'
			+ 'Each step = {"op": ..., "a": ..., "b": ...}: a/b are NUMBERS copied EXACTLY from the table (no commas/$/%), or "#K" = the result of step K (0-based). greater compares a>b.\n'
			+ 'Emit the MINIMAL program that computes the answer.'
			+ (menu ? ' In this domain the op sequences ALWAYS follow ONE of these certified shapes: [' + menu.join('  |  ') + ']. Pick the fitting shape and emit exactly its steps.' : '')
			+ (feedback ? '\nYour previous program was REFUSED: ' + feedback + ' Revise accordingly; if no certified shape genuinely fits the question, emit {"steps":[]}.' : '')
			+ ' Reply ONLY JSON {"steps":[{"op":...,"a":...,"b":...}, ...]}.',
		user: 'Table:\n' + tbl + '\nQuestion: ' + rec.problem,
		maxTokens: 220, temperature: 0,
		grammar: { jsonSchema: { type: 'object', properties: { steps: { type: 'array', maxItems: 4, items: {
			type: 'object', properties: { op: { type: 'string', enum: A.stepEnum }, a: argSchema, b: argSchema }, required: ['op', 'a'] } } }, required: ['steps'] } },
	});
	try { const m = String(out).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : out).steps || []; }
	catch ( _e ) { return []; }
}

const sha256 = ( file ) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * buildVerdictChecks(sig) → the 7 pre-registered GO/NO-GO bars (DESIGN), each DERIVED from a run signal
 * that can actually take the failing value — no bar is a constant of the script. The negative controls
 * (each bar shown red on its failure shape) are pinned by tests/unit/integrated-demo-checks.test.js.
 */
function buildVerdictChecks( sig ) {
	const admittedIds = new Set((sig.admitted || []).map(( m ) => m.stepId ));
	const methodOf = ( id ) => (sig.methods || []).find(( m ) => m.stepId === id );
	// the SAME gate discipline, re-run on what the synthesis displays: shape ∈ frozen referential + every
	// operand a table cell / a step ref / a composition input / an ambiguous-FLAGGED table literal — a bare
	// unflagged literal is exactly the "invented number" the gate exists to keep out.
	const regate = ( m ) => !!m && sig.certifiedPlus.indexOf(m.steps.map(( s ) => s.op ).join('>')) >= 0
		&& m.steps.every(( s ) => (s.args || []).every(( a ) => a.cell || a.input || a.k != null || (a.v != null && a.ambiguous) ));
	return [
		['4 acts in one run', ['ACT 1', 'ACT 2', 'ACT 3', 'ACT 4'].every(( a ) => (sig.actsSeen || []).indexOf(a) >= 0 )],
		['0 ungated results in the synthesis (every shown value re-passes shape+provenance NOW, backed by an MCP admission)',
			(sig.rows || []).every(( r ) => r.status !== 'certified-shape'
				|| ((r.step === 'cmp' || admittedIds.has(r.step)) && regate(methodOf(r.step))) )],
		['trap never silently admitted (no certified trap fact, no trap admission; force = recorded-untrusted + journal-traced)',
			!(sig.trapFact && sig.trapFact.cast) && !admittedIds.has('trap')
			&& (!sig.trapForce || (sig.trapForce.status === 'recorded-untrusted' && sig.trapForce.certified === false && (sig.forcedLog || []).length >= 1))],
		['drift-A: 0-call re-derivation + selectivity', sig.driftA.calls === 0 && sig.driftA.refired > 0 && sig.driftA.refired < sig.driftA.total],
		['drift-B: REOPEN emitted with the reason', (sig.reopens || []).length >= 1 && sig.reopens.every(( o ) => !!o.reason )],
		['bit-identical replay at 0 calls', sig.replay.same === true && sig.replay.calls === 0],
		['corrupted checkpoint rejected fail-closed', sig.corrupted.rejected === 1],
	];
}

module.exports = { analyze, createWiring, emitProgram, progOf, sha256, buildVerdictChecks };
