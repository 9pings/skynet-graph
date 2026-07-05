'use strict';
/*
 * rag-ontology-arm.js — le G5-RAG du plan papier : DIRECT **avec l'ontologie déclarée EN CONTEXTE**
 * (RAG-sur-ontologie) sur les MÊMES 54 tâches probe-2 (mêmes paraphrases memo-servies). L'arm qui répond
 * à l'objection « donnez juste le treillis au modèle » — et qui justifie (ou pas) le matcher déterministe.
 *
 * PRÉ-ENREGISTRÉ, les DEUX lectures utiles :
 *   - si RAG-DIRECT < SYS : le matcher est justifié sur la CORRECTION même à ontologie fournie (l'attendu
 *     sur V5-défaisable : le pattern-match traverse le modificateur — leçon V5h — et sur V3-fidélité) ;
 *   - si RAG-DIRECT ≈ SYS : le claim se recentre proprement sur ce que le contexte ne donne PAS —
 *     déterminisme/audit (K1), amortissement 0-call (RAG paie 1 call/épisode À VIE), apprenabilité
 *     localisée (ring/arêtes), refus typé garanti-par-construction vs probabiliste.
 *   Reporté cellule par cellule vs les colonnes SYS/DIRECT de RESULTS-2.json.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { DOMAINS, makeTasks, goldOf } = require('./riddle-probe-2.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';

// the DECLARED ontology rendered as context — everything the typed path knows, given to the model verbatim
function ontologyText( D ) {
	const isa = Object.entries(D.isa).filter(( [, p] ) => p ).map(( [k, p] ) => k + ' is-a ' + p ).join('; ');
	const defs = Object.entries(D.defeaters).map(( [c, cats] ) => `a ${c} object loses its "${cats.join('/')}" category (fits NO such hole)` ).join('; ');
	const holes = Object.entries(D.holeSort).map(( [w, c] ) => w + ' hole = category ' + c ).join('; ');
	return 'ONTOLOGY (authoritative — answer STRICTLY from it):\n- taxonomy: ' + isa + '.\n- holes: ' + holes + '.'
		+ (defs ? '\n- exceptions: ' + defs + '.' : '')
		+ '\n- rule: an object fits exactly the hole matching its lowest derivable category (and size if given); if none matches, answer none.';
}

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const tasks = [...makeTasks('shapes', DOMAINS.shapes, 6, 6), ...makeTasks('animals', DOMAINS.animals, 0, 6)];
	const R = {};
	for ( const t of tasks ) {
		const D = DOMAINS[t.domain];
		t.gold = goldOf(t, D);
		const rk = t.domain + '/' + t.v;
		const row = R[rk] = R[rk] || { n: 0, rag: 0, ragHallu: 0 };
		row.n++;
		const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
		const descs = t.holes.map(( h ) => (h.size ? h.size + ' ' : '') + h.cat );
		const d = String(await ask({ system: ontologyText(D) + '\nAnswer the puzzle with EXACTLY one of: ' + descs.join(' | ') + ' | none.', user: prose, maxTokens: 24 }))
			.toLowerCase().replace(/circular|circle|spherical/g, 'round').replace(/rectangular/g, 'square')
			.replace(/aquarium/g, 'aquatic').replace(/aviary/g, 'aerial').replace(/terrarium/g, 'terrestrial');
		const picks = t.holes.map(( h, i ) => [((h.size ? h.size + ' ' : '') + h.cat), i] ).filter(( [w] ) => d.includes(w) ).map(( [, i] ) => i );
		if ( t.gold == null ? d.includes('none') && !picks.length : (picks.length === 1 && picks[0] === t.gold) ) row.rag++;
		else if ( t.gold == null && picks.length ) row.ragHallu++;
	}

	console.log('══ G5-RAG : DIRECT + ontologie déclarée EN CONTEXTE (mêmes 54 tâches probe-2) ══');
	const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'RESULTS-2' + (process.env.OUT_SUFFIX || '') + '.json'), 'utf8'));
	for ( const [rk, r] of Object.entries(R) )
		console.log(`  ${rk.padEnd(30)} RAG ${r.rag}/${r.n}${r.ragHallu ? ' ⚠hallu ' + r.ragHallu : ''}   (DIRECT-nu: ${prev[rk].direct}/${prev[rk].n}${prev[rk].directHallu ? ' hallu ' + prev[rk].directHallu : ''} · SYS ${prev[rk].sys}/${prev[rk].n})`);
	fs.writeFileSync(path.join(__dirname, 'RESULTS-rag-ontology' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify(R, null, 1));
	console.log('wrote RESULTS-rag-ontology' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
