'use strict';
/*
 * credit-probe.js — le probe 8d (Laurie, lab-confront) : le CRÉDIT POSITIF à un composite doit se LOCALISER
 * comme le blame (`postFrom` côté succès) ou il SUR-GÉNÉRALISE. Le dual du wedge-blame, PRICÉ.
 *
 * LA DIVERGENCE QUI FAIT EXISTER LE WEDGE (l'analogue du 8a) : les succès « côté-zéro » — le PASS global
 * alors qu'UN slot n'a pas été exercé (son filtre a matché 0 lignes ; le gagnant reste juste par l'autre
 * côté). Signature RÉELLE observée au rung-2 : t9 compare Stark/Wayne avec « Stark » ABSENT de la donnée.
 * Sans ces événements, les deux politiques de crédit coïncident (le stream CONTROL l'asserte).
 *
 * ARMS (streams IDENTIQUES, blame-gate B actif dans les deux, ρ=0 — le bruit n'est pas l'objet d'ici) :
 *   P-glob — un succès global crédite les sortes des DEUX slots (le crédit naïf) ;
 *   P-loc  — un succès crédite SEULEMENT les rôles rendus par `attributeSlotCredit(verifiedAtoms)` (la
 *            brique lib, provenance `slotPostFrom` — le MÊME chemin canon que le blame).
 *
 * STREAMS × 2 treillis × 3 permutations de la queue (le seed reste premier : S doit exister avant que la
 * divergence puisse compter), comptes EXACTS pré-enregistrés par cellule via un ORACLE D'ATTENTE INDÉPENDANT
 * (pure inspection de l'ordre du stream + la vérité déclarée — jamais le learner) :
 *   (i)  POISON — un PASS côté-zéro porte une sorte BAD (numeric) sur le slot non-exercé. GARANTIES DE
 *        DESIGN (documentées, ce qui rend l'oracle dérivable) : les autres crédits du slot-cible sont des
 *        feuilles categorical (leur join ne couvre jamais un numeric) ; SEUL le crédit non-vérifié lift à
 *        `column`. Prédictions : unverified glob = #côté-zéro, loc = 0 · og(bad couvert à l'arrivée)
 *        glob = #arrivées-bad-après-le-poison (par permutation), loc = 0 · endpoints S_glob = [column]
 *        (trop large) vs S_loc = la coupe d'évidence.
 *   (ii) PREMIUM — le PASS côté-zéro porte une sorte BONNE rare (la face duale, l'assurance de P-loc a un
 *        PRIX) : lag(bonne non-couverte à l'arrivée) loc = #arrivées avant la 1re évidence EXERCÉE vs
 *        glob = #arrivées avant le 1er crédit (côté-zéro inclus) — le premium est RÉEL et TRANSITOIRE
 *        (endpoints ÉGAUX en fin de stream). GARANTIE : les autres crédits du slot = la même feuille
 *        (join idempotent, pas de lift parasite qui couvrirait la rare sans son évidence).
 *   (iii) CONTROL — les mêmes événements SANS côté-zéro : arms bit-identiques (l'existence du wedge exige
 *        la divergence — le check 8a).
 * HONNÊTETÉ : ne JAMAIS conclure « P-glob ne converge pas » — le wedge = les admissions NON-VÉRIFIÉES et
 * l'over-gen qu'elles causent sur CE stream ; og et lag se lisent TOUJOURS ensemble (la leçon du lab).
 * Déterministe, zéro GPU, zéro moteur ; la règle de crédit est l'objet testé.
 */
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const { lattice, slotLearner } = require('./learn-core.js');
const { slotPostFrom, attributeSlotBlame, attributeSlotCredit } = require(ROOT + '/lib/authoring/parametric.js');

// ── the frame: 2 slots, one facet (group), target cut = categorical; provenance via the REAL lib brick ──
const ATOMS = { 0: 'rows.0>0', 1: 'rows.1>0' };
const { postSlots } = slotPostFrom({ 'slot#0': [ATOMS[0]], 'slot#1': [ATOMS[1]] });

const L1 = () => lattice({
	column: null,
	categorical: 'column', numeric: 'column', textual: 'column',
	status: 'categorical', client: 'categorical', priority: 'categorical',
	amount: 'numeric', copies: 'numeric', year: 'numeric',
	genre: ['categorical', 'textual'], topic: ['categorical', 'textual'],
});
const L2 = () => lattice({                                                   // wider branching + the multi-parent pair
	column: null,
	categorical: 'column', numeric: 'column', textual: 'column',
	status: 'categorical', client: 'categorical', priority: 'categorical', region: 'categorical',
	amount: 'numeric', copies: 'numeric', year: 'numeric', size: 'numeric',
	genre: ['categorical', 'textual'], topic: ['categorical', 'textual'],
});
const BAD = new Set(['amount', 'copies', 'year', 'size']);                   // the declared truth (numeric in a group slot)

