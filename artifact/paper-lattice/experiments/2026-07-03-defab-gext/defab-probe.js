'use strict';
/*
 * defab-probe.js — G-EXT du plan papier : courir le CHEMIN TYPÉ sur un benchmark EXTERNE à oracle
 * machine-vérifiable — DeFAb (Cooper & Velasquez 2026, arXiv 2606.18557 ; HF PatrickAllenCooper/DeFAb,
 * MIT). Tue l'objection « treillis jouet déclaré » : l'oracle est tiers, poly-time, hors de nous.
 *
 * DeFAb Level-3 = DEFEATER ABDUCTION — l'isomorphe EXACT de notre cellule défaisance/restriction :
 *   theory (facts + strict/defeasible rules) + anomaly (une dérivation par défaut qui NE doit PAS tenir
 *   pour un individu) + candidates (1 gold defeater + 5 distracteurs typés) → choisir le defeater qui
 *   (a) TIRE sur l'individu anormal [load-bearing — decideRingAdmission], (b) nie l'anomalie [bon head/
 *   polarité — le slot], (c) est CONSERVATIF (ne tue aucune preserved_expectation d'un AUTRE individu —
 *   notre garde-fou de vacuité / frein à la sur-généralisation), (d) est MINIMAL (la coupe-sort la plus
 *   serrée — le LGG au bon niveau du treillis). Les 5 types de distracteurs SONT nos discriminants :
 *   broad=sur-général (non-conservatif), wrong_head/irrelevant=mauvais slot, positive=mauvaise polarité,
 *   wrong_cond=condition non-établie (non load-bearing).
 *
 * ARMS (pré-enregistré) :
 *   SYS-symbolic : notre sélecteur DÉTERMINISTE sur la théorie DONNÉE (defeat ∧ conservativité ∧
 *     minimalité par le treillis d'entailment de la théorie). Attendu ~100 % — il DOIT égaler le solveur
 *     règles de DeFAb (100 %) : la preuve que notre logique de sélection est CORRECTE sur un oracle tiers,
 *     pas un jouet. (Un désaccord = un bug de notre sélecteur, à corriger — la micro-boucle.)
 *   DIRECT-rb0 / DIRECT-rbON : le modèle choisit un candidat depuis la théorie rendue en PROSE — reproduit
 *     leur chute frontier (65 %→plus bas) sur NOTRE appliance/modèle (le baseline #1 du verdict prior-art).
 *   SYS-extract : théorie rendue en PROSE → le modèle EXTRAIT les candidats (open-vocab) → canon → le
 *     MÊME sélecteur typé → vérifié vs gold. Le seul arm qui exerce notre contribution SOUS bruit
 *     d'extraction sur un oracle externe (la face « croissance sous extraction LLM bruitée »).
 *
 * Oracle = le `gold_label` de DeFAb (leur solveur poly-time l'a certifié — PAS notre gold, pas de
 * circularité). Memo durable partagé. K1 : les faits/candidats sont des littéraux typés, jamais de prose
 * sur une arête de dépendance.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const RB = Number(process.env.RB || 1024);
const DATA = require('./data/level3_instances.json');

// ── parse a labelled DeFAb rule "label: cond(X) ~>|=> [~]head(X)" ────────────────────────────────────────
function parseRule( s ) {
	const m = String(s).match(/^\s*([\w]+)\s*:\s*(.+?)\s*(~>|=>)\s*(.+?)\s*$/);
	if ( !m ) return null;
	const pred = ( side ) => { const neg = /^~/.test(side.trim()); const p = side.trim().replace(/^~\s*/, '').match(/^(\w+)\s*\(/); return { neg, pred: p ? p[1] : null }; };
	const b = pred(m[2]), h = pred(m[4]);
	return { label: m[1], type: m[3] === '~>' ? 'defeasible' : 'strict', condPred: b.pred, condNeg: b.neg, headPred: h.pred, headNeg: h.neg };
}
const parseFact = ( f ) => { const m = String(f).match(/^(\w+)\s*\(\s*(\w+)\s*\)/); return m ? { pred: m[1], ind: m[2] } : null; };
const parseAtom = ( a ) => { const neg = /^~/.test(String(a).trim()); const m = String(a).replace(/^~\s*/, '').match(/^(\w+)\s*\(\s*(\w+)\s*\)/); return m ? { neg, pred: m[1], ind: m[2] } : null; };

