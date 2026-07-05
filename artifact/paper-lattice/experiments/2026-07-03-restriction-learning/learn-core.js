'use strict';
/*
 * learn-core.js — le noyau THÉORIE-FIXÉ de la boucle d'apprentissage des restrictions (roadmap #2) —
 * l'opérationnalisation des passes Laurie (théorie Q1/Q2 + lab-confront 2026-07-03) :
 *   - treillis `isa` DÉCLARÉ (axiomes), POSET général (multi-parents autorisés) → le join (LGG de deux
 *     sortes) peut être NON-UNIQUE : on rend l'ENSEMBLE des ancêtres communs les plus profonds ;
 *   - par (slot × facette), la restriction = des COUPES PARALLÈLES S (la version-space de « garder
 *     parallèle, pas collapser » §9 — un join non-unique fait des branches, l'évidence collapse) + une liste
 *     de contraintes négatives — JAMAIS une frontière G énumérée (Haussler) ;
 *   - S s'élargit sur POSITIF (join par branche, normalisé aux alternatives les plus spécifiques) ; un
 *     négatif ADMIS (la politique d'admission est à l'ARM, pas au cœur) ajoute une exclusion ;
 *   - admission FAIL-CLOSED : admit ssi la sorte est couverte par TOUTES les coupes parallèles (l'unanimité —
 *     l'ambiguïté refuse, elle ne devine pas) ∧ pas d'exclusion active ;
 *   - OPTIMISME anti-auto-scellement : re-visite déterministe à horizon DOUBLANT par sorte bloquée
 *     (O(Σ log T) extra-mounts — UCB1-style), un positif vérifié DÉSSCELLE.
 * Pur, déterministe, zéro dépendance moteur. Le harnais (arms/streams/oracles) vit dans stream-lab.js.
 */

/** A declared isa-POSET: { sort: parent | [parents] | null }. */
function lattice( edges ) {
	const parents = {};
	for ( const [s, p] of Object.entries(edges) ) parents[s] = Array.isArray(p) ? p : (p ? [p] : []);
	const ancestors = ( s ) => {
		const seen = new Set(), stack = [s];
		while ( stack.length ) {
			const x = stack.pop();
			if ( seen.has(x) ) continue;
			seen.add(x);
			for ( const p of (parents[x] || []) ) stack.push(p);
		}
		return seen;                                                        // reflexive
	};
	const depth = ( s ) => { let d = 0, cur = parents[s] || []; const seen = new Set([s]);
		while ( cur.length ) { d++; const nxt = []; for ( const p of cur ) if ( !seen.has(p) ) { seen.add(p); nxt.push(...(parents[p] || [])); } cur = nxt; }
		return d; };
	const leq = ( a, b ) => ancestors(a).has(b);
	/** ALL deepest common ancestors — non-unique on a general poset (each = one parallel LGG branch). */
	const joinSet = ( a, b ) => {
		if ( !a ) return [b];
		if ( !b ) return [a];
		const A = ancestors(a), common = [...ancestors(b)].filter(( c ) => A.has(c));
		const dmax = Math.max(...common.map(depth));
		return common.filter(( c ) => depth(c) === dmax).sort();
	};
	return { leq, joinSet, depth, ancestors, sorts: Object.keys(parents) };
}

/** keep only the most-specific alternatives (evidence-driven collapse of comparable branches). */
function minimalCuts( L, cuts ) {
	const u = [...new Set(cuts)];
	return u.filter(( c ) => !u.some(( o ) => o !== c && L.leq(o, c))).sort();
}

