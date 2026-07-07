'use strict';
/*
 * alias-ring-probe.js — G4 : le ring d'alias APPRIS. Protocole pré-enregistré + patches Laurie :
 * PROTOCOL-G4-alias-ring.md (les 5 patches pliés) · sota/2026-07-03-alias-ring-g4-laurie.md.
 *
 * La porte au grain VOCABULAIRE (une porte, trois grains — l'invariant V3) :
 *   OOV (snapToVocab, exogène : la prose SOURCE porte la variante) → proposition modèle (1 call,
 *   context-free, facet-worded, sans grammaire — règle RUN-2) → INTERVENTION CONTREFACTUELLE PER-UNIT
 *   (β — exacte car le matcher est déterministe, 0 call : u admissible ssi verdict(P) ∧ ¬verdict(P∖{u}),
 *   scoré TREILLIS-PUR, fallback OFF — patch V2) → admission PROVISOIRE (mergeRingProposals,
 *   via='learned:llm', support=1) → CONFIRMATION à support≥2 (creditRingAlias sur ré-usages vérifiés —
 *   patch V1) → blame localisé ultérieur → retractRingAlias (la récupérabilité).
 * L'intake G4 extrait les surfaces VERBATIM (open-vocab) — le RING canonicalise, pas le modèle (patch V6).
 * Arms : GATED (la porte) vs UNGATED (admet la proposition telle quelle — le foil ; sur tokens
 * plantés-corrects UNGATED==GATED est PRÉ-ENREGISTRÉ : l'amortissement, pas le drift — patch V4).
 *
 * CYCLES DE CRITIQUE (run-1, replay memo — chacun un finding, consignés au LOG §G4) :
 *   C1 une proposition NULLE (« neither ») comptait comme pending → quarantaine gonflée (bug instrument) ;
 *   C2 l'intake open-vocab met la COULEUR dans `condition` (« liquefied green », « condition:"red" ») →
 *      dé-confound déterministe par soustraction de la facette color DÉCLARÉE (extraite du même intake) ;
 *   C3 la paraphrase synonym-hop TOUT (round→circular partout, ball→sphere, damp→moist) → ≥2 OOV réels
 *      par épisode : la quarantaine générale auto-scellait — remplacée par l'intervention per-unit
 *      (Laurie V3-β) ; la quarantaine RESTE pour les cellules non-attribuables (verdict(P) faux ∧ >1).
 *   negMemo restreint à 'no-proposal' (context-free, stable) — vacuous/failed-verify sont ÉPISODE-relatifs
 *   (les sceller = l'auto-scellement V2) ; le cache de propositions borne les CALLS à ≤1/(key,token).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const POP = path.resolve(__dirname, '../2026-07-03-population-scale');
const { DOMAINS } = require('./riddle-probe-2.js');
const { lattice } = require(__dirname + '/../2026-07-03-restriction-learning/learn-core.js');
const { snapToVocab } = require(ROOT + '/lib/authoring/canon.js');
const { freezeRegistry, specForKey, mergeRingProposals, retractRingAlias, decideRingAdmission, creditRingAlias } = require(ROOT + '/lib/authoring/registry.js');
const { slotPostFrom, attributeSlotCredit, attributeSlotBlame } = require(ROOT + '/lib/authoring/parametric.js');
const { compileEnumMap, normToken } = require(ROOT + '/lib/providers/canonicalize.js');
const { makeDurableAsk } = require(POP + '/ask-memo.js');
console.info = console.warn = () => {};

const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const D = DOMAINS.shapes;

// ── the ABLATED domain: authored ALIAS entries removed (true isa edges kept) — the aliases must be LEARNED
const ALIAS_ABLATED = ['sphere', 'die', 'circular', 'circle', 'spherical', 'rectangular'];
const ISA = Object.fromEntries(Object.entries(D.isa).filter(( [k] ) => !ALIAS_ABLATED.includes(k) ));
const L = lattice(ISA);
const KINDS = Object.keys(ISA);
const HOLEW = ['star', 'square', 'round'];
const CONDS = Object.keys(D.defeaters);                                    // [deflated, melted]
const FACET = { kind: 'object kind word', holeName: 'hole shape word', condition: 'object condition word' };

const mkRegistry = () => freezeRegistry({ version: null, frozen: false, conflicts: [], keys: {
	kind: { tier: 1, enum: KINDS.slice() },
	holeName: { tier: 1, enum: HOLEW.slice() },
	condition: { tier: 1, enum: CONDS.slice() },
} }, 'v1');

// ── the episode stream (planted variants, SINGLE variant per episode = dé-confondu by construction — V1)
const COLORS = ['yellow', 'red', 'blue', 'green'];
const holes3 = ( third ) => [{ w: 'star-shaped', cat: 'star' }, { w: 'square', cat: 'square' }, { w: third || 'round', cat: 'round' }];
const EPISODES = [];
const ep = ( axis, variant, o ) => EPISODES.push(Object.assign({ axis, variant }, o));
[0, 1, 2].forEach(( k ) => ep('kind', 'die', { kindTrue: 'dice', surf: 'die', color: COLORS[k], holes: holes3(), gold: 1 }));
[0, 1, 2].forEach(( k ) => ep('holeName', 'circular', { kindTrue: 'ball', surf: 'ball', color: COLORS[(k + 1) & 3], holes: holes3('circular'), gold: 2 }));
[0, 1, 2].forEach(( k ) => ep('condition', 'liquefied', { kindTrue: 'sugarcube', surf: 'sugar cube', cond: 'liquefied', color: COLORS[(k + 2) & 3], holes: holes3(), gold: null }));
ep('control-invocab', 'deflated', { kindTrue: 'football', surf: 'football', cond: 'deflated', color: 'red', holes: holes3(), gold: null });
[0, 1].forEach(( k ) => ep('benign', 'damp', { kindTrue: 'ball', surf: 'ball', cond: 'damp', color: COLORS[k], holes: holes3(), gold: 2 }));
ep('benign', 'gleaming', { kindTrue: 'marble', surf: 'marble', cond: 'gleaming', color: 'blue', holes: holes3(), gold: 2 });
[0, 1].forEach(( k ) => ep('spont-false', 'waterlogged', { kindTrue: 'ball', surf: 'ball', cond: 'waterlogged', color: COLORS[(k + 3) & 3], holes: holes3(), gold: 2 }));
for ( const t of EPISODES )
	t.prose = `You have a ${t.cond ? t.cond + ' ' : ''}${t.color} ${t.surf}. Put it into one of these holes: `
		+ t.holes.map(( h, k ) => (k === 2 ? 'or the ' : 'the ') + h.w + ' one').join(', ') + '. Which one?';

const ORDERS = [null, 41, 97];
const lcg = ( s ) => { let x = s >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };
const shuffled = ( xs, rnd ) => { const a = xs.slice(); for ( let i = a.length - 1; i > 0; i-- ) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── one-road resolution: exact/containment (snap) → RING (registry) → trials overlay → oov ───────────────
const tok = ( s ) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z-]/g, '').replace(/-/g, '');
function resolveWord( reg, key, raw, vocab, trials ) {
	const t = tok(raw);
	if ( !t ) return { word: null, via: 'empty', tok: t };
	const s = snapToVocab(t, vocab, {});
	if ( s.verdict !== 'oov' ) return { word: String(s.value).toLowerCase(), via: s.verdict, tok: t };
	const tr = trials && trials.find(( u ) => u.key === key && u.tok === t );
	if ( tr ) return { word: tr.member, via: 'trial', tok: t };
	const spec = specForKey(reg, key);
	const hit = spec ? compileEnumMap(spec).map[normToken(t)] : null;
	if ( hit != null ) return { word: String(hit).toLowerCase(), via: 'ring', tok: t };
	return { word: null, via: 'oov', tok: t };
}

// C2 — subtract the DECLARED color facet from the condition surface (the extraction confound, de-confounded
// with the system's own extraction — never an authored stop-list).
function stripColor( cond, color ) {
	const c = tok(color);
	return String(cond == null ? '' : cond).split(/\s+/).filter(( w ) => tok(w) && tok(w) !== c ).join(' ');
}

// the deterministic answer path (layered doctrine for ANSWERING; opts.strict = lattice-pure for SCORING — V2)
function answerEpisode( x, reg, trials, opts ) {
	const exercised = [], oov = [];
	const track = ( r, key ) => {
		if ( r.via === 'ring' || r.via === 'trial' ) exercised.push({ key, tok: r.tok, word: r.word, via: r.via });
		else if ( r.via === 'oov' ) oov.push({ key, tok: r.tok });
		return r.word;
	};
	const out = { exercised, oov };
	// C4 — resolution is TOTAL (no short-circuit): a kind-gap must not mask a hole-gap, or a correct alias
	// fails its verify against an invisible second vocabulary hole (OOV discovery feeds the per-unit gate).
	const kind = track(resolveWord(reg, 'kind', x.object.kind, KINDS, trials), 'kind');
	const cond = track(resolveWord(reg, 'condition', stripColor(x.object.condition, x.object.color), CONDS, trials), 'condition');
	const scored = x.holes.map(( h, i ) => {
		const w = track(resolveWord(reg, 'holeName', h.name, HOLEW, trials), 'holeName');
		return [w ? (D.holeSort[w] || D.cats.find(( c ) => L.leq(w, c) ) || null) : null, h, i];
	});
	let cat = kind ? D.cats.find(( c ) => L.leq(kind, c) ) || null : null;
	if ( !cat && !(opts && opts.strict) ) {                                 // explicit fallback — ANSWER path only
		const e = tok(x.object.category);
		if ( D.cats.includes(e) ) cat = e;
	}
	if ( cat && cond && (D.defeaters[cond] || []).includes(cat) ) return Object.assign(out, { status: 'impracticable', why: 'defeated' });
	if ( !cat ) return Object.assign(out, { status: 'impracticable', why: 'no-category' });
	const ok = scored.filter(( [hc, h] ) => hc === cat && (!h.size || !x.object.size || h.size === x.object.size) );
	if ( ok.length === 1 ) return Object.assign(out, { status: 'mounted', hole: ok[0][2] });
	if ( !ok.length ) return Object.assign(out, { status: 'impracticable', why: 'no-hole' });
	return Object.assign(out, { status: 'ambiguous' });
}
const verdictOf = ( t, ans ) => t.gold == null ? ans.status === 'impracticable' : (ans.status === 'mounted' && ans.hole === t.gold);

// spec-truth of a variant (REPORTING oracle only — die→dice|cube both spec-true; benign/waterlogged: none)
function trueMemberOf( key, t ) {
	if ( key === 'kind' && t === 'die' ) return ['dice', 'cube'];
	if ( key === 'kind' && t === 'sphere' ) return ['ball'];
	if ( key === 'holeName' && String(t).includes('circular') ) return ['round'];
	if ( key === 'condition' && String(t).includes('liquefied') ) return ['melted'];
	return [];
}

// ── the OPEN-VOCAB intake (V6: surfaces verbatim — the ring canonicalizes, never the model) ──────────────
async function intakeOpen( ask, prose ) {
	const txt = await ask({
		system: 'You extract the structure of a placement puzzle. Copy the words AS WRITTEN in the text (do not normalize).'
			+ ' Reply ONLY JSON: {"object":{"kind":"<the object noun as written>","category":"<its shape word if directly stated, else \\"\\">",'
			+ '"condition":"<its state/condition adjective as written, or \\"\\">","color":"<or \\"\\">","size":"<small|large|\\"\\">"},'
			+ '"holes":[{"name":"<the hole description word as written>","size":"<small|large|\\"\\">"}]}',
		user: prose, maxTokens: 170,
		grammar: { jsonSchema: { type: 'object', properties: {
			object: { type: 'object', properties: { kind: { type: 'string' }, category: { type: 'string' }, condition: { type: 'string' }, color: { type: 'string' }, size: { type: 'string' } },
				required: ['kind', 'category', 'condition', 'color', 'size'] },
			holes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, size: { type: 'string' } }, required: ['name', 'size'] } },
		}, required: ['object', 'holes'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch ( e ) { return null; }
}

// context-FREE alias proposal (an alias is a property of the LANGUAGE, not the episode — unlike an isa edge);
// facet-worded (the ratchet lesson) · no grammar at the semantic touchpoint (RUN-2 collapse, 3× reproduced).
async function proposeAlias( ask, key, token ) {
	const members = (key === 'kind' ? KINDS : key === 'holeName' ? HOLEW : CONDS).join('|');
	const txt = await ask({
		system: 'Vocabulary question. Reply ONLY JSON: {"word":"' + token + '","means":"<one of the options, or neither>"}',
		user: `The word "${token}" used as a ${FACET[key]} — which of these does it mean: ${members}, or neither?`, maxTokens: 40,
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); const v = tok(JSON.parse(m ? m[0] : txt).means); return v && v !== 'neither' ? v : null; } catch ( e ) { return null; }
}

// ── the per-arm episode step ─────────────────────────────────────────────────────────────────────────────
// GATED: per-unit counterfactual intervention (C3): u admissible ⟺ verdict(P) ∧ ¬verdict(P∖{u}), lattice-pure.
// UNGATED: admit every proposed mapping as-is (the naive foil).
function step( arm, t, x, S, pend ) {
	const A = S.M[arm];
	const admitted = [];
	if ( arm === 'ungated' ) {
		for ( const u of pend ) {
			const r = mergeRingProposals(S.reg[arm], [{ key: u.key, alias: u.tok, member: u.member, via: 'ungated' }]);
			S.reg[arm] = r.registry;
			if ( r.admitted.length ) { admitted.push(u); A.admits.push(u); }
		}
	}
	else if ( pend.length ) {
		const vP = verdictOf(t, answerEpisode(x, S.reg[arm], pend, { strict: true }));
		if ( !vP ) { if ( pend.length > 1 ) A.quarantinedMulti++; else A.refused['failed-verify']++; }
		else for ( const u of pend ) {
			const rest = pend.filter(( v ) => v !== u );
			const wo = verdictOf(t, answerEpisode(x, S.reg[arm], rest, { strict: true }));
			const woLayered = verdictOf(t, answerEpisode(x, S.reg[arm], rest, {}));
			if ( !wo && woLayered ) A.maskAvoided++;                          // V2: the fallback would have masked
			const d = decideRingAdmission({ member: u.member, withAlias: vP, withoutAlias: wo });
			if ( d.admit ) {
				const members = u.key === 'kind' ? KINDS : u.key === 'holeName' ? HOLEW : CONDS;
				const equivalents = members.filter(( m ) => verdictOf(t,
					answerEpisode(x, S.reg[arm], rest.concat({ key: u.key, tok: u.tok, member: m }), { strict: true })) ).length;
				const r = mergeRingProposals(S.reg[arm], [{ key: u.key, alias: u.tok, member: u.member, via: 'learned:llm' }]);
				if ( r.admitted.length ) {
					S.reg[arm] = creditRingAlias(r.registry, u.key, u.tok).registry;   // support=1 → PROVISOIRE (V1)
					admitted.push(Object.assign({ equivalents }, u));
					A.admits.push({ key: u.key, tok: u.tok, member: u.member, equivalents });
				} else A.refused['confluence']++;
			}
			else A.refused[d.reason]++;                                       // episode-relative → NEVER negMemo'd (V2)
		}
		// LOCALIZATION receipts (8d, the credit brick): the admitted units are the creditable roles
		const { postSlots } = slotPostFrom(Object.fromEntries(pend.map(( u ) => [u.key, ['alias:' + u.key + ':' + u.tok]] )));
		const credit = attributeSlotCredit({ postSlots, verifiedAtoms: admitted.map(( u ) => 'alias:' + u.key + ':' + u.tok ) });
		if ( credit.roles.length !== admitted.length ) A.creditMismatch = (A.creditMismatch || 0) + 1;   // sanity: expect 0
	}
	for ( const u of admitted ) if ( !trueMemberOf(u.key, u.tok).includes(u.member) )
		A.wrongAdmits.push(u.key + ':' + u.tok + '→' + u.member);            // GATED expected: NONE
	// ANSWER the episode (layered doctrine; GATED uses only the ring — a refused trial is never used)
	const ans = answerEpisode(x, S.reg[arm], arm === 'ungated' ? pend : null, {});
	const ok = verdictOf(t, ans);
	A.res[ok ? 'ok' : ans.status === 'impracticable' ? 'refusedTask' : 'wrong']++;
	if ( S.trace ) S.trace.push({ arm, ep: t.axis + '/' + t.variant, gold: t.gold, pend: pend.map(( u ) => u.key + ':' + u.tok + '→' + u.member ),
		admitted: admitted.map(( u ) => u.key + ':' + u.tok ), status: ans.status + (ans.why ? ':' + ans.why : ''), hole: ans.hole, ok,
		exercised: ans.exercised.map(( e ) => e.via + ':' + e.key + ':' + e.tok + '→' + e.word ) });
	const admittedNow = ( e ) => admitted.some(( u ) => u.key === e.key && u.tok === e.tok );
	const learned = ans.exercised.filter(( e ) => e.via === 'ring' && S.reg[arm].ringProvenance && S.reg[arm].ringProvenance[e.key + '::' + normToken(e.tok)] );
	if ( ok ) for ( const e of learned ) {                                   // verified reuse → CONFIRMATION channel (V1)
		if ( admittedNow(e) ) continue;                                      // the admitting episode counted once
		const c = creditRingAlias(S.reg[arm], e.key, e.tok);
		S.reg[arm] = c.registry;
		if ( arm === 'gated' && c.support === 2 ) {
			A.confirmed.push(e.key + ':' + e.tok + '→' + c.member);
			if ( !trueMemberOf(e.key, e.tok).includes(c.member) ) A.falseConfirmed.push(e.key + ':' + e.tok + '→' + c.member);
		}
	}
	if ( !ok && learned.length ) {                                           // failure through persisted aliases
		A.damage++;                                                          // wrong/refused-from-persisted, 0-call — the silent channel
		if ( arm === 'gated' ) {
			// C5 — the ratchet tooth at blame time: an episode carrying UNRESOLVED OOV has an UNKNOWN co-present
			// cause → the failure is NOT localizable to the exercised alias (8d/H3: unknown → inadmissible).
			// Without this, hole-vocabulary attrition wrong-blames a CORRECT alias (sphere→ball oscillated).
			const ps = Object.fromEntries(learned.map(( e ) => ['alias:' + e.key + ':' + e.tok, e.key] ));
			const blame = attributeSlotBlame({ postSlots: ps, failedAtoms: learned.map(( e ) => 'alias:' + e.key + ':' + e.tok ) });
			if ( blame.admissible && !ans.oov.length ) {                     // localized ∧ no unknown cause → RETRACT
				const e = learned[0];
				S.reg[arm] = retractRingAlias(S.reg[arm], e.key, e.tok).registry;
				A.blameRetracts.push(e.key + ':' + e.tok);
			} else A.blameUnlocalized = (A.blameUnlocalized || 0) + 1;       // counted, never silent
		}
	}
}

// ── the deterministic CONTROL (0 GPU): the recoverable envelope + the per-unit intervention teeth ────────
function deterministicControl() {
	const C = { checks: [], pass: 0 };
	const chk = ( name, cond ) => { C.checks.push({ name, pass: !!cond }); if ( cond ) C.pass++; };
	// 1. confound-plant (V1): the teeth pass on a confounded episode → PROVISOIRE only; the next dé-confondu
	//    exercise fails → localized blame → retract → the correct proposal is admissible (de-lock).
	let reg = mkRegistry();
	const d1 = decideRingAdmission({ member: 'deflated', withAlias: true, withoutAlias: false });
	chk('confound passes the teeth (the V1 hole is REAL)', d1.admit);
	reg = creditRingAlias(mergeRingProposals(reg, [{ key: 'condition', alias: 'damp', member: 'deflated', via: 'learned:llm' }]).registry, 'condition', 'damp').registry;
	chk('…but only PROVISOIRE (support=1, at-risk)', reg.ringProvenance['condition::damp'].support === 1);
	const blame = attributeSlotBlame({ postSlots: { 'alias:condition:damp': 'condition' }, failedAtoms: ['alias:condition:damp'] });
	chk('dé-confondu failure → blame localizes', blame.admissible && blame.role === 'condition');
	reg = retractRingAlias(reg, 'condition', 'damp').registry;
	chk('retract → the false alias never reaches CONFIRMED', !reg.ringProvenance['condition::damp'] && !(reg.keys.condition.synonyms || {}).deflated);
	// 2. per-unit intervention (C3, Laurie V3-β) on a synthetic two-pending episode: die + circular-hole on a
	//    DIE task (gold square) — die is load-bearing, circular is episode-vacuous (the round hole is idle).
	const x2 = { object: { kind: 'die', category: '', condition: '', color: '', size: '' },
		holes: [{ name: 'star-shaped', size: '' }, { name: 'square', size: '' }, { name: 'circular', size: '' }] };
	const t2 = { gold: 1 };
	const P = [{ key: 'kind', tok: 'die', member: 'dice' }, { key: 'holeName', tok: 'circular', member: 'round' }];
	const vP = verdictOf(t2, answerEpisode(x2, mkRegistry(), P, { strict: true }));
	const woDie = verdictOf(t2, answerEpisode(x2, mkRegistry(), [P[1]], { strict: true }));
	const woCirc = verdictOf(t2, answerEpisode(x2, mkRegistry(), [P[0]], { strict: true }));
	chk('two pendings: verdict(P) passes', vP === true);
	chk('die is load-bearing (drop it → fail) → admissible', woDie === false && decideRingAdmission({ member: 'dice', withAlias: vP, withoutAlias: woDie }).admit);
	chk('circular is episode-vacuous (round hole idle on a die task) → refused HERE, learnable on ITS episodes', woCirc === true
		&& decideRingAdmission({ member: 'round', withAlias: vP, withoutAlias: woCirc }).reason === 'vacuous');
	// 3. non-attributable cell: verdict(P) FAILS with >1 pending → quarantine (no per-unit admission).
	const bad = [{ key: 'kind', tok: 'die', member: 'marble' }, { key: 'holeName', tok: 'circular', member: 'star' }];
	chk('verdict(P) false ∧ multi → quarantine (nothing admitted)', verdictOf(t2, answerEpisode(x2, mkRegistry(), bad, { strict: true })) === false);
	// 4. vacuity + fallback masking (V2): explicit category makes layered no-alias PASS while strict FAILS.
	const x4 = { object: { kind: 'die', category: 'square', condition: '', color: '', size: '' },
		holes: [{ name: 'star-shaped', size: '' }, { name: 'square', size: '' }, { name: 'round', size: '' }] };
	const woLayered = verdictOf({ gold: 1 }, answerEpisode(x4, mkRegistry(), null, {}));
	const woStrict = verdictOf({ gold: 1 }, answerEpisode(x4, mkRegistry(), null, { strict: true }));
	const w4 = verdictOf({ gold: 1 }, answerEpisode(x4, mkRegistry(), [{ key: 'kind', tok: 'die', member: 'dice' }], { strict: true }));
	chk('fallback masks (layered no-alias passes)', woLayered === true);
	chk('strict scoring unmasks (no-alias fails, alias passes → admissible)', woStrict === false && w4 === true
		&& decideRingAdmission({ member: 'dice', withAlias: w4, withoutAlias: woStrict }).admit);
	// 5. C2 — the color-in-condition confound is subtracted with the declared facet.
	chk('stripColor: "liquefied green"⊖green → liquefied', stripColor('liquefied green', 'green') === 'liquefied');
	chk('stripColor: "red"⊖red → empty (a pure color leak resolves to no condition)', stripColor('red', 'red') === '');
	return C;
}

( async function main() {
	const control = deterministicControl();
	console.log('══ CONTRÔLE DÉTERMINISTE ══  ' + control.pass + '/' + control.checks.length);
	for ( const c of control.checks ) console.log('  ' + (c.pass ? '✓' : '✗ FAIL') + ' ' + c.name);

	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const { ask } = makeDurableAsk(raw, { dir: path.join(__dirname, 'memo'), meta: { modelPath: path.basename(MODEL_PATH), seed: 0, reasoningBudget: 0 } });

	const report = { control: { pass: control.pass, of: control.checks.length } };
	for ( const [oi, seed] of ORDERS.entries() ) {
		const stream = seed == null ? EPISODES : shuffled(EPISODES, lcg(seed));
		const cell = 'shapes/order' + oi;
		const mkM = () => ({ admits: [], confirmed: [], falseConfirmed: [], wrongAdmits: [], blameRetracts: [],
			refused: { vacuous: 0, 'failed-verify': 0, 'no-proposal': 0, confluence: 0 }, quarantinedMulti: 0,
			maskAvoided: 0, damage: 0, res: { ok: 0, refusedTask: 0, wrong: 0 }, proposalCalls: 0, reProposalAvoided: 0, attrition: 0 });
		const S = { reg: { gated: mkRegistry(), ungated: mkRegistry() }, negMemo: { gated: new Map(), ungated: new Map() },
			proposals: { gated: new Map(), ungated: new Map() }, M: { gated: mkM(), ungated: mkM() }, trace: [] };
		for ( const t of stream ) {
			const prose = String(await ask({ system: 'Reword this puzzle in a different natural style, SAME facts, SAME question. Reply ONLY the reworded text.', user: t.prose, maxTokens: 120 })).trim();
			const x = await intakeOpen(ask, prose);
			if ( !x ) { S.M.gated.attrition++; S.M.ungated.attrition++; continue; }
			const surfaced = [x.object.kind, x.object.condition].concat(x.holes.map(( h ) => h.name )).map(tok);
			const lost = !surfaced.some(( s ) => s && s.includes(t.variant) );
			for ( const arm of ['gated', 'ungated'] ) {
				const A = S.M[arm];
				if ( lost && t.axis !== 'control-invocab' ) A.attrition++;    // the exposure did not survive → counted, never silent
				// resolve proposals (≤1 CALL per (key,token) via the cache; negMemo ONLY for 'no-proposal' — C1/V5)
				const dry = answerEpisode(x, S.reg[arm], null, {});
				const pend = [];
				for ( const o of dry.oov ) {
					const k = o.key + '::' + o.tok;
					if ( S.negMemo[arm].has(k) ) { A.reProposalAvoided++; continue; }
					let member;
					if ( S.proposals[arm].has(k) ) { A.reProposalAvoided++; member = S.proposals[arm].get(k); }
					else { member = await proposeAlias(ask, o.key, o.tok); S.proposals[arm].set(k, member); A.proposalCalls++; }
					if ( member == null ) { A.refused['no-proposal']++; S.negMemo[arm].set(k, 'no-proposal'); }
					else pend.push({ key: o.key, tok: o.tok, member });
				}
				step(arm, t, x, S, pend);
			}
		}
		for ( const arm of ['gated', 'ungated'] ) {                          // at-risk: admitted, never re-exercised (V1)
			const M = S.M[arm], prov = S.reg[arm].ringProvenance || {};
			M.neverReExercised = Object.entries(prov).filter(( [, p] ) => (p.support || 0) < 2 ).map(( [k] ) => k );
			M.finalRing = Object.fromEntries(Object.entries(S.reg[arm].keys).filter(( [, e] ) => e.synonyms ).map(( [k, e] ) => [k, e.synonyms] ));
		}
		report[cell] = S.M;
		report[cell].trace = S.trace;
	}

	console.log('\n══ G4 ALIAS-RING — GATED (la porte) vs UNGATED (admet la proposition) ══');
	for ( const [cell, M] of Object.entries(report) ) {
		if ( cell === 'control' ) continue;
		for ( const arm of ['gated', 'ungated'] ) {
			const A = M[arm];
			console.log(`  ${cell}/${arm.padEnd(7)} admits [${(A.admits || []).map(( a ) => a.key + ':' + a.tok + '→' + a.member + '(eq' + a.equivalents + ')' ) }]`
				+ (arm === 'gated' ? ` confirmed [${A.confirmed}] FALSE-confirmed [${A.falseConfirmed}] wrong-admits [${A.wrongAdmits}] retracts [${A.blameRetracts}]` : ` WRONG-admits [${A.wrongAdmits}]`)
				+ `\n           refused ${JSON.stringify(A.refused)} quarantine ${A.quarantinedMulti} maskAvoided ${A.maskAvoided}`
				+ ` res ${JSON.stringify(A.res)} damage ${A.damage} calls ${A.proposalCalls} reProposAvoided ${A.reProposalAvoided} attrition ${A.attrition}`
				+ ` atRisk [${A.neverReExercised}] ring ${JSON.stringify(A.finalRing)}`);
		}
	}
	fs.writeFileSync(path.join(__dirname, 'RESULTS-alias-ring' + (process.env.OUT_SUFFIX || '') + '.json'), JSON.stringify(report, null, 1));
	console.log('wrote RESULTS-alias-ring' + (process.env.OUT_SUFFIX || '') + '.json');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
