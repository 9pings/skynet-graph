'use strict';
/*
 * direct-reasoning-arm.js — le gap G1a du plan papier : la baseline DIRECT **reasoning-ON** (le MÊME 27B,
 * reasoningBudget 1024) sur les MÊMES 54 tâches du probe-2 (mêmes paraphrases, memo-servies sous la clé
 * rb=0 — la comparaison est contrôlée : seul le budget de raisonnement du solveur DIRECT change).
 * L'attendu HONNÊTE, pré-écrit : le thinking répare une partie de la balle-dégonflée et des V1/V2 ratés —
 * le claim du papier se recentre alors sur (b) fidélité-spec + (c) apprenabilité + le refus typé + le COÛT
 * (tokens/latence thinking vs le match déterministe à ~0). Les deux issues sont informatives.
 * Sortie : RESULTS-direct-reasoning.json + le tableau comparatif rb0-vs-rb1024.
 * [Critique v1 (1 cycle) : maxTokens=400 < thoughtTokens=1024 → le thinking mangeait tout le budget et le
 *  CONTENU revenait VIDE (vérifié sur le memo : réponses "") — l'arm mesurait la troncature, pas le
 *  raisonnement. v2 : maxTokens 1600 > budget-pensée + marge.]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { DOMAINS, makeTasks, goldOf } = require('./riddle-probe-2.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const RB = Number(process.env.RB || 1024);

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw0 = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const rawR = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: RB, seed: 0, contextSize: 4096 });
	const memoDir = path.join(__dirname, 'memo');
	const { ask: ask0 } = makeDurableAsk(raw0, { dir: memoDir, meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });
	const { ask: askR, stats } = makeDurableAsk(rawR, { dir: memoDir, meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: RB } });

	const tasks = [...makeTasks('shapes', DOMAINS.shapes, 6, 6), ...makeTasks('animals', DOMAINS.animals, 0, 6)];
	const R = {};
	const t0 = process.hrtime.bigint();
	for ( const t of tasks ) {
		const D = DOMAINS[t.domain];
		t.gold = goldOf(t, D);
		const rk = t.domain + '/' + t.v;
		const row = R[rk] = R[rk] || { n: 0, ok: 0, hallu: 0 };
		row.n++;
		// the SAME paraphrase the probe-2 arms saw (memo-served under the rb=0 key — controlled comparison)
		const prose = String(await ask0({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
		const descs = t.holes.map(( h ) => (h.size ? h.size + ' ' : '') + h.cat );
		const d = String(await askR({ system: 'Answer the puzzle with EXACTLY one of: ' + descs.join(' | ') + ' | none.', user: prose, maxTokens: 1600 }))
			.toLowerCase().replace(/circular|circle|spherical/g, 'round').replace(/rectangular/g, 'square')
			.replace(/aquarium/g, 'aquatic').replace(/aviary/g, 'aerial').replace(/terrarium/g, 'terrestrial');
		const tail = d.slice(-80);                                               // thinking-on: judge the FINAL answer zone
		const dPick = t.holes.map(( h, i ) => [((h.size ? h.size + ' ' : '') + h.cat), i] )
			.filter(( [w] ) => tail.includes(w) ).map(( [, i] ) => i );
		if ( t.gold == null ? tail.includes('none') && !dPick.length : (dPick.length === 1 && dPick[0] === t.gold) ) row.ok++;
		else if ( t.gold == null && dPick.length ) row.hallu++;
	}
	const sec = Number(process.hrtime.bigint() - t0) / 1e9;
	console.log('══ DIRECT reasoning-ON (rb=' + RB + ') vs les scores probe-2 (rb=0) ══');
	const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'RESULTS-2' + (process.env.OUT_SUFFIX || '') + '.json'), 'utf8'));
	for ( const [rk, r] of Object.entries(R) )
		console.log(`  ${rk.padEnd(30)} rbON ${r.ok}/${r.n}${r.hallu ? ' ⚠hallu ' + r.hallu : ''}   (rb0: ${prev[rk].direct}/${prev[rk].n}${prev[rk].directHallu ? ' hallu ' + prev[rk].directHallu : ''} · SYS ${prev[rk].sys}/${prev[rk].n})`);
	console.log('  spend: ' + stats.misses + ' thinking calls in ' + Math.round(sec) + 's (' + (stats.misses ? (sec / stats.misses).toFixed(1) : '0') + ' s/call)');
	fs.writeFileSync(path.join(__dirname, 'RESULTS-direct-reasoning' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify({ rb: RB, R }, null, 1));
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