// ── streams: event = { sorts:[s0,s1], ok, zeroSide } — seed first, TAIL permutable ──────────────────────
const STREAMS = {
	poison: {
		seed: { sorts: ['status', 'client'], ok: true, zeroSide: null },
		tail: [
			{ sorts: ['client', 'amount'], ok: true, zeroSide: 1 },              // the poison: BAD unexercised on a PASS
			{ sorts: ['status', 'copies'], ok: false, zeroSide: null },          // bad exercised → fail → blame slot1
			{ sorts: ['priority', 'year'], ok: false, zeroSide: null },
		],
	},
	premium: {
		seed: { sorts: ['status', 'client'], ok: true, zeroSide: null },
		tail: [
			{ sorts: ['client', 'genre'], ok: true, zeroSide: 1 },               // GOOD rare, unexercised
			{ sorts: ['client', 'genre'], ok: true, zeroSide: null },            // the real (exercised) evidence
			{ sorts: ['client', 'genre'], ok: true, zeroSide: null },
		],
	},
};
STREAMS.control = {                                                          // poison WITHOUT zero-side: the amount event
	seed: STREAMS.poison.seed,                                                // becomes an exercised FAIL (the truth)
	tail: STREAMS.poison.tail.map(( e ) => e.zeroSide != null ? { sorts: e.sorts, ok: false, zeroSide: null } : e ),
};
const PERMS = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];

// ── one arm over one stream: the learners + the lib credit/blame routing; per-slot metrics ──────────────
function runArm( L, events, credit ) {
	const learners = [slotLearner(L, {}), slotLearner(L, {})];
	const m = { og: [0, 0], lag: [0, 0], unverified: 0 };
	for ( const e of events ) {
		for ( const i of [0, 1] ) {                                            // coverage bookkeeping BEFORE the update
			const S = learners[i].state().S;
			const covered = S != null && S.every ? S.every(( c ) => L.leq(e.sorts[i], c) ) : false;
			if ( BAD.has(e.sorts[i]) && covered ) m.og[i]++;
			if ( !BAD.has(e.sorts[i]) && !covered ) m.lag[i]++;
		}
		if ( e.ok ) {
			const verifiedAtoms = [0, 1].filter(( i ) => e.zeroSide !== i ).map(( i ) => ATOMS[i] );
			const roles = credit === 'glob' ? ['slot#0', 'slot#1']
				: attributeSlotCredit({ postSlots, verifiedAtoms }).roles;       // the lib dual — the object under test
			for ( const r of roles ) {
				const i = r === 'slot#0' ? 0 : 1;
				if ( e.zeroSide === i ) m.unverified++;                          // credit admitted on ZERO evidence
				learners[i].positive(e.sorts[i]);
			}
		}
		else {
			const i = BAD.has(e.sorts[1]) ? 1 : 0;                               // the deep contract localizes the bad slot
			const r = attributeSlotBlame({ postSlots, failedAtoms: [ATOMS[i]] });
			if ( r.admissible ) learners[r.role === 'slot#0' ? 0 : 1].negative(e.sorts[i]);
		}
	}
	return { m, state: learners.map(( l ) => l.state() ) };
}

// ── the INDEPENDENT expectation oracle: pure stream inspection + the design guarantees (never the learner) ─
function expectations( events, stream ) {
	const zeroIdx = events.findIndex(( e ) => e.ok && e.zeroSide != null );
	const e = { unverified: { glob: zeroIdx < 0 ? 0 : 1, loc: 0 } };
	if ( stream === 'poison' ) {
		// glob og on slot1 = bad arrivals strictly AFTER the poison lift (guarantee: only that lift covers numerics)
		e.og1 = { glob: events.filter(( ev, k ) => zeroIdx >= 0 && k > zeroIdx && BAD.has(ev.sorts[1]) ).length, loc: 0 };
		e.end1 = { glob: ['column'], loc: ['client'] };                        // client = the only exercised-good slot1 evidence
	}
	if ( stream === 'premium' ) {
		// lag on slot1 mechanically, via the DESIGNED 3-state S1 machine (the design guarantees make it exact:
		// slot1 credits ∈ {client, genre} only): none → [client] on the first credited client → [categorical]
		// on the first credited genre (glob credits any ok; loc only exercised ok). Includes the arm-invariant
		// cold-start lag the v1 oracle missed (§3 method-critique, 1 cycle: the learner was right, the
		// expectation forgot the seed's own not-yet-covered arrival).
		const lagOf = ( credits ) => {
			let state = 'none', lag = 0;
			for ( const ev of events ) {
				const s = ev.sorts[1];
				const covered = (s === 'client' && state !== 'none') || (s === 'genre' && state === 'categorical');
				if ( !covered ) lag++;
				if ( ev.ok && credits(ev) ) state = s === 'genre' ? 'categorical' : (state === 'none' ? 'client' : state);
			}
			return lag;
		};
		e.lag1 = { glob: lagOf(() => true ), loc: lagOf(( ev ) => ev.zeroSide !== 1 ) };
		e.og1 = { glob: 0, loc: 0 };
	}
	return e;
}

