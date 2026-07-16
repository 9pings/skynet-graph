'use strict';
/*
 * live-discover-2.js — le RUNG-2 de la découverte autonome de frame : le CÂBLAGE de la conclusion
 * d'architecture du rung-1 (LOG §rung-live) — le décompose fournit la SHAPE (stable post-canon), l'INTAKE
 * fournit les PARAMS (20/20 au Probe #1), la découverte = shape canon-foldée + params placés par rôle aux
 * positions aggregate. Chaque pièce est certifiée séparément ; ce script mesure la COMPOSITION.
 *
 * PROTOCOLE PRÉ-ENREGISTRÉ (gates imprimés avant tout verdict) :
 *   G0 — LÉGITIMITÉ DU FOLD : les folds ne sont PAS déclarés — ils sont minés du corpus RUN-8 déjà capturé
 *        (diag-freq.log) et admis par compress.js#foldSubpaths, l'objectif MDL ΔL du GO kill-gate lui-même
 *        (l'affinité = gain MDL sur digrams observés), sous DEUX contraintes déclarées : a ≠ b (plier la
 *        répétition effacerait des SLOTS) et fact-safety (a ∈ factKinds ⇒ b ∈ factKinds — un fold ne doit
 *        jamais effacer une position porteuse de faits). Attendu : exactement (filter→aggregate).
 *        [v1 de ce gate — un test « le fold mappe une variante observée sur une autre » — était trop strict :
 *        la variance de granularité co-occurre avec la variance de QUEUE dans ce dump (le finding RUN-8) ;
 *        l'admission MDL est le critère déjà validé, pas un critère inventé. Méthode critique §3, 1 cycle.]
 *   G2 — DISJONCTION : épisodes de découverte (t7, t9) ∩ seed de déclaration Probe-#1 (t6, t8) = ∅ ; valeurs
 *        de params des épisodes mutuellement disjointes (golds utilisés en GATE, jamais en entrée de la
 *        composition).
 *   G1a — STABILITÉ DE SHAPE : par épisode, decompose(prose) et decompose(proseGen) doivent avoir la MÊME
 *        shape post-canon (kinds seuls — les facts du décompose ne sont PAS requis : la leçon du rung-1).
 *        Instable ⇒ verdict « seam cassé », JAMAIS « frame indécouvrable » (Laurie 7).
 *   G1b — CONSISTANCE DES PARAMS : par épisode, intake(prose) et intake(proseGen), post value-snap (brique
 *        canon), doivent coïncider exactement OU modulo le swap commutatif DÉCLARÉ (compare = argmax) ;
 *        sinon ⇒ verdict « param seam unstable » (fail-closed). Le primaire = intake(prose).
 *   PLACEMENT (déclaré avant le run) : la shape canon doit contenir exactement 2 steps aggregate ; ils
 *        reçoivent (a, b) dans l'ordre de mention. Toute autre shape ⇒ « placement-impossible » (honnête).
 *   G3 — PRÉ-REPORT VERBATIM du frame découvert AVANT comparaison au frame déclaré du Probe #1.
 *
 * AUTONOMIE : la trace composée ne consomme QUE des sorties du modèle (shapes + params d'intake) — les golds
 * n'apparaissent que dans les gates (G2) et le report post-hoc (score d'extraction, transparence).
 * Scope : frame-EXISTENCE (positions/rôles des slots) — le niveau de restriction reste au lab déterministe.
 * Spend : ~8 calls (2 épisodes × 2 phrasings × (decompose + intake)). GPU sandbox-off, memo run-scoped RUN-4
 * (déterminisme in-process ; le cross-process n'est pas bit-garanti — caveat rung-1).
 */
const fs = require('fs');
const path = require('path');
const E2E = path.resolve(__dirname, '../2026-07-02-e2e-fidelity');
const PR = path.resolve(__dirname, '../2026-07-03-parametric-reuse');
const ROOT = path.resolve(__dirname, '../../../..');
const { makeTypedDecomposeProviders } = require(ROOT + '/lib/authoring/core/typed-loop.js');
const { foldSubpaths } = require(ROOT + '/lib/authoring/learning/compress.js');
const { makeStructuralCanon, snapToVocab, shapeKey } = require(ROOT + '/lib/authoring/learning/canon.js');
const { seedMethod, slotBindings } = require(PR + '/mechanics.js');
console.info = console.warn = () => {};

const CORPUS = JSON.parse(fs.readFileSync(E2E + '/corpus/tasks.json', 'utf8'));
const DATA = JSON.parse(fs.readFileSync(E2E + '/corpus/data.json', 'utf8'));
const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const STEP_KINDS = CORPUS.stepKindEnum;
const SCHEMA = 'invoices(id, client, amount, status) and tickets(id, priority, topic)';
const PARAM_KEYS = ['aField', 'aValue', 'bField', 'bValue'];
const EPISODE_IDS = ['t7', 't9'];
const SEED_IDS = ['t6', 't8'];
const taskOf = ( id ) => CORPUS.splits.train.find(( t ) => t.id === id );