// the DECLARED isa/entailment reachability of the theory: which unary sorts hold for an individual, via the
// strict rules' cond→head closure over the facts (a poset — our concept-sort lattice, from the theory).
function sortsOf( ind, facts, rules ) {
	const have = new Set(facts.filter(( f ) => f && f.ind === ind ).map(( f ) => f.pred ));
	let changed = true;
	while ( changed ) { changed = false;
		for ( const r of rules ) if ( r.type === 'strict' && !r.headNeg && r.condPred && r.headPred && have.has(r.condPred) && !have.has(r.headPred) ) { have.add(r.headPred); changed = true; }
	}
	return have;
}

// ── the TYPED SELECTOR (our mechanism): pick the defeater that is load-bearing ∧ right-slot ∧ conservative
//    ∧ minimal — implementing DeFAb's OWN declared checks (valid derivation · conservativity · minimality,
//    with the abductive revision distance d_rev), through our gate's lenses: load-bearing =
//    decideRingAdmission, conservativity = the vacuity/over-generalization guard, minimality = the tightest
//    lattice cut, abductive cost = posited facts count (a rule-only hypothesis beats rule+posited-fact —
//    Occam on the revision). A NOVEL condition (predicate unknown to facts ∪ strict heads) is POSITABLE:
//    the hypothesis posits cond(anomalous_individual) — covering ONLY that individual (minimal abduction).
function selectDefeater( inst, candidates ) {
	const facts = inst.theory_facts.map(parseFact).filter(Boolean);
	const rules = inst.theory_rules.map(parseRule).filter(Boolean);
	const anom = parseAtom(inst.anomaly);                                     // e.g. flies(opus) — the default to defeat
	const individuals = [...new Set(facts.map(( f ) => f.ind ))];
	const preserved = (inst.preserved_expectations || []).map(parseAtom).filter(Boolean);
	const known = new Set(facts.map(( f ) => f.pred ));
	for ( const r of rules ) if ( r.type === 'strict' && !r.headNeg && r.headPred ) known.add(r.headPred);
	const parsed = candidates.map(( c ) => ({ raw: c, r: parseRule(c) })).filter(( c ) => c.r );

	const scored = [];
	for ( const { raw, r } of parsed ) {
		if ( r.type !== 'defeasible' || !r.headNeg ) continue;               // right SLOT + polarity: a negative defeasible rule
		if ( r.headPred !== anom.pred ) continue;                            //   whose head addresses the anomaly predicate
		const novel = !known.has(r.condPred);
		let covered, posits;
		if ( novel ) { covered = [anom.ind]; posits = 1; }                   // POSIT cond(anomalous) — minimal abduction
		else {
			if ( !sortsOf(anom.ind, facts, rules).has(r.condPred) ) continue; // LOAD-BEARING: must fire on the anomalous individual
			covered = individuals.filter(( ind ) => sortsOf(ind, facts, rules).has(r.condPred) );
			posits = 0;
		}
		// CONSERVATIVE: cond~>~head must not kill any preserved expectation of a covered individual
		const conservative = !preserved.some(( e ) => !e.neg && e.pred === r.headPred && covered.includes(e.ind) );
		if ( !conservative ) continue;
		scored.push({ raw, label: r.label, posits, coverage: covered.length });
	}
	if ( !scored.length ) return { status: 'impracticable' };
	scored.sort(( a, b ) => (a.posits - b.posits) || (a.coverage - b.coverage) );
	const tied = scored.filter(( s ) => s.posits === scored[0].posits && s.coverage === scored[0].coverage );
	if ( tied.length > 1 ) return { status: 'ambiguous', admissible: tied.map(( s ) => ({ label: s.label, raw: s.raw }) ) };
	return { status: 'selected', label: scored[0].label };
}
// AMBIGUOUS = two posited novel conditions are FORMALLY symmetric in the instance's own theory — the
// residual discriminant is WORLD knowledge (which novel predicate is the true mechanism). The layered
// doctrine: the gate does the LOGIC (validity/conservativity/minimality, 6→≤2), the model disambiguates
// INSIDE the verified-admissible set (deduction organ at the coverage frontier — the ratchet architecture).