// ── the 18 cells, exact, per-cell (never averaged) ──────────────────────────────────────────────────────
let checks = 0, cells = 0;
const ck = ( c, msg ) => { assert.ok(c, msg); checks++; };
for ( const [lname, mkL] of [['L1', L1], ['L2', L2]] ) {
	for ( const [sname, S] of Object.entries(STREAMS) ) {
		for ( const [pi, perm] of PERMS.entries() ) {
			cells++;
			const events = [S.seed, ...perm.map(( i ) => S.tail[i] )];
			const L = mkL();
			const glob = runArm(L, events, 'glob');
			const loc = runArm(L, events, 'loc');
			const exp = expectations(events, sname);
			const cell = `${lname}/${sname}/perm${pi}`;
			ck(JSON.stringify(runArm(L, events, 'loc')) === JSON.stringify(loc), cell + ': deterministic re-run');
			ck(glob.m.unverified === exp.unverified.glob, cell + ': glob unverified admissions = #zero-side (' + exp.unverified.glob + ')');
			ck(loc.m.unverified === 0, cell + ': loc NEVER admits unverified credit');
			if ( sname === 'poison' ) {
				ck(glob.m.og[1] === exp.og1.glob, cell + ': glob og(slot1) = bads after the poison = ' + exp.og1.glob + ' (got ' + glob.m.og[1] + ')');
				ck(loc.m.og[1] === 0, cell + ': loc og(slot1) = 0 — an unexercised credit never lifts S');
				ck(JSON.stringify(glob.state[1].S) === JSON.stringify(exp.end1.glob), cell + ': glob S(slot1) ends TOO WIDE ' + JSON.stringify(glob.state[1].S));
				ck(JSON.stringify(loc.state[1].S) === JSON.stringify(exp.end1.loc), cell + ': loc S(slot1) holds the evidence cut ' + JSON.stringify(loc.state[1].S));
				ck(JSON.stringify(glob.state[1].blocked) === JSON.stringify(loc.state[1].blocked), cell + ': the blame channel is ARM-INVARIANT (same blocked set)');
			}
			if ( sname === 'premium' ) {
				ck(loc.m.lag[1] === exp.lag1.loc && glob.m.lag[1] === exp.lag1.glob,
					cell + ': the premium is REAL — lag loc=' + loc.m.lag[1] + ' vs glob=' + glob.m.lag[1] + ' (expected ' + exp.lag1.loc + '/' + exp.lag1.glob + ')');
				ck(loc.m.og[1] === 0 && glob.m.og[1] === 0, cell + ': no over-gen on the good-rare stream (read og AND lag together)');
				ck(JSON.stringify(loc.state[1].S) === JSON.stringify(glob.state[1].S), cell + ': the premium is TRANSIENT — endpoints EQUAL post-evidence');
			}
			if ( sname === 'control' ) {
				ck(JSON.stringify(glob) === JSON.stringify(loc), cell + ': NO zero-side → arms BIT-IDENTICAL (the 8a wedge-existence check)');
			}
		}
	}
}
console.log(`ALL ${checks} pre-registered exact checks PASS over ${cells} cells (2 lattices × 3 streams × 3 permutations).`);
console.log('⇒ VERDICT (8d PRICED): unlocalized positive credit buys over-generalization exactly where the');
console.log('   evidence is absent (glob: unverified admissions = #zero-side, S lifts to column, og > 0 on the');
console.log('   bads it now covers), at ZERO gain on the blame channel (blocked sets arm-invariant); the cost');
console.log('   of localization is a REAL but TRANSIENT premium (lag +1 per zero-side good event, endpoints');
console.log('   converge on exercised evidence). The success channel demands the SAME localization discipline');
console.log('   as the failure channel — postFrom on both sides, measured.');
