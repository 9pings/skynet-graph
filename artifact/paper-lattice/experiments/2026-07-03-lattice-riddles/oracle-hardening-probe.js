'use strict';
/*
 * oracle-hardening-probe.js — le G1a du plan papier : DURCIR les oracles V3/V5 (aucune échappatoire
 * plausible-monde) AVANT tout claim externe. Le finding à répondre : les « hallucinations » V3 du modèle
 * pensant sont des réponses PLAUSIBLES-MONDE violant la spec (pyramide→carré : base carrée ! fougère→
 * terrarium : elles y vivent !), et le gold=none du V5 dégonflé est contestable (une balle dégonflée SE
 * FOURRE dans un trou rond).
 *
 * PROTOCOLE PRÉ-ENREGISTRÉ (3 familles durcies, 3 arms — SYS / DIRECT-rb0 / DIRECT-rbON) :
 *   V3h-shapes  : pyramide vs {étoile, rond} — l'échappatoire CARRÉ RETIRÉE du choice-set → gold none
 *                 INCONTESTABLE (une pyramide ne rentre plausiblement ni dans l'étoile ni dans le rond).
 *   V3h-animals : fougère vs {aquarium, volière} — le TERRARIUM RETIRÉ → gold none incontestable.
 *   V5h-remap   : « deflated ball/football » vs {le rond, la FENTE PLATE} — le défaiseur REMAPPE au lieu
 *                 d'annuler : deflated: round→flat → gold = la fente (POSITIF, le monde et la spec
 *                 D'ACCORD — une balle dégonflée/plate passe par une fente). Teste rétraction + RE-
 *                 DÉRIVATION (la face remount de la défaisance), plus seulement le refus. + bénins
 *                 (damp/wet/shiny) en contrôle de vacuité du remap (gold = rond : pas de remap bénin).
 *
 * ATTENDUS PRÉ-ENREGISTRÉS :
 *   - V3h : SYS none 6/6 ×2 domaines ; les « hallu » rbON doivent S'EFFONDRER vs V3 original (l'escape
 *     était la cause) — toute désignation de trou restante = une VRAIE hallucination spec-indépendante,
 *     reportée telle quelle. rb0 : pattern-match none probable (comme avant).
 *   - V5h : SYS rétracte+remappe → fente 6/6 · bénins → rond 3/3 (vacuité) ; DIRECT (les 2 régimes)
 *     répondra PLAUSIBLEMENT fente aussi — ces cellules mesurent la FIDÉLITÉ DE MÉCANISME sur un gold
 *     incontestable, pas un gain vs modèle : reporté tel quel (8a).
 *   - Les claims papier V3/V5 s'assoient sur les cellules durcies ; les originales restent reportées
 *     comme spec-relatives (le claim gouvernance/fidélité-spec, G1a).
 *   Survie du modificateur à la paraphrase comptée (G5). Memo durable partagé, même canal de paraphrase.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { DOMAINS, intake, normWord } = require('./riddle-probe-2.js');
const { lattice } = require(ROOT + '/doc/WIP/experiments/2026-07-03-restriction-learning/learn-core.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const RB = Number(process.env.RB || 1024);
const COLORS = ['yellow', 'red', 'blue', 'green'];

// ── the HARDENED families (experiment-local domain variants; the remap = the harness face of the system's
//    defeasible re-derivation — retract the defeated cat, re-derive through the remap edge, remount) ─────
const FAM = {
	'V3h-shapes': {
		isa: DOMAINS.shapes.isa, cats: ['star', 'round'],                     // the SQUARE escape is REMOVED
		holeSort: { star: 'star', round: 'round' },
		catEnum: 'star|round|other', defeaters: {}, remap: {},
		holes: [{ w: 'star-shaped one', cat: 'star' }, { w: 'round one', cat: 'round' }],
		eps: [0, 1, 2, 3, 4, 5].map(( i ) => ({ kind: 'pyramid', surf: 'pyramid', color: COLORS[i % 4], gold: null }) ),
		norm: ( s ) => s.replace(/circular|circle|spherical/g, 'round'),
	},
	'V3h-animals': {
		isa: DOMAINS.animals.isa, cats: ['aquatic', 'aerial'],                // the TERRARIUM escape is REMOVED
		holeSort: { aquarium: 'aquatic', aviary: 'aerial' },
		catEnum: 'aquarium|aviary|other', defeaters: {}, remap: {},
		holes: [{ w: 'aquarium', cat: 'aquatic' }, { w: 'aviary', cat: 'aerial' }],
		holesPhrase: 'enclosures',
		eps: [0, 1, 2, 3, 4, 5].map(( i ) => ({ kind: 'fern', surf: 'fern', color: COLORS[(i + 1) % 4], gold: null }) ),
		norm: ( s ) => s.replace(/aquarium/g, 'aquatic').replace(/aviary/g, 'aerial'),
	},
	'V5h-remap': {
		// [critique 1 cycle : la paraphrase réécrit « flat slot »→« RECTANGULAR slot » (même référent, SAME
		//  facts) → la fente devenait irrésoluble → 5 SYS wrong. Le 5e axe du phénomène 4-axes, sur un mot
		//  de domaine NEUF — à volume c'est le ring G4 qui l'apprend ; ici l'alias est AUTORÉ (concern =
		//  durcissement d'oracle, pas apprentissage de ring — dit et séparé).]
		isa: Object.assign({}, DOMAINS.shapes.isa, { flat: null, rectangular: 'flat' }), cats: ['round', 'flat'],
		holeSort: { round: 'round', flat: 'flat', slot: 'flat', slit: 'flat' },
		catEnum: 'round|flat|other', defeaters: { deflated: ['round'] },
		remap: { deflated: { round: 'flat' } },                               // the defeater RE-DERIVES, not just retracts
		holes: [{ w: 'round one', cat: 'round' }, { w: 'flat slot', cat: 'flat' }],
		eps: [0, 1, 2, 3, 4, 5].map(( i ) => ({ kind: i % 2 ? 'football' : 'ball', surf: i % 2 ? 'football' : 'ball',
			cond: 'deflated', color: COLORS[i % 4], gold: 1 }) )              // gold = the FLAT SLOT (positive, incontestable)
			.concat([0, 1, 2].map(( i ) => ({ kind: 'ball', surf: 'ball', cond: ['damp', 'wet', 'shiny'][i],
				color: COLORS[(i + 2) % 4], gold: 0 }) )),                    // benign → ROUND (the remap vacuity guard)
		norm: ( s ) => s.replace(/circular|circle|spherical/g, 'round').replace(/\bslot\b|\bslit\b/g, 'flat'),
	},
};
for ( const F of Object.values(FAM) )
	for ( const t of F.eps )
		t.prose = `You have a ${t.cond ? t.cond + ' ' : ''}${t.color} ${t.surf}. Put it into one of these ${F.holesPhrase || 'holes'}: `
			+ F.holes.map(( h, k ) => (k === F.holes.length - 1 ? 'or the ' : 'the ') + h.w ).join(', ') + '. Which one?';

// SYS matcher with the REMAP semantics (layered doctrine + defeat → re-derive through the remap edge)
function matchHardened( x, F ) {
	const L = lattice(F.isa);
	const kind = normWord(x.object.kind, Object.keys(F.isa));
	let cat = F.cats.find(( c ) => L.leq(kind, c) ) || null;
	const explicit = F.cats.includes(String(x.object.category || '').toLowerCase()) ? String(x.object.category).toLowerCase() : null;
	if ( !cat && !Object.keys(F.isa).includes(kind) ) cat = explicit;   // §3 P4: explicit facet is an OOV-only fallback; in-vocab kind w/o derived cat fails closed

	const cond = normWord(x.object.condition, Object.keys(F.defeaters));
	if ( cat && (F.defeaters[cond] || []).includes(cat) )
		cat = (F.remap[cond] || {})[cat] || null;                             // retract + RE-DERIVE (remap), else none
	if ( !cat ) return { status: 'impracticable' };
	const holeCat = ( h ) => { const w = normWord(h.name, Object.keys(F.isa).concat(Object.keys(F.holeSort))); return F.holeSort[w] || F.cats.find(( c ) => L.leq(w, c) ) || null; };
	const ok = x.holes.map(( h, i ) => [h, i] ).filter(( [h] ) => holeCat(h) === cat );
	return ok.length === 1 ? { status: 'mounted', hole: ok[0][1] } : { status: 'impracticable' };
}

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw0 = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const rawR = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: RB, seed: 0, contextSize: 4096 });
	const memoDir = path.join(__dirname, 'memo');
	const { ask: ask0 } = makeDurableAsk(raw0, { dir: memoDir, meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });
	const { ask: askR } = makeDurableAsk(rawR, { dir: memoDir, meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: RB } });

	const R = {};
	for ( const [fam, F] of Object.entries(FAM) ) {
		const row = R[fam] = { n: 0, sys: 0, sysWrong: 0, rb0: 0, rb0Hallu: 0, rbON: 0, rbONHallu: 0, condSeen: 0, attrition: 0 };
		const D = { catEnum: F.catEnum };                                     // intake() reads catEnum only
		for ( const t of F.eps ) {
			row.n++;
			const prose = String(await ask0({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
			// SYS — the typed path (closed intake, layered doctrine, defeat→remap)
			const x = await intake(( o ) => ask0(o), prose, D);
			// cond-survival = a non-empty EXTRACTED condition (the surface word may legitimately synonym-hop)
			if ( t.cond ) { if ( x && String(x.object.condition || '').trim() ) row.condSeen++; else row.attrition++; }
			const m = x ? matchHardened(x, F) : { status: 'unparsed' };
			if ( t.gold == null ? m.status === 'impracticable' : (m.status === 'mounted' && m.hole === t.gold) ) row.sys++;
			else row.sysWrong++;
			// DIRECT rb0 + rbON — same enumerated real descriptions, alias-normalized, thinking-tail judged
			const descs = F.holes.map(( h ) => h.w );
			for ( const [arm, ask, mt] of [['rb0', ask0, 24], ['rbON', askR, 1600]] ) {
				const d = String(await ask({ system: 'Answer the puzzle with EXACTLY one of: ' + descs.join(' | ') + ' | none.', user: prose, maxTokens: mt })).toLowerCase();
				const tail = arm === 'rbON' ? d.slice(-80) : d;
				// raw verbatim-echo match first (the enum IS the surface); alias-normalized fallback if nothing matched
				let picks = F.holes.map(( h, i ) => [h.w.toLowerCase(), i] ).filter(( [w] ) => tail.includes(w) ).map(( [, i] ) => i );
				if ( !picks.length && !tail.includes('none') )
					picks = F.holes.map(( h, i ) => [F.norm(h.w.toLowerCase()), i] ).filter(( [w] ) => F.norm(tail).includes(w) ).map(( [, i] ) => i );
				if ( t.gold == null ? (tail.includes('none') && !picks.length) : (picks.length === 1 && picks[0] === t.gold) ) row[arm]++;
				else if ( t.gold == null && picks.length ) row[arm + 'Hallu']++;
			}
		}
	}

	console.log('══ ORACLES DURCIS (V3h sans échappatoire · V5h remap positif) — SYS / rb0 / rbON ══');
	for ( const [fam, r] of Object.entries(R) )
		console.log(`  ${fam.padEnd(14)} n=${r.n}  SYS ${r.sys}/${r.n}${r.sysWrong ? ' (wrong ' + r.sysWrong + ')' : ''}`
			+ `  rb0 ${r.rb0}/${r.n}${r.rb0Hallu ? ' ⚠hallu ' + r.rb0Hallu : ''}  rbON ${r.rbON}/${r.n}${r.rbONHallu ? ' ⚠hallu ' + r.rbONHallu : ''}`
			+ `${r.condSeen || r.attrition ? '  cond-survie ' + r.condSeen + '/' + (r.condSeen + r.attrition) : ''}`);
	fs.writeFileSync(path.join(__dirname, 'RESULTS-oracle-hardening' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify({ rb: RB, R }, null, 1));
	console.log('wrote RESULTS-oracle-hardening' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