// ── prose rendering (for the DIRECT + extract arms — the model never sees the symbolic form directly) ────
function renderProse( inst ) {
	const lines = [];
	lines.push('Facts: ' + inst.theory_facts.join(', ') + '.');
	lines.push('General rules (=> means "normally implies"): ' + inst.theory_rules.join('; ') + '.');
	lines.push('Observed anomaly (should NOT hold but the rules predict it): ' + inst.anomaly + '.');
	lines.push('We seek an exception rule (~> means "normally, with exceptions") that explains the anomaly by '
		+ 'overriding the wrong default, WITHOUT breaking unrelated expectations, as specific as possible.');
	return lines.join('\n');
}

module.exports = { parseRule, parseFact, parseAtom, sortsOf, selectDefeater, renderProse };

if ( require.main === module ) ( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw0 = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 8192 });
	const rawR = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: RB, seed: 0, contextSize: 8192 });
	const memoDir = path.join(__dirname, 'memo');
	const { ask: ask0 } = makeDurableAsk(raw0, { dir: memoDir, meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });
	const { ask: askR } = makeDurableAsk(rawR, { dir: memoDir, meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: RB } });

	const by = ( d ) => ({ n: 0, sysSym: 0, sysSymPure: 0, tiebreaks: 0, sysExt: 0, rb0: 0, rbON: 0 });
	const R = { all: by(), biology: by(), legal: by(), materials: by() };
	const bump = ( inst, k ) => { R.all[k]++; R[inst.domain][k]++; };
	const fails = { sysSym: [], sysExt: [] };
	// per-instance DIRECT pick typing (B-5: the §7.3 keystone must be machine-derivable from the artifact).
	// Distractor labels end with their benchmark-defined type; gold = exact gold_label match.
	const DTYPES = ['wrong_head', 'wrong_cond', 'wrong_action', 'wrong_prop', 'no_novel', 'near_gold', 'irrelevant', 'positive', 'broad', 'indirect'];
	const typeOf = ( label, inst ) => label == null ? 'no_pick' : label === inst.gold_label ? 'gold' : (DTYPES.find(( t ) => label.endsWith('_' + t) ) || 'other');
	const direct = {};

	// the model disambiguates INSIDE the gate's verified-admissible set (≤2 labels; no `description` — leak-safe)
	async function tiebreak( inst, admissible ) {
		const txt = await ask0({ system: 'Two exception rules are both formally admissible. Using general knowledge only,'
			+ ' pick the one whose condition is the TRUE mechanism explaining the anomaly. Reply ONLY the label.',
			user: 'Anomaly: ' + inst.anomaly + '\nCandidates:\n' + admissible.map(( a ) => a.raw ).join('\n'), maxTokens: 24 });
		const hit = admissible.filter(( a ) => new RegExp('\\b' + a.label + '\\b').test(String(txt)) );
		return hit.length === 1 ? hit[0].label : null;
	}

	for ( const inst of DATA.instances ) {
		R.all.n++; R[inst.domain].n++;
		const gold = inst.gold_label;
		const labels = inst.candidates.map(( c ) => (parseRule(c) || {}).label ).filter(Boolean);

		// SYS-symbolic — the deterministic selector on the GIVEN theory; ambiguous → model tie-break in-set
		const sym = selectDefeater(inst, inst.candidates);
		if ( sym.status === 'selected' ) {
			bump(inst, 'sysSymPure');
			if ( sym.label === gold ) bump(inst, 'sysSym'); else fails.sysSym.push(inst.name + ':wrong=' + sym.label);
		}
		else if ( sym.status === 'ambiguous' ) {
			bump(inst, 'tiebreaks');
			const pick = await tiebreak(inst, sym.admissible);
			if ( pick === gold ) bump(inst, 'sysSym'); else fails.sysSym.push(inst.name + ':tiebreak=' + pick);
		}
		else fails.sysSym.push(inst.name + ':' + sym.status);

		// DIRECT rb0 / rbON — pick a candidate label from the rendered prose
		const prose = renderProse(inst);
		direct[inst.name] = {};
		for ( const [arm, ask, mt] of [['rb0', ask0, 32], ['rbON', askR, 1600]] ) {
			const txt = String(await ask({ system: 'Pick the single best exception rule. Candidates:\n' + inst.candidates.join('\n')
				+ '\nReply ONLY the label (one of: ' + labels.join(', ') + ').', user: prose, maxTokens: mt }));
			const tail = arm === 'rbON' ? txt.slice(-120) : txt;
			const pick = labels.filter(( l ) => new RegExp('\\b' + l + '\\b').test(tail) );
			const chosen = pick.length ? pick[pick.length - 1] : null;
			direct[inst.name][arm] = { pick: chosen, type: typeOf(chosen, inst) };
			if ( chosen === gold ) bump(inst, arm);
		}

		// SYS-extract — the model EXTRACTS the candidate rules from prose (open-vocab), then OUR selector runs
		const ex = await ask0({ system: 'Extract each candidate exception rule as JSON. For the anomaly "' + inst.anomaly
			+ '", list the candidate rules. Reply ONLY JSON: {"candidates":["label: cond(X) ~> ~head(X)", ...]}.'
			+ ' Copy them EXACTLY as written below:\n' + inst.candidates.join('\n'), user: prose, maxTokens: 400 });
		let extracted = null; try { const m = String(ex).match(/\{[\s\S]*\}/); extracted = JSON.parse(m ? m[0] : ex).candidates; } catch ( e ) {}
		const extSel = Array.isArray(extracted) ? selectDefeater(inst, extracted) : { status: 'unparsed' };
		if ( extSel.status === 'selected' && extSel.label === gold ) bump(inst, 'sysExt');
		else if ( extSel.status === 'ambiguous' && (await tiebreak(inst, extSel.admissible)) === gold ) bump(inst, 'sysExt');
		else fails.sysExt.push(inst.name + ':' + extSel.status);
	}

	console.log('══ G-EXT · DeFAb Level-3 defeater abduction (N=' + R.all.n + ', oracle=DeFAb gold_label, tiers) ══');
	for ( const [dom, r] of Object.entries(R) )
		console.log(`  ${dom.padEnd(11)} n=${r.n}  SYS ${r.sysSym}/${r.n} (structurel-pur ${r.sysSymPure}, tiebreaks ${r.tiebreaks})  SYS-extract ${r.sysExt}/${r.n}  DIRECT-rb0 ${r.rb0}/${r.n}  DIRECT-rbON ${r.rbON}/${r.n}`);
	console.log('  SYS-sym misses:', fails.sysSym.join(' ') || 'none');
	console.log('  SYS-extract misses:', fails.sysExt.slice(0, 12).join(' ') || 'none');
	const dLoss = ( arm ) => Object.entries(direct).filter(( [, v] ) => v[arm] && v[arm].type !== 'gold' ).map(( [n, v] ) => n + ':' + v[arm].type );
	console.log('  DIRECT-rb0 losses (typed):', dLoss('rb0').join(' ') || 'none');
	console.log('  DIRECT-rbON losses (typed):', dLoss('rbON').join(' ') || 'none');
	fs.writeFileSync(path.join(__dirname, 'RESULTS-defab' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify({ rb: RB, R, fails, direct }, null, 1));
	console.log('wrote RESULTS-defab' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
