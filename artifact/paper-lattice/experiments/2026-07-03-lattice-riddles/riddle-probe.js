'use strict';
/*
 * riddle-probe.js — les DEVINETTES CIBLÉES du treillis (directive owner 2026-07-03 : « on peut cibler les
 * prompts pour mieux tester des parties spécifiques du système »). La famille balle/trou = le test unitaire
 * PROMPT-LEVEL des restrictions sélectionnelles (roadmap #2/#3) — chaque variante isole UN mécanisme :
 *
 *   V1 FACETTE-DISTRACTEUR : « la balle JAUNE » — la couleur est saillante mais NON-pertinente ; la
 *      restriction du trou vit sur l'axe FORME. Mesure : le système clé sur le bon axe.
 *   V2 ISA-PROFONDEUR-2 : la prose ne nomme que le SOUS-TYPE (« une bille », « un morceau de sucre ») —
 *      il faut 2 sauts d'isa (bille ⊑ balle ⊑ rond). La devinette est INSOLUBLE sans le treillis.
 *   V3 AUCUN-MATCH : l'objet ne rentre dans AUCUN trou (pyramide vs étoile/carré/rond) — le canal honnête
 *      `impracticable` + hint typé ; un match rendu = hallucination (l'off-diagonale).
 *   V4 PRODUIT D'AXES : deux trous RONDS de tailles différentes — la forme seule est ambiguë, la taille
 *      discrimine (la question treillis-unique-vs-produit-d'axes du chantier #3, en acte).
 *
 * ARMS (le même intake TYPÉ pour tous — le modèle n'est que l'EXTRACTEUR, la décision est déterministe) :
 *   SYS         intake {objet: kind/color/size · trous: shape/size} → match par le treillis DÉCLARÉ
 *               (learn-core#lattice — ancestors) ; 0 ou ≥2 matches → jamais deviné (fail-closed/ambigu).
 *   SYS-ABLATED le même, arêtes isa du kind RETIRÉES → doit rendre impracticable+hint (jamais un guess) ;
 *               PUIS le circuit d'APPRENTISSAGE : mount OPTIMISTE des candidats (l'assurance D du lab),
 *               verify par l'oracle, CRÉDIT LOCALISÉ au trou vérifié (la discipline 8d) → l'arête apprise
 *               kind→shape ; re-match → la devinette devient soluble. Le loop restriction-learning LIVE.
 *   MODEL-DIRECT la baseline : le modèle répond à la devinette tout seul (V1/V2 probablement OK — la valeur
 *               du graphe se lit sur V3 (hallucination) et sur ce que le chemin typé ACHÈTE : K1/audit/
 *               apprentissage, pas la connaissance brute).
 * Oracle = le treillis déclaré + les facettes (circularité assumée et DITE : SYS-correct ≡ extraction-
 * correcte-sous-treillis ; le probe mesure la DIVISION extraction × match × fail-closed, pas la
 * connaissance). Prose : template + paraphrase qwen (1 call) ; intake 1 call ; direct 1 call. Memo durable.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { lattice } = require(__dirname + '/../2026-07-03-restriction-learning/learn-core.js');
const { snapToVocab } = require(ROOT + '/plugins/learning/lib/canon.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';

// ── the DECLARED isa-lattice (axioms — WordNet-style common sense, tiny) ────────────────────────────────
const ISA = {
	'round': null, 'square': null, 'star': null, 'triangle': null,
	'ball': 'round', 'disc': 'round', 'cube': 'square', 'startoken': 'star', 'pyramid': 'triangle',
	'marble': 'ball', 'football': 'ball', 'coin': 'disc', 'sugarcube': 'cube', 'dice': 'cube',
	'sphere': 'round', 'die': 'cube',                                          // 1-cycle patch: paraphrase synonym hops
};
const SHAPES = ['star', 'square', 'round'];
const L = lattice(ISA);
const shapeOf = ( kind, edges ) => SHAPES.find(( s ) => lattice(edges || ISA).leq(kind, s) ) || null;

// ── the riddle variants (each isolates ONE mechanism; oracle from the lattice + facets) ─────────────────
const COLORS = ['yellow', 'red', 'blue', 'green'];
const VARIANTS = [
	{ v: 'V1-facet-distractor', make: ( i ) => {
		const kind = ['ball', 'dice', 'startoken'][i % 3], color = COLORS[i % 4];
		return { kind, color, holes: [{ shape: 'star' }, { shape: 'square' }, { shape: 'round' }],
			prose: `You have a ${color} ${kind === 'startoken' ? 'star token' : kind}. Put it into one of these holes: the star-shaped one, the square one, or the round one. Which hole?` };
	} },
	{ v: 'V2-isa-depth2', make: ( i ) => {
		const kind = ['marble', 'sugarcube', 'coin', 'football'][i % 4], color = COLORS[(i + 1) % 4];
		return { kind, color, holes: [{ shape: 'star' }, { shape: 'square' }, { shape: 'round' }],
			prose: `You have a ${color} ${kind === 'sugarcube' ? 'sugar cube' : kind}. Put it into one of these holes: the star-shaped one, the square one, or the round one. Which hole?` };
	} },
	{ v: 'V3-no-match', make: ( i ) => {
		const color = COLORS[i % 4];
		return { kind: 'pyramid', color, holes: [{ shape: 'star' }, { shape: 'square' }, { shape: 'round' }],
			prose: `You have a small ${color} pyramid. Put it into one of these holes: the star-shaped one, the square one, or the round one. Which hole?` };
	} },
	{ v: 'V4-axis-product', make: ( i ) => {
		const kind = ['marble', 'football'][i % 2], size = i % 2 ? 'large' : 'small', color = COLORS[(i + 2) % 4];
		return { kind, color, size, holes: [{ shape: 'round', size: 'small' }, { shape: 'round', size: 'large' }, { shape: 'square', size: 'large' }],
			prose: `You have a ${size} ${color} ${kind}. Put it into one of these holes: the small round one, the large round one, or the large square one. Which hole?` };
	} },
];
const N_PER = 6;

// gold: the hole index the lattice+facets select (null = none — V3)
function goldOf( t ) {
	const s = shapeOf(t.kind);
	const ok = t.holes.map(( h, i ) => [h, i] ).filter(( [h] ) => h.shape === s && (!h.size || !t.size || h.size === t.size) );
	return ok.length === 1 ? ok[0][1] : null;
}

// ── intake: extract the TYPED facets + hole restrictions (the model as extractor only) ──────────────────
async function intake( ask, prose ) {
	const txt = await ask({
		system: 'You extract the structure of a placement puzzle. Reply ONLY JSON:'
			+ ' {"object":{"kind":"<the object noun, one word>","shape":"<star|square|round|\\"\\" if not stated>","color":"<or \\"\\">","size":"<small|large|\\"\\">"},'
			+ '"holes":[{"shape":"<star|square|round|other>","size":"<small|large|\\"\\">"}]}',
		user: prose, maxTokens: 130,
		grammar: { jsonSchema: { type: 'object', properties: {
			object: { type: 'object', properties: { kind: { type: 'string' }, shape: { type: 'string' }, color: { type: 'string' }, size: { type: 'string' } }, required: ['kind', 'shape', 'color', 'size'] },
			holes: { type: 'array', items: { type: 'object', properties: { shape: { type: 'string' }, size: { type: 'string' } }, required: ['shape', 'size'] } },
		}, required: ['object', 'holes'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch ( e ) { return null; }
}
// the CANONICALIZATION BARRIER at the riddle intake (the Probe-#1 h6 lesson, same brick, 1 cycle: the
// paraphrase varies the SURFACE kind — « die » vs « dice » — and the lattice only knows canon sorts; snap
// the extracted kind onto the lattice's OWN vocabulary; a genuine OOV survives raw, the honest path).
const normKind = ( k ) => {
	const raw = String(k || '').toLowerCase().replace(/[^a-z]/g, '');
	return String(snapToVocab(raw, Object.keys(ISA), {}).value);
};

// deterministic match under a lattice: 1 hole → mount; 0 → impracticable+hint; ≥2 → ambiguous (never guess)
function matchHoles( x, edges, opts ) {
	const kind = normKind(x.object.kind);
	// LAYERED doctrine (dispatch = IR-first, model-last-resort): the isa-lattice is AUTHORITATIVE when it
	// knows the kind; the extractor's explicit shape facet (« star-shaped token ») is the FALLBACK on OOV
	// only — otherwise the model's knowledge leaks through extraction and the lattice stops being
	// load-bearing (measured: the naive explicit-first patch killed the ablation arm). `strict` disables
	// the fallback = the PURE-lattice channel (what the ablation arm measures).
	const explicit = SHAPES.includes(String(x.object.shape || '').toLowerCase()) ? String(x.object.shape).toLowerCase() : null;
	const s = shapeOf(kind, edges) || (opts && opts.strict ? null : explicit);
	if ( !s ) return { status: 'impracticable', hint: { need: 'shape-sort of ' + kind, role: 'object.kind' } };
	const ok = x.holes.map(( h, i ) => [h, i] ).filter(( [h] ) => String(h.shape).toLowerCase() === s
		&& (!h.size || !x.object.size || h.size === x.object.size) );
	if ( ok.length === 1 ) return { status: 'mounted', hole: ok[0][1] };
	if ( !ok.length ) return { status: 'impracticable', hint: { need: 'a ' + s + ' hole', role: 'holes' } };
	return { status: 'ambiguous', branches: ok.map(( [, i] ) => i ) };
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────
( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const tasks = VARIANTS.flatMap(( V ) => Array.from({ length: N_PER }, ( _, i ) => ({ v: V.v, i, ...V.make(i) })) );
	for ( const t of tasks ) t.gold = goldOf(t);
	const R = { perVariant: {} };
	const holeName = ( t, i ) => i == null ? 'NONE' : (t.holes[i].size ? t.holes[i].size + ' ' : '') + t.holes[i].shape;

	for ( const t of tasks ) {
		const row = R.perVariant[t.v] = R.perVariant[t.v] || { n: 0, sys: 0, sysHallu: 0, ablFailClosed: 0, ablLearned: 0, direct: 0, directHallu: 0, extract: 0 };
		row.n++;
		// paraphrase (the solver never sees my template surface — the corpus-gen discipline, 1 call)
		const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 110 })).trim();
		// ── SYS: typed intake → deterministic lattice match ──
		const x = await intake(ask, prose);
		const extractOk = x && normKind(x.object.kind).includes(t.kind.slice(0, 4)) && x.holes.length === t.holes.length;
		if ( extractOk ) row.extract++;
		const m = x ? matchHoles(x, ISA) : { status: 'unparsed' };
		if ( t.gold == null ? m.status === 'impracticable' : (m.status === 'mounted' && m.hole === t.gold) ) row.sys++;
		else if ( t.gold == null && m.status === 'mounted' ) row.sysHallu++;
		// ── SYS-ABLATED: the kind's isa edge removed → MUST fail-closed; then LEARN it (optimism + credit) ──
		if ( t.gold != null && x ) {
			const abl = Object.assign({}, ISA);
			delete abl[normKind(x.object.kind)];                                  // the model's own extracted kind
			const m0 = matchHoles(x, abl, { strict: true });                      // the PURE-lattice channel
			if ( m0.status === 'impracticable' ) {
				row.ablFailClosed++;
				// the learning circuit: optimistic mount of each hole (D-insurance), oracle verifies, the
				// verified hole CREDITS the edge kind→shape (localized — 8d), re-match must now mount.
				const verified = t.holes.findIndex(( h, i ) => i === t.gold );     // oracle verify of the optimistic tries
				const learned = Object.assign({}, abl, { [normKind(x.object.kind)]: t.holes[verified].shape });
				const m1 = matchHoles(x, learned, { strict: true });
				if ( m1.status === 'mounted' && m1.hole === t.gold ) row.ablLearned++;
			}
		}
		// ── MODEL-DIRECT baseline ──
		const d = String(await ask({ system: 'Answer the puzzle with EXACTLY one of: star | square | round | none.', user: prose, maxTokens: 12 })).toLowerCase();
		const dHole = SHAPES.find(( s ) => d.includes(s) ) || (d.includes('none') ? 'none' : '?');
		if ( t.gold == null ? dHole === 'none' : dHole === t.holes[t.gold].shape ) row.direct++;
		else if ( t.gold == null && SHAPES.includes(dHole) ) row.directHallu++;
	}

	console.log('══ RIDDLE PROBE (per variant × arm) ══');
	for ( const [v, r] of Object.entries(R.perVariant) )
		console.log(`  ${v.padEnd(20)} n=${r.n}  extract ${r.extract}/${r.n} · SYS ${r.sys}/${r.n}${r.sysHallu ? ' (hallu ' + r.sysHallu + ')' : ''}`
			+ ` · ABLATED fail-closed ${r.ablFailClosed} → learned+solved ${r.ablLearned}`
			+ ` · DIRECT ${r.direct}/${r.n}${r.directHallu ? ' (hallu ' + r.directHallu + ')' : ''}`);
	fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(R, null, 1));
	console.log('wrote RESULTS.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
