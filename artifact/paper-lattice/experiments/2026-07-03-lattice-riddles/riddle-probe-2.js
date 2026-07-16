'use strict';
/*
 * riddle-probe-2.js — la CONSTANCE et la DÉFAISANCE (directives owner, 2e passe) :
 *
 *   (a) RE-TEST à instances FRAÎCHES du domaine balle/trou (i=6..11 — de nouveaux tirages ; un re-run nu
 *       serait memo-tautologique, dit et évité) ;
 *   (b) TRANSPOSITION : la même structure V1-V4 sur une surface toute autre — ANIMAUX/ENCLOS
 *       (aquarium/volière/terrarium ; isa : truite ⊑ poisson ⊑ aquatique) — si les nombres tiennent sur les
 *       deux domaines ET les instances fraîches, la constance est démontrée ;
 *   (c) V5 DÉFAISABLE (« la balle dégonflée ») : un MODIFICATEUR défait l'arête isa par défaut
 *       (deflated ⊘ round · melted ⊘ square) → gold = AUCUN trou. GARDE-FOU DE VACUITÉ obligatoire :
 *       des modificateurs BÉNINS (wet/shiny/brand-new) en contrôle — le mécanisme doit DISCRIMINER
 *       défaiseur vs bénin, pas apprendre « modificateur ⇒ none ». Oracle = défaiseurs DÉCLARÉS (le probe
 *       mesure le MÉCANISME extraction-du-modificateur → défaite → rétractation, pas la vérité-monde —
 *       assumé et dit). La curiosité owner : DIRECT pattern-matche-t-il « balle → rond » malgré le
 *       modificateur ?
 *
 * Mêmes arms que le probe-1 (SYS typé / ABLATED strict+apprentissage / DIRECT), même doctrine en couches
 * (isa autoritaire, facette explicite = fallback OOV, canon-snap à l'intake), memo durable partagé.
 * La survie du modificateur à la paraphrase est comptée (une paraphrase qui perd « dégonflée » rend la
 * tâche insoluble pour TOUT le monde — comptée à part, jamais silencieuse).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { lattice } = require(__dirname + '/../2026-07-03-restriction-learning/learn-core.js');
const { snapToVocab } = require(ROOT + '/lib/authoring/learning/canon.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const COLORS = ['yellow', 'red', 'blue', 'green'];

// ── the two DOMAINS (same probe machinery, different surface + axioms — the transposition) ──────────────
const DOMAINS = {
	shapes: {
		isa: { round: null, square: null, star: null, triangle: null,
			ball: 'round', disc: 'round', cube: 'square', startoken: 'star', pyramid: 'triangle',
			marble: 'ball', football: 'ball', coin: 'disc', sugarcube: 'cube', dice: 'cube',
			sphere: 'round', die: 'cube',
			circular: 'round', circle: 'round', spherical: 'round', rectangular: 'square' },   // RING aliases —
			// the paraphrase synonym-hops sort words on BOTH sides (die/dice, round/circular); hole names
			// resolve through the SAME isa/ring path as kinds (one resolution road for every sort word)
		cats: ['star', 'square', 'round'],
		holeSort: { star: 'star', square: 'square', round: 'round' },
		holeWord: ( h ) => (h.size ? h.size + ' ' : '') + (h.cat === 'star' ? 'star-shaped' : h.cat) + ' one',
		holesPhrase: 'holes', catEnum: 'star|square|round|other',
		surface: { ball: 'ball', dice: 'dice', startoken: 'star token', marble: 'marble', sugarcube: 'sugar cube', coin: 'coin', football: 'football', pyramid: 'pyramid' },
		v1Kinds: ['ball', 'dice', 'startoken'], v2Kinds: ['marble', 'sugarcube', 'coin', 'football'],
		v3Kind: 'pyramid', v4Kinds: ['marble', 'football'], v4Cat: 'round', v4AltCat: 'square',
		defeaters: { deflated: ['round'], melted: ['square'] },
		v5: [{ kind: 'football', cond: 'deflated' }, { kind: 'ball', cond: 'deflated' }, { kind: 'sugarcube', cond: 'melted' }],
		v5Benign: ['wet', 'shiny', 'brand-new'],
	},
	animals: {
		isa: { aquatic: null, aerial: null, terrestrial: null,
			fish: 'aquatic', bird: 'aerial', reptile: 'terrestrial',
			trout: 'fish', salmon: 'fish', shark: 'fish', sparrow: 'bird', falcon: 'bird', parrot: 'bird',
			gecko: 'reptile', iguana: 'reptile', tortoise: 'reptile', fern: 'plant', plant: null },
		cats: ['aquatic', 'aerial', 'terrestrial'],
		holeSort: { aquarium: 'aquatic', aviary: 'aerial', terrarium: 'terrestrial' },
		holeWord: ( h ) => (h.size ? h.size + ' ' : '') + { aquatic: 'aquarium', aerial: 'aviary', terrestrial: 'terrarium' }[h.cat],
		holesPhrase: 'enclosures', catEnum: 'aquarium|aviary|terrarium|other',
		surface: { fish: 'fish', bird: 'bird', reptile: 'reptile', trout: 'trout', sparrow: 'sparrow', gecko: 'gecko', shark: 'shark', fern: 'fern' },
		v1Kinds: ['fish', 'bird', 'reptile'], v2Kinds: ['trout', 'sparrow', 'gecko', 'shark'],
		v3Kind: 'fern', v4Kinds: ['trout', 'shark'], v4Cat: 'aquatic', v4AltCat: 'terrestrial',
		defeaters: {}, v5: [], v5Benign: [],
	},
};

// ── variants (domain-parameterized; iOff = fresh-instance offset for the re-test) ───────────────────────
function makeTasks( dname, D, iOff, nPer ) {
	const holes3 = () => D.cats.map(( c ) => ({ cat: c }) );
	const tasks = [];
	const push = ( v, i, t ) => tasks.push(Object.assign({ domain: dname, v, i }, t));
	for ( let j = 0; j < nPer; j++ ) {
		const i = iOff + j;
		push('V1-facet-distractor', i, { kind: D.v1Kinds[i % D.v1Kinds.length], color: COLORS[i % 4], holes: holes3() });
		push('V2-isa-depth2', i, { kind: D.v2Kinds[i % D.v2Kinds.length], color: COLORS[(i + 1) % 4], holes: holes3() });
		push('V3-no-match', i, { kind: D.v3Kind, color: COLORS[i % 4], holes: holes3() });
		const sz = i % 2 ? 'large' : 'small';
		push('V4-axis-product', i, { kind: D.v4Kinds[i % D.v4Kinds.length], color: COLORS[(i + 2) % 4], size: sz,
			holes: [{ cat: D.v4Cat, size: 'small' }, { cat: D.v4Cat, size: 'large' }, { cat: D.v4AltCat, size: 'large' }] });
	}
	for ( let j = 0; j < D.v5.length * 2 && D.v5.length; j++ ) {                 // V5: defeater + benign control, paired
		const spec = D.v5[j % D.v5.length];
		const benign = j >= D.v5.length;
		push('V5-' + (benign ? 'benign-mod' : 'defeasible'), j,
			{ kind: spec.kind, color: COLORS[j % 4], cond: benign ? D.v5Benign[j % D.v5Benign.length] : spec.cond, holes: holes3() });
	}
	for ( const t of tasks ) {
		const surf = D.surface[t.kind] || t.kind;
		t.prose = `You have a ${t.size ? t.size + ' ' : ''}${t.cond ? t.cond + ' ' : ''}${t.color} ${surf}. Put it into one of these ${D.holesPhrase}: `
			+ t.holes.map(( h, k ) => (k === t.holes.length - 1 ? 'or the ' : 'the ') + D.holeWord(h) ).join(', ') + '. Which one?';
	}
	return tasks;
}

// gold under the DECLARED axioms + defeaters
function goldOf( t, D ) {
	const L = lattice(D.isa);
	let cat = D.cats.find(( c ) => L.leq(t.kind, c) ) || null;
	if ( cat && t.cond && (D.defeaters[t.cond] || []).includes(cat) ) cat = null;   // the defeater retracts the default
	if ( !cat ) return null;
	const ok = t.holes.map(( h, i ) => [h, i] ).filter(( [h] ) => h.cat === cat && (!h.size || !t.size || h.size === t.size) );
	return ok.length === 1 ? ok[0][1] : null;
}

// ── intake (domain-worded; + the condition/state facet for V5) ──────────────────────────────────────────
async function intake( ask, prose, D ) {
	const txt = await ask({
		system: 'You extract the structure of a placement puzzle. Reply ONLY JSON:'
			+ ' {"object":{"kind":"<' + (D.kindHint || 'the object/creature noun, one word') + '>","category":"<' + D.catEnum.replace('|other', '') + '|\\"\\" if not directly stated>",'
			+ '"condition":"<the object\'s state/condition adjective (e.g. deflated, wet), or \\"\\">","color":"<or \\"\\">","size":"<small|large|\\"\\">"},'
			+ '"holes":[{"name":"<' + D.catEnum + '>","size":"<small|large|\\"\\">"}]}',
		user: prose, maxTokens: 170,
		grammar: { jsonSchema: { type: 'object', properties: {
			object: { type: 'object', properties: { kind: { type: 'string' }, category: { type: 'string' }, condition: { type: 'string' }, color: { type: 'string' }, size: { type: 'string' } },
				required: ['kind', 'category', 'condition', 'color', 'size'] },
			holes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, size: { type: 'string' } }, required: ['name', 'size'] } },
		}, required: ['object', 'holes'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch ( e ) { return null; }
}

const normWord = ( k, vocab ) => String(snapToVocab(String(k || '').toLowerCase().replace(/[^a-z-]/g, '').replace(/-/g, ''), vocab, {}).value);

// deterministic match: layered doctrine (isa authoritative · explicit = OOV fallback · strict = pure lattice)
// + DEFEASANCE: a declared defeater on the object's condition RETRACTS the derived category (never a guess).
function matchHoles( x, D, edges, opts ) {
	const kind = normWord(x.object.kind, Object.keys(D.isa));
	const L = lattice(edges || D.isa);
	const derived = D.cats.find(( c ) => L.leq(kind, c) ) || null;
	const explicit = D.cats.includes(String(x.object.category || '').toLowerCase()) ? String(x.object.category).toLowerCase() : null;
	// DOCTRINE (§3 P4): the isa path is authoritative for IN-VOCAB kinds; the explicit facet is a fallback ONLY for
	// OOV kinds. An in-vocab kind whose isa path yields no category (e.g. pyramid ⊑ triangle ∉ {star,square,round})
	// must fail closed — NOT borrow the model's world-plausible explicit category (pyramid→"square"), which leaked
	// wrong mounts on every non-Qwen extractor (gemma/phi fill category="square"; Qwen left it ""). One-line guard.
	const kindOOV = !Object.keys(D.isa).includes(kind);
	let cat = derived || (opts && opts.strict ? null : (kindOOV ? explicit : null));
	const cond = normWord(x.object.condition, Object.keys(D.defeaters));
	if ( cat && (D.defeaters[cond] || []).includes(cat) )
		return { status: 'impracticable', hint: { defeated: cat, by: cond, role: 'object.condition' } };
	if ( !cat ) return { status: 'impracticable', hint: { need: 'category of ' + kind, role: 'object.kind' } };
	const holeCat = ( h ) => {
		const w = normWord(h.name, Object.keys(D.isa).concat(Object.keys(D.holeSort)));
		return D.holeSort[w] || D.cats.find(( c ) => L.leq(w, c) ) || null;       // holeSort direct, else the isa/ring road
	};
	const ok = x.holes.map(( h, i ) => [h, i] ).filter(( [h] ) => holeCat(h) === cat
		&& (!h.size || !x.object.size || h.size === x.object.size) );
	if ( ok.length === 1 ) return { status: 'mounted', hole: ok[0][1] };
	if ( !ok.length ) return { status: 'impracticable', hint: { need: 'a ' + cat + ' ' + D.holesPhrase.slice(0, -1), role: 'holes' } };
	return { status: 'ambiguous', branches: ok.map(( [, i] ) => i ) };
}

module.exports = { DOMAINS, makeTasks, goldOf, intake, matchHoles, normWord };

if ( require.main === module ) ( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const tasks = [
		...makeTasks('shapes', DOMAINS.shapes, 6, 6),                            // FRESH instances (the re-test)
		...makeTasks('animals', DOMAINS.animals, 0, 6),                          // the TRANSPOSITION
	];
	const R = {};
	for ( const t of tasks ) {
		const D = DOMAINS[t.domain];
		t.gold = goldOf(t, D);
		const rk = t.domain + '/' + t.v;
		const row = R[rk] = R[rk] || { n: 0, sys: 0, sysHallu: 0, ablFC: 0, ablLearn: 0, ablN: 0, direct: 0, directHallu: 0, condSeen: 0 };
		row.n++;
		const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
		const x = await intake(ask, prose, D);
		if ( t.cond && x && normWord(x.object.condition, Object.keys(D.defeaters).concat(DOMAINS.shapes.v5Benign)) ) row.condSeen++;
		const m = x ? matchHoles(x, D) : { status: 'unparsed' };
		if ( t.gold == null ? m.status === 'impracticable' : (m.status === 'mounted' && m.hole === t.gold) ) row.sys++;
		else if ( t.gold == null && m.status === 'mounted' ) row.sysHallu++;
		// ABLATED (pure lattice) + the learning circuit — mountable golds only
		if ( t.gold != null && x ) {
			row.ablN++;
			const abl = Object.assign({}, D.isa);
			delete abl[normWord(x.object.kind, Object.keys(D.isa))];
			const m0 = matchHoles(x, D, abl, { strict: true });
			if ( m0.status === 'impracticable' ) {
				row.ablFC++;
				const learned = Object.assign({}, abl, { [normWord(x.object.kind, Object.keys(D.isa))]: t.holes[t.gold].cat });
				const m1 = matchHoles(x, D, learned, { strict: true });
				if ( m1.status === 'mounted' && m1.hole === t.gold ) row.ablLearn++;
			}
		}
		// DIRECT baseline — the reply enum = the ACTUAL hole descriptions (V4 has TWO round holes: the shape
		// word alone cannot express the answer — the run-1 scorer was too generous, the naive run-2 one too
		// harsh); replies alias-normalized (circular→round) before matching.
		const descs = t.holes.map(( h ) => (h.size ? h.size + ' ' : '') + h.cat );
		const d = String(await ask({ system: 'Answer the puzzle with EXACTLY one of: ' + descs.join(' | ') + ' | none.', user: prose, maxTokens: 16 }))
			.toLowerCase().replace(/circular|circle|spherical/g, 'round').replace(/rectangular/g, 'square')
			.replace(/aquarium/g, 'aquatic').replace(/aviary/g, 'aerial').replace(/terrarium/g, 'terrestrial');
		const dPick = t.holes.map(( h, i ) => [((h.size ? h.size + ' ' : '') + h.cat), i] )
			.filter(( [w] ) => d.includes(w) ).map(( [, i] ) => i );
		const goldIdx = t.gold;
		if ( goldIdx == null ? d.includes('none') && !dPick.length : (dPick.length === 1 && dPick[0] === goldIdx) ) row.direct++;
		else if ( goldIdx == null && dPick.length ) row.directHallu++;
	}

	console.log('══ RIDDLE PROBE 2 — constance (instances fraîches + transposition) & défaisance ══');
	for ( const [rk, r] of Object.entries(R) )
		console.log(`  ${rk.padEnd(30)} n=${r.n}  SYS ${r.sys}/${r.n}${r.sysHallu ? ' ⚠hallu ' + r.sysHallu : ''}`
			+ `${r.ablN ? ' · ABL fc ' + r.ablFC + '/' + r.ablN + '→learn ' + r.ablLearn : ''}`
			+ ` · DIRECT ${r.direct}/${r.n}${r.directHallu ? ' ⚠hallu ' + r.directHallu : ''}`
			+ `${r.condSeen ? ' · cond-extraite ' + r.condSeen : ''}`);
	fs.writeFileSync(path.join(__dirname, 'RESULTS-2' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify(R, null, 1));
	console.log('wrote RESULTS-2' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
