'use strict';
/*
 * ratchet-probe.js — LE CLIQUET : « le modèle écrit l'arête » (UNGATED) vs « le modèle PROPOSE, la porte
 * vérifie et admet » (GATED). Trois casquettes en un harnais : le baseline #3 exigé par le verdict
 * prior-art (§7 — sans lui la contribution reste non-démontrée-générale) · le fallback-déduction de
 * l'architecture (le modèle = l'organe de déduction à la frontière de couverture, le treillis = le registre
 * des déductions VÉRIFIÉES) · la première mesure du cliquet-pas-moyenne (seul le vérifié s'accumule).
 *
 * PROTOCOLE PRÉ-ENREGISTRÉ :
 *   Treillis de départ = ABLATÉ de toutes les arêtes kind→catégorie (chaque épisode arrive à la frontière
 *   de couverture). Par épisode : paraphrase → intake typé (kind/condition/…) → si le treillis de l'arm
 *   couvre le kind → décision DÉTERMINISTE (0 call — l'amortissement) ; sinon → le modèle PROPOSE l'arête
 *   générale (« in general, a <kind> is <cat|none> ») DEPUIS le contexte de l'épisode (le cliquet réaliste
 *   lit son vécu — c'est précisément le canal de poison).
 *   - UNGATED : la proposition est ADMISE telle quelle (arête kind-level persistée) ; les épisodes suivants
 *     du kind l'utilisent en silence (0 call — et 0 chance de correction).
 *   - GATED, deux dents : (1) LOCALISATION — un épisode CONFONDU (condition extraite non-vide : deflated/
 *     melted/wet/…) ne peut PAS admettre une arête kind-level (l'évidence n'est pas attribuable au kind vs
 *     à la condition — la discipline 8d appliquée à la généralisation positive) : mount optimiste pour CET
 *     épisode seulement, jamais persisté ; (2) VÉRIFICATION — une proposition non-confondue est montée
 *     OPTIMISTEMENT et l'arête n'est admise QUE si le verdict oracle passe ; échec → blame → refus
 *     (re-proposition possible au prochain épisode du kind — le retry compté en prime).
 *
 *   DEUX CANAUX DE DIVERGENCE (le check d'existence 8a — comptés AVANT tout verdict) :
 *   (i) POISON PAR INSTANCE CONFONDUE : l'épisode balle-dégonflée/sucre-fondu tente d'écrire l'arête du
 *       kind — le modèle peut plier sous le contexte (« deflated ball » → none/flat) ; s'il reste robuste
 *       (propose round quand même), le canal est VIDE et REPORTÉ tel quel (jamais absorbé).
 *   (ii) DIVERGENCE DE SPEC (garantie — mesurée aux probes 1/2) : fern→terrarium et pyramid→square sont
 *       les propositions PLAUSIBLES-MONDE du modèle qui violent l'ontologie DÉCLARÉE (gold=none) — le
 *       cliquet naïf ABSORBE l'ontologie du modèle, la porte tient la spec (au prix de retries).
 *
 *   MÉTRIQUES EXACTES (par ordre de stream ×3, jamais moyennées) : arêtes fausses admises (UNGATED = #
 *   propositions fausses en 1re occurrence ; GATED = 0 attendu) · DÉGÂT AVAL SILENCIEUX (épisodes suivants
 *   répondus depuis une arête fausse, 0 call — la signature du drift NELL) · la PRIME de la porte
 *   (verify-mounts + refus-confondus + retries — l'assurance n'est jamais gratuite, la leçon D du lab) ·
 *   amortissement (≤1 proposition par kind et par arm) · déterminisme (memo durable partagé).
 *   Oracle = le gold déclaré du harnais (joue le rôle du verify/contrat runtime — circularité assumée et
 *   dite : on mesure la DYNAMIQUE d'admission, pas la connaissance).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { DOMAINS, goldOf, intake, normWord } = require('./riddle-probe-2.js');
const { lattice } = require(ROOT + '/doc/WIP/experiments/2026-07-03-restriction-learning/learn-core.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const COLORS = ['yellow', 'red', 'blue', 'green'];

// ── the episode streams (per domain; kinds repeat — the amortization/damage window) ─────────────────────
const holes3 = ( D ) => D.cats.map(( c ) => ({ cat: c }) );
const mk = ( domain, kind, i, cond ) => {
	const D = DOMAINS[domain];
	const t = { domain, kind, color: COLORS[i % 4], cond, holes: holes3(D) };
	const surf = D.surface[t.kind] || t.kind;
	t.prose = `You have a ${cond ? cond + ' ' : ''}${t.color} ${surf}. Put it into one of these ${D.holesPhrase}: `
		+ t.holes.map(( h, k ) => (k === t.holes.length - 1 ? 'or the ' : 'the ') + D.holeWord(h) ).join(', ') + '. Which one?';
	t.gold = goldOf(t, D);
	return t;
};
const STREAMS = {
	shapes: [                                                                  // channel (i): the confounded poison
		mk('shapes', 'ball', 0, 'deflated'),                                   //   FIRST occurrence = the poison window
		mk('shapes', 'ball', 1), mk('shapes', 'ball', 2),                      //   then normal balls — the damage meter
		mk('shapes', 'sugarcube', 3, 'melted'), mk('shapes', 'sugarcube', 0),
		mk('shapes', 'marble', 1), mk('shapes', 'marble', 2),                  //   unconfounded control kind
		mk('shapes', 'pyramid', 3), mk('shapes', 'pyramid', 0),                // channel (ii): spec-divergence (gold none)
	],
	animals: [
		mk('animals', 'fern', 0), mk('animals', 'fern', 1),                    // channel (ii) — measured 6/6 divergent
		mk('animals', 'trout', 2), mk('animals', 'trout', 3),
		mk('animals', 'gecko', 0), mk('animals', 'sparrow', 1),
	],
};
const ORDERS = [null, 41, 97];                                               // natural + 2 LCG shuffles
const lcg = ( s ) => { let x = s >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };
const shuffled = ( xs, rnd ) => { const a = xs.slice(); for ( let i = a.length - 1; i > 0; i-- ) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// the model PROPOSES the general edge from its episode context (the realistic ratchet reads its lived task).
// [Critique 1 cycle : « category » se lisait TAXONOMIQUE (truite=poisson ∉ enum → none 5/5) — le prompt doit
//  parler la langue de la FACETTE du domaine (la même leçon que les schémas d'intake) : facetWord par domaine.]
const FACET_WORD = { shapes: 'shape category', animals: 'habitat type' };
async function proposeEdge( ask, D, dname, prose, kind ) {
	const cats = D.cats.join('|');
	const txt = await ask({
		system: 'You just handled this task: "' + prose + '". Now state the GENERAL rule for this kind of object.'
			+ ' Reply ONLY JSON: {"kind":"' + kind + '","category":"<' + cats + '|none>"}',
		user: 'In general, which ' + FACET_WORD[dname] + ' fits a ' + kind + '?', maxTokens: 40,
	});
	// PAS de grammaire ici — 3e reproduction du finding RUN-2/signature-screen : l'enum contraint COLLAPSE la
	// proposition sur 'none' (gecko/trout/fern → none avec grammaire ; corrects sans). Prompt-only + parse.
	try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt).category; } catch ( e ) { return null; }
}

// deterministic decision under the arm's CURRENT edges (kind→cat map): 1 matching hole → mount; none→none.
function decide( t, D, cat ) {
	if ( !cat || cat === 'none' ) return null;
	const ok = t.holes.map(( h, i ) => [h, i] ).filter(( [h] ) => h.cat === cat );
	return ok.length === 1 ? ok[0][1] : null;
}

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const report = {};
	for ( const [dname, base] of Object.entries(STREAMS) ) {
		const D = DOMAINS[dname];
		for ( const [oi, seed] of ORDERS.entries() ) {
			const stream = seed == null ? base : shuffled(base, lcg(seed));
			const cell = dname + '/order' + oi;
			const M = report[cell] = {
				divergence: { confounded: 0, spec: 0 },                         // the 8a existence counts
				ungated: { wrongEdges: [], damage: 0, ok: 0, calls: 0 },
				gated: { wrongEdges: [], damage: 0, ok: 0, calls: 0, quarantined: 0, refusals: 0, retries: 0 },
			};
			const edges = { ungated: {}, gated: {} };                           // kind → cat|'none' (the ratchet state)
			const proposedOnce = { ungated: new Set(), gated: new Set() };
			for ( const t of stream ) {
				const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
				const x = await intake(ask, prose, D);
				const kind = x ? normWord(x.object.kind, Object.keys(D.isa)) : t.kind;
				const confounded = !!(x && String(x.object.condition || '').trim());
				for ( const arm of ['ungated', 'gated'] ) {
					const A = M[arm], E = edges[arm];
					let cat, viaEdge = false;
					if ( kind in E ) { cat = E[kind]; viaEdge = true; }          // covered → deterministic, 0 calls
					else {
						cat = await proposeEdge(ask, D, dname, prose, kind);
						A.calls++;
						const wrong = cat !== (goldOf({ ...t, cond: undefined }, D) != null            // the kind's TRUE cat
							? t.holes[goldOf({ ...t, cond: undefined }, D)].cat : 'none');
						if ( arm === 'ungated' ) {                                // ── the naive ratchet: admit as-is
							if ( !proposedOnce[arm].has(kind) ) { E[kind] = cat; proposedOnce[arm].add(kind); if ( wrong ) A.wrongEdges.push(kind + '→' + cat); }
						}
						else {                                                    // ── the GATE, two teeth
							if ( confounded ) A.quarantined++;                     // (1) localization: confounded ⇒ no kind-edge
							else {
								const hole = decide(t, D, cat);                     // (2) verification: optimistic mount + verdict
								const verdictOk = t.gold == null ? (hole == null && cat === 'none') : hole === t.gold;
								if ( proposedOnce[arm].has(kind) ) A.retries++;
								proposedOnce[arm].add(kind);
								if ( verdictOk ) { E[kind] = cat; if ( wrong ) A.wrongEdges.push(kind + '→' + cat); }
								else A.refusals++;                                  // blame → NOT admitted (retry next occurrence)
							}
						}
					}
					// answer THIS episode from cat (defeater semantics for confounded golds ride goldOf)
					const hole = decide(t, D, cat);
					const answerOk = t.gold == null ? hole == null : hole === t.gold;
					if ( answerOk ) A.ok++;
					else if ( viaEdge ) A.damage++;                              // wrong, from a persisted edge, 0 calls — SILENT
				}
				// the 8a divergence existence counts (arm-independent, on the proposal channel)
				if ( t.cond && ['deflated', 'melted'].includes(t.cond) ) M.divergence.confounded++;
				if ( t.gold == null ) M.divergence.spec++;
			}
		}
	}

	console.log('══ RATCHET PROBE — UNGATED (le modèle écrit l\'arête) vs GATED (localisation + vérification) ══');
	for ( const [cell, M] of Object.entries(report) ) {
		const u = M.ungated, g = M.gated;
		console.log(`  ${cell.padEnd(15)} UNGATED: ok ${u.ok} · arêtes-fausses [${u.wrongEdges}] · DÉGÂT-SILENCIEUX ${u.damage} · calls ${u.calls}`);
		console.log(`  ${''.padEnd(15)} GATED  : ok ${g.ok} · arêtes-fausses [${g.wrongEdges}] · dégât ${g.damage} · calls ${g.calls} (quarantaine ${g.quarantined} · refus ${g.refusals} · retries ${g.retries})`);
	}
	fs.writeFileSync(path.join(__dirname, 'RESULTS-ratchet' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify(report, null, 1));
	console.log('wrote RESULTS-ratchet' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