/** One (slot × facet) restriction learner — candidate elimination, G never materialized, S = parallel cuts. */
function slotLearner( L, opts ) {
	opts = opts || {};
	const optimismEvery = opts.optimismEvery == null ? 0 : opts.optimismEvery;   // 0 = optimism OFF
	let S = null;                                                            // null | [cut…] (parallel branches)
	const blocked = new Map();                                               // sort → {refusals, backoff, sealedBy}
	return {
		positive( sort ) {
			S = S == null ? [sort] : minimalCuts(L, S.flatMap(( c ) => L.joinSet(c, sort)));
			if ( blocked.has(sort) ) blocked.delete(sort);                    // a verified positive UNSEALS
		},
		negative( sort, why ) {
			if ( !blocked.has(sort) ) blocked.set(sort, { refusals: 0, backoff: optimismEvery, sealedBy: why || 'blame' });
		},
		admit( sort ) {
			const b = blocked.get(sort);                                       // HARD evidence first — a blocked sort
			if ( b ) {                                                         // refuses regardless of S coverage
				if ( optimismEvery > 0 && ++b.refusals >= b.backoff ) { b.refusals = 0; b.backoff *= 2; return { ok: true, retry: true }; }
				return { ok: false, why: 'blocked(' + b.sealedBy + ')' };
			}
			if ( S == null || !S.every(( c ) => L.leq(sort, c)) ) return { ok: false, why: 'outside-S' };  // fail-closed unanimity
			return { ok: true };
		},
		state() { return { S: S && S.slice(), blocked: [...blocked.keys()].sort() }; },
	};
}

module.exports = { lattice, slotLearner, minimalCuts };

// ── self-checks (node learn-core.js) ───────────────────────────────────────────────────────────────────
if ( require.main === module ) {
	const assert = require('node:assert/strict');
	// tree part: b≥3 leaves under each target cut (Laurie 2 — the lift must beat leaf-enumeration)
	const L = lattice({
		column: null,
		categorical: 'column', numeric: 'column', textual: 'column',
		status: 'categorical', client: 'categorical', priority: 'categorical',
		amount: 'numeric', copies: 'numeric', year: 'numeric',
		genre: ['categorical', 'textual'], topic: ['categorical', 'textual'],   // the multi-parent pair → NON-UNIQUE join
	});
	assert.deepEqual(L.joinSet('status', 'client'), ['categorical'], 'unique join on the tree part');
	assert.deepEqual(L.joinSet('genre', 'topic'), ['categorical', 'textual'], 'NON-UNIQUE join on the multi-parent pair (both deepest)');
	const s = slotLearner(L, { optimismEvery: 2 });
	s.positive('genre'); s.positive('topic');
	assert.deepEqual(s.state().S, ['categorical', 'textual'], 'the version-space keeps BOTH branches (parallèle = sûr)');
	assert.equal(s.admit('status').ok, false, 'fail-closed unanimity: status is categorical but NOT textual → ambiguous → refuse');
	s.positive('status');                                                     // the discriminating evidence
	assert.deepEqual(s.state().S, ['categorical'], 'evidence COLLAPSES the branches (status ⊄ textual → the textual branch lifts to column, minimality drops it)');
	assert.equal(s.admit('priority').ok, true, 'an unseen categorical is licensed post-collapse');
	assert.equal(s.admit('amount').ok, false, 'numeric stays outside S');
	// negatives + optimism + unseal (unchanged semantics)
	s.negative('priority', 'blame');
	assert.equal(s.admit('priority').ok, false);
	assert.equal(s.admit('priority').ok, true, 'doubling-horizon retry fires deterministically');
	assert.equal(s.admit('priority').ok, false, 'backoff doubled — not admitted again immediately');
	s.positive('priority');
	assert.equal(s.admit('priority').ok, true, 'verified positive unseals');
	// LGG floor: single positive stays specific
	const s2 = slotLearner(L, {});
	s2.positive('amount');
	assert.deepEqual(s2.state().S, ['amount'], 'one positive → most-specific cut (no premature lift)');
	s2.positive('copies');
	assert.deepEqual(s2.state().S, ['numeric'], 'second positive lifts to the level');
	console.log('learn-core self-checks PASS (poset joinSet · parallel cuts + evidence collapse · fail-closed unanimity · optimism/unseal · LGG lift)');
}