// ── G0: the folds are MINED from the system's own captured corpus, admitted by the lib's MDL objective ──
const FACT_KINDS = ['filter', 'aggregate'];
function minedFolds() {
	const text = fs.readFileSync(E2E + '/diag-freq.log', 'utf8');
	const reClass = /^\s+([A-Za-z]\w*):\s+count=(\d+)/;
	const reShape = /^\s*×(\d+)\s+\[(\d+)\]\s+(.*)$/;
	const entries = [];
	let cls = null;
	for ( const raw of text.split('\n') ) {
		const mC = raw.match(reClass);
		if ( mC ) { cls = mC[1]; continue; }
		const mS = raw.match(reShape);
		if ( mS && cls ) { try { entries.push({ cls, mult: Number(mS[1]), tree: JSON.parse(mS[3]) }); } catch ( e ) {} }
	}
	// MDL admission (foldSubpaths = the GO-gate ΔL objective) + the two declared constraints:
	// a≠b (folding repetition erases slots) · fact-safety (a ∈ factKinds ⇒ b ∈ factKinds).
	const FK = new Set(FACT_KINDS);
	const { subpaths } = foldSubpaths(entries, { minSupport: 2 });
	const folds = subpaths.filter(( s ) => s.admitted && s.a !== s.b && (!FK.has(s.a) || FK.has(s.b)) )
		.map(( s ) => ({ a: s.a, b: s.b, into: s.b, dl: Math.round(s.dl.delta * 10) / 10, support: s.support }) );
	return { folds, candidates: subpaths.length, entries: entries.length };
}

// ── the model (embedded, run-scoped memo — the RUN-4 determinism pattern) ───────────────────────────────
function makeAsk() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const memo = new Map();
	return async ( o ) => {
		const k = JSON.stringify([o.system, o.user, o.maxTokens, o.grammar && o.grammar.jsonSchema]);
		if ( memo.has(k) ) return memo.get(k);
		const r = await raw(o);
		memo.set(k, r);
		return r;
	};
}

const COLUMNS = ['id', 'client', 'amount', 'status', 'priority', 'topic'];
const snapField = ( f ) => COLUMNS.find(( c ) => String(f || '').toLowerCase().includes(c)) || String(f || '');

// the SHAPE face (decompose) — same prompt as rung-1 (prompt-only at the structural touchpoint, RUN-2 rule)
async function decompose( ask, prose ) {
	const txt = await ask({
		system: 'You break a data request into an ORDERED list of sub-steps. Use ONLY these kinds: ' + STEP_KINDS.join(', ')
			+ '. For each step that filters or aggregates over a specific column value, include "field" (the column) and'
			+ ' "value" (the value, exactly as in the request). Mark atomic:false ONLY if that sub-step needs further breakdown.'
			+ ' Reply ONLY JSON: {"steps":[{"kind":"...","atomic":true|false,"field":"...","value":"..."}]}.',
		user: 'Request: ' + prose + '\nData schema: ' + SCHEMA, maxTokens: 300,
	});
	try {
		const m = String(txt).match(/\{[\s\S]*\}/);
		return (JSON.parse(m ? m[0] : txt).steps || []).map(( s ) => ({
			stepKind: String(s.kind || '').toLowerCase(), atomic: s.atomic !== false,
			field: s.field ? snapField(s.field) : undefined, value: s.value != null ? String(s.value) : undefined }));
	} catch ( e ) { return null; }
}

