'use strict';
/*
 * defab-l2-probe.js — G-EXT extension : DeFAb **Level-2 dev** (374 instances, 3 domaines — « identify the
 * missing observation » : le gold est l'UNIQUE candidat dont la tête unifie avec le target ; leur solveur
 * symbolique = 100 %, le frontier officiel claude-sonnet-4-6 = 77 % L2 et **19 % en modalité M1**
 * (rendering-robust) — summary.json du repo HF).
 *
 * SYS-symbolic = l'unification tête==target : **374/374 vérifié à 0 call** (le scan pré-enregistré).
 * Ici : les arms MODÈLE sur un ÉCHANTILLON stride (30 = 10/domaine, indices 0,10,20…) avec NOTRE rendering
 * (le code officiel `blanc` est 404 — renderings M1-M4 inaccessibles ; comparaison protocole-différent,
 * étiquetée) : DIRECT (le 27B choisit le candidat depuis la prose) vs SYS-extract (le 27B extrait
 * candidats+target VERBATIM → le même sélecteur typé) — la division extraction × sélection, mesurée sur
 * la cellule la plus PURE (zéro connaissance-monde, zéro chaînage : l'échec modèle = la discipline de
 * matching sous prose, pas le savoir).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const FILES = { biology: 'biology_dev_instances.json', legal: 'legal_dev_instances.json', materials: 'materials_dev_instances.json' };

const parseCand = ( c ) => { const m = String(c).match(/^\s*([\w()]+)\s*:\s*(.*?)\s*(~>|=>)\s*(.+?)\s*$/); return m && { label: m[1], head: m[4].trim(), raw: c }; };
const selectL2 = ( target, candidates ) => {
	const hits = candidates.map(parseCand).filter(( c ) => c && c.head === String(target).trim() );
	return hits.length === 1 ? hits[0].raw : null;
};

function renderProse( t ) {
	return 'A knowledge base is missing exactly one entry. Because of that gap, the statement "' + t.target
		+ '" cannot be derived. Exactly one of the following candidate entries fills the gap:\n'
		+ t.candidates.map(( c, i ) => '  (' + (i + 1) + ') ' + c ).join('\n');
}

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 8192 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const R = {};
	let symAll = 0, nAll = 0;
	for ( const [dom, f] of Object.entries(FILES) ) {
		const insts = require('./data/' + f).instances;
		for ( const t of insts ) { nAll++; if ( selectL2(t.target, t.candidates) === t.gold[0] ) symAll++; }   // full-set, 0 call
		const sample = insts.filter(( _, i ) => i % 10 === 0 ).slice(0, 10);                                  // stride sample
		const row = R[dom] = { n: sample.length, direct: 0, extract: 0 };
		for ( const t of sample ) {
			const prose = renderProse(t);
			// DIRECT — the model picks the candidate from the prose
			const d = String(await ask({ system: 'Reply ONLY the single candidate entry (copied exactly) that fills the gap.', user: prose, maxTokens: 48 }));
			if ( d.includes(t.gold[0].split(':')[0]) ) row.direct++;                                          // label echo
			// SYS-extract — the model extracts VERBATIM, the typed selector decides
			const ex = String(await ask({ system: 'Extract from the text, VERBATIM. Reply ONLY JSON: {"target":"<the underivable statement>","candidates":["<entry as written>", ...]}.', user: prose, maxTokens: 400 }));
			try {
				const m = ex.match(/\{[\s\S]*\}/);
				const x = JSON.parse(m ? m[0] : ex);
				if ( selectL2(x.target, x.candidates || []) === t.gold[0] ) row.extract++;
			} catch ( e ) {}
		}
	}

	console.log('══ G-EXT · DeFAb Level-2 dev (« missing observation ») ══');
	console.log('  SYS-symbolic (unification, 0 call, FULL SET) : ' + symAll + '/' + nAll);
	for ( const [dom, r] of Object.entries(R) )
		console.log(`  ${dom.padEnd(11)} échantillon n=${r.n}  DIRECT-27B ${r.direct}/${r.n}  SYS-extract ${r.extract}/${r.n}`);
	console.log('  (référence publiée, protocole ≠ : frontier L2 77 % · modalité M1 19 % · leur solveur 100 %)');
	fs.writeFileSync(path.join(__dirname, 'RESULTS-defab-l2' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify({ symAll, nAll, R }, null, 1));
	console.log('wrote RESULTS-defab-l2' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
