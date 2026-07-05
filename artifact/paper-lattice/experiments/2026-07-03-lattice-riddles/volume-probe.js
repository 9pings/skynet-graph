'use strict';
/*
 * volume-probe.js — le G3 du plan papier : VOLUME + STATS + 3e DOMAINE.
 *   - n=24 par (domaine, variante V1-V4) — la cible « N≥20-30/cellule, Clopper-Pearson » ;
 *   - 3e domaine de TRANSPOSITION : PRISES/FICHES (electrical plugs/sockets — europlug ⊑ roundpin ;
 *     défaiseur « bent » world-ALIGNÉ : une fiche tordue ne rentre pas — la leçon oracles-durcis) ;
 *   - V5 défaisable + bénin ×2 domaines à défaiseurs (shapes + plugs) ;
 *   - stats : IC Clopper-Pearson 95 % exact par cellule (bissection sur la CDF binomiale) ;
 *   - arms : SYS (chemin typé probe-2 : intake fermé + doctrine en couches + défaisance) vs DIRECT-rb0.
 * Instances fraîches (offsets neufs), mêmes briques (DOMAINS/makeTasks/goldOf/intake/matchHoles de
 * riddle-probe-2 — le harnais est le produit). Memo durable : les 54 tâches historiques re-servent.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { DOMAINS, makeTasks, goldOf, intake, matchHoles, normWord } = require('./riddle-probe-2.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const N_PER = Number(process.env.N_PER || 24);

// ── le 3e domaine : prises/fiches (structure V1-V4 + défaiseur world-aligné) ─────────────────────────────
DOMAINS.plugs = {
	isa: { roundpin: null, flatpin: null, threepin: null,
		europlug: 'roundpin', schuko: 'roundpin', usplug: 'flatpin', ukplug: 'threepin',
		shaver: 'europlug', charger: 'usplug', kettle: 'ukplug', lamp: 'schuko' },
	cats: ['roundpin', 'flatpin', 'threepin'],
	holeSort: { roundpin: 'roundpin', flatpin: 'flatpin', threepin: 'threepin' },
	holeWord: ( h ) => (h.size ? h.size + ' ' : '') + ({ roundpin: 'round-pin', flatpin: 'flat-pin', threepin: 'three-pin' }[h.cat]) + ' socket',
	holesPhrase: 'wall sockets', catEnum: 'roundpin|flatpin|threepin|other',
	kindHint: 'the plug name exactly as written, keep all its words',
	surface: { europlug: 'Euro plug', schuko: 'Schuko plug', usplug: 'US plug', ukplug: 'UK plug',
		shaver: 'shaver plug', charger: 'phone charger plug', kettle: 'kettle plug', lamp: 'lamp plug' },
	v1Kinds: ['europlug', 'usplug', 'ukplug'], v2Kinds: ['shaver', 'charger', 'kettle', 'lamp'],
	v3Kind: 'hdmi', v4Kinds: ['europlug', 'usplug'], v4Cat: 'roundpin', v4AltCat: 'flatpin',
	defeaters: { bent: ['roundpin', 'flatpin', 'threepin'] },                 // une fiche TORDUE ne rentre nulle part
	v5: [{ kind: 'europlug', cond: 'bent' }, { kind: 'usplug', cond: 'bent' }, { kind: 'ukplug', cond: 'bent' }],
	v5Benign: ['dusty', 'brand-new', 'white'],
};
DOMAINS.plugs.isa.hdmi = 'data';                                              // V3 no-match : hdmi ∉ {sockets muraux}
DOMAINS.plugs.isa.data = null;

// ── Clopper-Pearson 95 % (exact, par bissection sur la CDF binomiale) ────────────────────────────────────
function binomCdf( k, n, p ) { let s = 0, c = 1; for ( let i = 0; i <= k; i++ ) { s += c * Math.pow(p, i) * Math.pow(1 - p, n - i); c = c * (n - i) / (i + 1); } return s; }
function cp95( k, n ) {
	const solve = ( f ) => { let lo = 0, hi = 1; for ( let i = 0; i < 50; i++ ) { const m = (lo + hi) / 2; if ( f(m) ) lo = m; else hi = m; } return (lo + hi) / 2; };
	const lo = k === 0 ? 0 : solve(( p ) => binomCdf(k - 1, n, p) > 0.975 );
	const hi = k === n ? 1 : solve(( p ) => binomCdf(k, n, p) > 0.025 );
	return [lo, hi];
}

( async function main() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	// fresh offsets: shapes continues after probe-2 (0-11 used) at 12; animals after 0-5 at 6; plugs at 0.
	const tasks = [
		...makeTasks('shapes', DOMAINS.shapes, 12, N_PER),
		...makeTasks('animals', DOMAINS.animals, 6, N_PER),
		...makeTasks('plugs', DOMAINS.plugs, 0, N_PER),
	];
	const R = {};
	let done = 0;
	const t0 = Date.now();
	for ( const t of tasks ) {
		const D = DOMAINS[t.domain];
		t.gold = goldOf(t, D);
		const rk = t.domain + '/' + t.v;
		const row = R[rk] = R[rk] || { n: 0, sys: 0, sysHallu: 0, direct: 0, directHallu: 0 };
		row.n++;
		const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
		const x = await intake(( o ) => ask(o), prose, D);
		const m = x ? matchHoles(x, D) : { status: 'unparsed' };
		// score by hole IDENTITY (cat+size), never by index — the intake may extract a SUBSET of the holes
		// (the paraphrase's "which socket is compatible…" style) and the mounted hole is then index-shifted
		// while being semantically the RIGHT one (measured: every residual plugs miss was this artifact).
		const { lattice } = require(ROOT + '/doc/WIP/experiments/2026-07-03-restriction-learning/learn-core.js');
		const L = lattice(D.isa);
		const holeCatOf = ( name ) => { const w = normWord(name, Object.keys(D.isa).concat(Object.keys(D.holeSort))); return D.holeSort[w] || D.cats.find(( c ) => L.leq(w, c) ) || null; };
		const goldHole = t.gold != null ? t.holes[t.gold] : null;
		const mounted = m.status === 'mounted' && x.holes[m.hole];
		const sysOk = t.gold == null ? m.status === 'impracticable'
			: !!mounted && holeCatOf(mounted.name) === goldHole.cat && (!goldHole.size || !mounted.size || mounted.size === goldHole.size);
		if ( sysOk ) row.sys++;
		else if ( t.gold == null && m.status === 'mounted' ) row.sysHallu++;
		const descs = t.holes.map(( h ) => (h.size ? h.size + ' ' : '') + h.cat );
		const d = String(await ask({ system: 'Answer the puzzle with EXACTLY one of: ' + descs.join(' | ') + ' | none.', user: prose, maxTokens: 16 }))
			.toLowerCase().replace(/circular|circle|spherical/g, 'round').replace(/rectangular/g, 'square')
			.replace(/aquarium/g, 'aquatic').replace(/aviary/g, 'aerial').replace(/terrarium/g, 'terrestrial')
			.replace(/round-pin/g, 'roundpin').replace(/flat-pin/g, 'flatpin').replace(/three-pin/g, 'threepin');
		const picks = t.holes.map(( h, i ) => [((h.size ? h.size + ' ' : '') + h.cat), i] ).filter(( [w] ) => d.includes(w) ).map(( [, i] ) => i );
		if ( t.gold == null ? d.includes('none') && !picks.length : (picks.length === 1 && picks[0] === t.gold) ) row.direct++;
		else if ( t.gold == null && picks.length ) row.directHallu++;
		if ( ++done % 50 === 0 ) console.log('  …', done + '/' + tasks.length, Math.round((Date.now() - t0) / 1000) + 's');
	}

	console.log('══ G3 VOLUME — n=' + N_PER + '/cellule ×3 domaines, IC Clopper-Pearson 95 % ══');
	const fmt = ( k, n ) => { const [lo, hi] = cp95(k, n); return `${k}/${n} [${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%]`; };
	let sysT = 0, dirT = 0, nT = 0;
	for ( const [rk, r] of Object.entries(R) ) {
		sysT += r.sys; dirT += r.direct; nT += r.n;
		console.log(`  ${rk.padEnd(30)} SYS ${fmt(r.sys, r.n)}${r.sysHallu ? ' ⚠hallu ' + r.sysHallu : ''}  DIRECT ${fmt(r.direct, r.n)}${r.directHallu ? ' ⚠hallu ' + r.directHallu : ''}`);
	}
	console.log(`  ${'TOTAL'.padEnd(30)} SYS ${fmt(sysT, nT)}  DIRECT ${fmt(dirT, nT)}`);
	fs.writeFileSync(path.join(__dirname, 'RESULTS-volume' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify(R, null, 1));
	console.log('wrote RESULTS-volume' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