// the PARAMS face (intake) — the Probe-#1 extraction prompt (schema given, NO corpus values named)
async function intake( ask, prose ) {
	const txt = await ask({
		system: 'You extract the structure of a data request. The data schema is: ' + SCHEMA + '.'
			+ ' Reply ONLY JSON: {"kind":"<one of ' + CORPUS.taskKindEnum.join('|') + '>",'
			+ '"a":{"field":"<column>","value":"<the first group/filter value in the request, exactly as written>"},'
			+ '"b":{"field":"<column>","value":"<the second group/filter value, or \\"\\" if the request has only one>"}}',
		user: prose, maxTokens: 120,
		grammar: { jsonSchema: { type: 'object', properties: {
			kind: { type: 'string', enum: CORPUS.taskKindEnum },
			a: { type: 'object', properties: { field: { type: 'string' }, value: { type: 'string' } }, required: ['field', 'value'] },
			b: { type: 'object', properties: { field: { type: 'string' }, value: { type: 'string' } }, required: ['field', 'value'] },
		}, required: ['kind', 'a', 'b'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch ( e ) { return null; }
}

// the intake canon barrier, via the brick: snap each extracted value onto ITS field's data column vocabulary
const ROWS = [].concat(...Object.values(DATA).map(( d ) => [].concat(...Object.values(d)) ));
const fieldVocab = ( field ) => [...new Set(ROWS.map(( r ) => r[field] ).filter(( v ) => typeof v === 'string' ))];
function snapExtraction( x, stats ) {
	if ( !x ) return x;
	const out = { kind: x.kind, a: x.a, b: x.b };
	for ( const side of ['a', 'b'] ) if ( out[side] && out[side].value ) {
		const f = snapField(out[side].field);
		out[side] = { field: f, value: snapToVocab(out[side].value, fieldVocab(f), stats).value };
	}
	return out;
}
const paramSig = ( s ) => s ? String(s.field).toLowerCase() + '=' + String(s.value).toLowerCase() : '∅';
const sameParams = ( x, y ) => x && y && paramSig(x.a) === paramSig(y.a) && paramSig(x.b) === paramSig(y.b);
const swapParams = ( x, y ) => x && y && paramSig(x.a) === paramSig(y.b) && paramSig(x.b) === paramSig(y.a);

( async function main() {
	const results = { model: path.basename(MODEL_PATH), protocol: 'rung-2 (shape × params by role)' };

	// ── G0 (deterministic, before any spend) ──
	const g0 = minedFolds();
	console.log('G0 — folds MINED from the RUN-8 captured corpus (' + g0.entries + ' shape variants, '
		+ g0.candidates + ' digram candidates):');
	console.log('     admitted by the MDL ΔL objective + a≠b + fact-safety: ' + JSON.stringify(g0.folds));
	if ( !g0.folds.length ) { console.log('⇒ VERDICT: no learned fold — the canon has no legitimate rewrite; stopping.'); process.exit(0); }
	results.folds = g0.folds;
	const DATA_VOCAB = [].concat(...Object.values(DATA).map(( d ) => [].concat(...Object.values(d)) ))
		.flatMap(( r ) => Object.values(r).filter(( v ) => typeof v === 'string' ));
	const canon = makeStructuralCanon({ factKeys: ['field', 'value'], factKinds: FACT_KINDS,
		vocab: DATA_VOCAB, folds: g0.folds });

	// ── G2 ──
	for ( const id of EPISODE_IDS ) if ( SEED_IDS.includes(id) ) { console.error('G2 FAILED: episode ' + id + ' in the declaration seed'); process.exit(1); }
	const eps = EPISODE_IDS.map(taskOf);
	const vals = eps.map(( t ) => [t.intent.a.is, t.intent.b.is] );
	if ( vals[0].some(( v ) => vals[1].includes(v)) ) { console.error('G2 FAILED: episode param values overlap'); process.exit(1); }
	console.log('G2 PASS — episodes ' + EPISODE_IDS + ' ⟂ seed ' + SEED_IDS + ', values mutually disjoint ' + JSON.stringify(vals));
	if ( process.env.DRY ) { console.log('DRY run — stopping before the model load.'); process.exit(0); }

	const ask = makeAsk();

	// ── per episode: G1a (shape) + G1b (params), then the composed trace inputs ──
	const composed = {};
	results.episodes = {};
	for ( const t of eps ) {
		const d1 = canon(await decompose(ask, t.prose)), d2 = canon(await decompose(ask, t.proseGen));
		const shapeStable = d1 && d2 && shapeKey(d1) === shapeKey(d2);
		console.log(`G1a ${t.id}: post-canon shape ${shapeStable ? 'STABLE' : 'UNSTABLE'} — ${shapeKey(d1)} vs ${shapeKey(d2)}`);
		const snapStats = { kept: 0, snapped: 0, oov: 0 };
		const x1 = snapExtraction(await intake(ask, t.prose), snapStats);
		const x2 = snapExtraction(await intake(ask, t.proseGen), snapStats);
		const paramsOk = sameParams(x1, x2) ? 'exact' : swapParams(x1, x2) ? 'swap' : 'unstable';
		console.log(`G1b ${t.id}: params ${paramsOk} — a=${paramSig(x1 && x1.a)} b=${paramSig(x1 && x1.b)} (snap ${JSON.stringify(snapStats)})`);
		// transparency report (never an input): extraction vs gold
		const gold = { a: { field: t.intent.a.field, value: t.intent.a.is }, b: { field: t.intent.b.field, value: t.intent.b.is } };
		const extOk = x1 && paramSig(x1.a) === paramSig(gold.a) && paramSig(x1.b) === paramSig(gold.b);
		results.episodes[t.id] = { shapeStable, paramsOk, extraction: extOk ? 'exact-vs-gold' : 'differs-vs-gold', snapStats };
		if ( !shapeStable ) { finish('seam-unstable', 'G1a: the decompose shape diverges across phrasings on ' + t.id); return; }
		if ( paramsOk === 'unstable' ) { finish('param-seam-unstable', 'G1b: the intake params diverge across phrasings on ' + t.id); return; }
		// PLACEMENT (declared): exactly 2 aggregate steps receive (a, b) in order of mention
		const aggIdx = d1.map(( s, i ) => s.stepKind === 'aggregate' ? i : -1 ).filter(( i ) => i >= 0 );
		if ( aggIdx.length !== 2 ) { finish('placement-impossible', 'shape holds ' + aggIdx.length + ' aggregate steps (declared placement needs 2) on ' + t.id); return; }
		const steps = d1.map(( s ) => ({ stepKind: s.stepKind, atomic: true }));                 // model shape, facts placed below
		steps[aggIdx[0]] = Object.assign({}, steps[aggIdx[0]], { field: x1.a.field, value: x1.a.value });
		steps[aggIdx[1]] = Object.assign({}, steps[aggIdx[1]], { field: x1.b.field, value: x1.b.value });
		composed[t.id] = { steps, params: x1 };
	}

	// ── DISCOVERY: the composed traces crystallize through the SAME path as Probe #1 / the self-test ──
	const counters = { eval: 0, expand: 0, answer: 0 };
	const byId = Object.fromEntries(eps.map(( t ) => ['D_' + t.id, t] ));
	const { candidate, gen, error } = await seedMethod({
		paramKeys: PARAM_KEYS,
		seed: { lastRev: 0, nodes: eps.flatMap(( t, i ) => [{ _id: 'S' + i }, { _id: 'G' + i }] ),
			segments: eps.map(( t, i ) => { const p = composed[t.id].params;                     // INTAKE params — never golds
				return { _id: 'D_' + t.id, originNode: 'S' + i, targetNode: 'G' + i, stepKind: 'compare',
					aField: p.a.field, aValue: p.a.value, bField: p.b.field, bValue: p.b.value }; } ) },
		providers: makeTypedDecomposeProviders({
			stepKinds: { enum: STEP_KINDS }, maxDepth: 2, stepFacts: ['field', 'value'],
			evalFn: () => { counters.eval++; return { atomic: false }; },
			expandFn: ( s ) => { counters.expand++; return composed[byId[s._._id].id].steps; },  // the model's shape, params placed
			answerFn: () => { counters.answer++; return 'leaf'; },
		}),
	});
	if ( error ) { finish('not-admitted', 'crystallization refused — ' + error); return; }
	const slots = slotBindings(gen);

	// ── G3: VERBATIM pre-report BEFORE any comparison ──
	console.log('\n══ THE DISCOVERED FRAME (verbatim, pre-comparison — G3) ══');
	console.log('  LGG stable: ' + gen.stable + ' · slots: ' + JSON.stringify(slots.map(( s ) => s.role + '.' + s.key )));
	console.log('  templates: ' + Object.keys(candidate.templatesBySig || {}).length + ' sig-classes · signatureKeys: ' + JSON.stringify(candidate.signatureKeys));

	const declared = ['aggregate#0.field', 'aggregate#0.value', 'aggregate#1.field', 'aggregate#1.value'];
	const found = slots.map(( s ) => s.role + '.' + s.key ).sort();
	const match = JSON.stringify(found) === JSON.stringify(declared.slice().sort());
	console.log('\n⇒ VERDICT: ' + (match
		? 'FRAME DISCOVERED ≡ DECLARED — shape (decompose, post-canon) × params (intake) placed by role: the'
			+ ' system induced, from its OWN live emissions only, the 4 role-typed slots Probe #1 declared.'
		: 'FRAME DISCOVERED ≠ DECLARED — reported verbatim above (' + JSON.stringify({ found, declared }) + ')'));
	console.log('   structural spend: eval ' + counters.eval + ' · expand ' + counters.expand + ' (first-derivation price — justified seeds)');
	results.found = found; results.declared = declared; results.counters = counters;
	finish(match ? 'discovered-equal' : 'discovered-different');

	function finish( verdict, msg ) {
		if ( msg ) console.log('\n⇒ VERDICT: ' + verdict + ' — ' + msg + (verdict.includes('seam') ? ' (Laurie G1: a SEAM verdict, never « frame undiscoverable »)' : ''));
		results.verdict = verdict;
		fs.writeFileSync(path.join(__dirname, 'RESULTS-discover-2.json'), JSON.stringify(results, null, 2));
		process.exit(0);
	}
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
