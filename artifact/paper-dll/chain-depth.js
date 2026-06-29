'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the COMPOSITION-DEPTH study: how compounded staleness and the recovery tax scale with the
 * LENGTH of a learned method chain. M4.4 measured a fixed 2-link chain; this generalizes to an L-link chain
 *     link 1: decide  -> approve | reject              (approve iff score=high AND compliant)
 *     link i: step_i  -> y_i | n_i   (y_i iff link i-1 is positive)   for i = 2..L
 * so the WHOLE chain is positive iff (score=high AND compliant). An upstream audit flip (approve->reject)
 * cascades to neg at every downstream link. Ground truth is known for every link.
 *
 * The hypothesis (measured, not asserted): STRUCT's Pareto advantage GROWS with L —
 *   - a surface memory (CBR-L) is stale at ALL L links on the drifted class: compounding DEPTH = L (∝ L);
 *   - per-link-cost archetypes (Naive-L, Reflexion-L) pay O(L·N) calls;
 *   - STRUCT-L recovers all L links and its drift-tax is O(1) in L — the cascade re-derives only link 1
 *     (reject); every downstream re-derivation is ELIDED because link i is keyed on its read-set
 *     {kind,region,prev-outcome}, and the flipped class's neg chain reuses the low-score sibling's entries.
 *
 * Self-contained (own tiny harness) so the published 2-link files stay untouched. Reuses the real engine
 * primitives: canonicalize.digest (K1 typed key) + contract.satisfies (the defeasance check).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { digest } = require(ROOT + '/lib/providers/canonicalize.js');
const C = require(ROOT + '/lib/authoring/contract.js');

const KINDS = ['loan', 'refund', 'wire'], REGIONS = ['EU', 'US', 'APAC'], SCORES = ['high', 'low'], TIERS = ['small', 'large'];
const auditKey = ( r ) => `${r.region}|${r.kind}`;
const typedKey = ( r ) => digest({ kind: r.kind, region: r.region, score: r.score });

// outcome labels: link 1 ∈ {approve,reject}; link i ∈ {y_i, n_i}. "positive" means the chain is still alive.
const posLabel = ( link ) => link === 1 ? 'approve' : 'y' + link;
const negLabel = ( link ) => link === 1 ? 'reject' : 'n' + link;
const isPos = ( link, action ) => action === posLabel(link);

// ── workload (L links) ────────────────────────────────────────────────────────────────────────────
function makeChainWorkload( L, opts = {} ) {
	const kinds = opts.kinds || KINDS, regions = opts.regions || REGIONS, scores = opts.scores || SCORES;
	const heldOutRegion = 'heldOutRegion' in opts ? opts.heldOutRegion : 'APAC';
	const audited = opts.audited || [{ region: 'EU', kind: 'loan' }];
	const preCycles = opts.preCycles != null ? opts.preCycles : 2, postCycles = opts.postCycles != null ? opts.postCycles : 3;
	const auditedSet = new Set(audited.map(( a ) => `${a.region}|${a.kind}`));

	const all = [];
	for ( const kind of kinds ) for ( const region of regions ) for ( const score of scores ) all.push({ kind, region, score });
	const train = all.filter(( c ) => c.region !== heldOutRegion );
	const stream = [];
	const push = ( cls, cycle, phase ) => stream.push({ id: stream.length, index: stream.length, kind: cls.kind,
		region: cls.region, score: cls.score, tier: TIERS[cycle % TIERS.length], phase });
	for ( let c = 0; c < preCycles; c++ ) for ( const cls of train ) push(cls, c, 'pre');
	const auditAt = stream.length;
	for ( let c = 0; c < postCycles; c++ ) for ( const cls of all ) push(cls, c, 'post');

	const activeAuditAt = ( index ) => index >= auditAt ? auditedSet : new Set();
	const chainAlive = ( r ) => r.score === 'high' && !activeAuditAt(r.index).has(auditKey(r));   // the whole chain positive?
	const truthAt = ( r, link ) => chainAlive(r) ? posLabel(link) : negLabel(link);               // link's correct action
	const flippedAt = ( r ) => r.index >= auditAt && r.score === 'high' && auditedSet.has(auditKey(r));  // same set for all links

	return { L, stream, auditAt, auditedSet, activeAuditAt, chainAlive, truthAt, flippedAt,
		meta: { n: stream.length, preCount: auditAt, postCount: stream.length - auditAt,
			audited: [...auditedSet], driftCases: stream.filter(flippedAt).length } };
}

// ── tiny harness (generic over links) ───────────────────────────────────────────────────────────
function buildPrompt( p ) {
	const r = p.record;
	let user = p.link === 1 ? `decide kind=${r.kind} region=${r.region} tier=${r.tier} score=${r.score}`
		: `step${p.link} kind=${r.kind} region=${r.region} prev=${p.prev}`;
	if ( p.knownAudited && p.knownAudited.size ) user += `\nnon-compliant=[${[...p.knownAudited].join(',')}]`;
	if ( p.skillText ) user += `\nskill="${p.skillText}"`;
	const system = `link ${p.link}: reply one word.`;
	return { system, user, len: system.length + user.length };
}
function oracle( p ) {
	if ( p.forcedAction != null ) return p.forcedAction;
	if ( p.link === 1 ) return ( p.record.score === 'high' && !(p.knownAudited || new Set()).has(auditKey(p.record)) ) ? 'approve' : 'reject';
	return isPos(p.link - 1, p.prev) ? posLabel(p.link) : negLabel(p.link);   // y_i iff prev positive
}
const newCounters = () => ({ calls: 0, tokens: 0, maxContext: 0 });
async function track( c, model, p ) { const { action, len } = await model(p); c.calls++; c.tokens += Math.ceil(len / 4); if ( len > c.maxContext ) c.maxContext = len; return action; }
function makeModel( mode, opts = {} ) {
	if ( mode === 'stub' ) { const orc = opts.oracleFn || oracle; return async ( p ) => ({ action: orc(p), len: buildPrompt(p).len }); }
	const ask = opts.ask; if ( !ask ) throw new Error('live needs ask');
	return async ( p ) => { const bp = buildPrompt(p); const raw = String(await ask({ system: bp.system, user: bp.user, maxTokens: 6, temperature: 0 }) || '').toLowerCase().trim();
		const pos = posLabel(p.link), neg = negLabel(p.link);
		const action = raw.includes(neg) && !raw.includes(pos) ? neg : ( raw.includes(pos) ? pos : neg );
		return { action, len: bp.len }; };
}

// score: per-link drift accuracy; "compounding depth" = how many links are wrong on the drift cases.
function score( actionsByLink, w ) {
	const driftAccByLink = [];
	for ( let link = 1; link <= w.L; link++ ) {
		let n = 0, ok = 0;
		for ( const r of w.stream ) if ( w.flippedAt(r) ) { n++; if ( actionsByLink[link][r.index] === w.truthAt(r, link) ) ok++; }
		driftAccByLink[link] = n ? ok / n : 1;
	}
	const compoundingDepth = driftAccByLink.slice(1).filter(( a ) => a < 1 - 1e-9 ).length;   // # links wrong on drift
	const allOk = ( () => { for ( let link = 1; link <= w.L; link++ ) for ( const r of w.stream )
		if ( actionsByLink[link][r.index] !== w.truthAt(r, link) ) return false; return true; } )();
	return { driftAccByLink, compoundingDepth, allOk };
}

// ── arms (generic over L) ─────────────────────────────────────────────────────────────────────────
const emptyLinks = ( L ) => { const a = []; for ( let i = 1; i <= L; i++ ) a[i] = []; return a; };

// NAIVE-L: re-derive every link of every record with the current audit. L calls/record.
async function naiveL( w, model ) {
	const c = newCounters(), A = emptyLinks(w.L);
	for ( const r of w.stream ) { let prev = null;
		for ( let link = 1; link <= w.L; link++ ) { const act = await track(c, model, { link, record: r, prev, knownAudited: w.activeAuditAt(r.index) }); A[link][r.index] = act; prev = act; } }
	return { name: 'NAIVE-L', calls: c.calls, maxContext: c.maxContext, A };
}

// CBR-L: typed memo of the FULL L-tuple outcome, no defeasance. On drift the key is unchanged -> the whole
// stale chain is served -> wrong at ALL L links (compounding depth = L).
async function cbrL( w, model ) {
	const c = newCounters(), A = emptyLinks(w.L), memo = new Map();
	for ( const r of w.stream ) { const k = typedKey(r);
		if ( memo.has(k) ) { const t = memo.get(k); for ( let link = 1; link <= w.L; link++ ) A[link][r.index] = t[link]; continue; }
		const t = {}; let prev = null;
		for ( let link = 1; link <= w.L; link++ ) { const act = await track(c, model, { link, record: r, prev, knownAudited: w.activeAuditAt(r.index) }); t[link] = act; A[link][r.index] = act; prev = act; }
		memo.set(k, t); }
	return { name: 'CBR-L', calls: c.calls, maxContext: c.maxContext, A };
}

// REFLEXION-L: no memo -> an actor call per record PER LINK. With the steelman failure signal it recovers
// (link 1 corrected -> the chain follows), but pays O(L·N). (Compact: signal on link 1 only; chain follows.)
async function reflexionL( w, model, opts = {} ) {
	const useFeedback = opts.feedback !== false;
	const c = newCounters(), A = emptyLinks(w.L), believed = new Set();
	for ( const r of w.stream ) {
		let d = await track(c, model, { link: 1, record: r, prev: null, knownAudited: believed });
		if ( useFeedback && r.index >= w.auditAt ) { const want = w.truthAt(r, 1);
			if ( d !== want ) { await track(c, model, { link: 1, record: r, forcedAction: want }); believed.add(auditKey(r));
				d = await track(c, model, { link: 1, record: r, prev: null, knownAudited: believed }); } }
		A[1][r.index] = d; let prev = d;
		for ( let link = 2; link <= w.L; link++ ) { const act = await track(c, model, { link, record: r, prev }); A[link][r.index] = act; prev = act; }
	}
	return { name: 'REFLEXION-L', calls: c.calls, maxContext: c.maxContext, A };
}

// STRUCT-L: a memo per link; link i keyed on its READ-SET {kind,region,prev}. Defeasance at link 1
// (re-assert approve=>compliant via contract.satisfies, evict violated). The cascade re-derives ONLY link 1
// (reject); each downstream link's lookup keys on the new (neg) prev and REUSES the low-score sibling's neg
// entry -> elided. So drift-tax is O(1) in L.
async function structL( w, model ) {
	const c = newCounters(), A = emptyLinks(w.L);
	const memo = []; for ( let i = 1; i <= w.L; i++ ) memo[i] = new Map();
	let evicted = false; const blames = [];
	for ( const r of w.stream ) {
		if ( !evicted && r.index >= w.auditAt ) { evicted = true;
			for ( const [k, e] of memo[1] ) { if ( e.action !== 'approve' ) continue;
				const facts = { compliant: !w.auditedSet.has(`${e.region}|${e.kind}`) };
				if ( !C.satisfies(['$compliant'], facts) ) { memo[1].delete(k); blames.push(k); } } }
		let prev = null;
		for ( let link = 1; link <= w.L; link++ ) {
			const key = link === 1 ? typedKey(r) : `${r.kind}|${r.region}|${prev}`;
			let act;
			if ( memo[link].has(key) ) act = memo[link].get(key).action !== undefined ? memo[link].get(key).action : memo[link].get(key);
			else { act = await track(c, model, { link, record: r, prev, knownAudited: w.activeAuditAt(r.index) });
				memo[link].set(key, link === 1 ? { action: act, region: r.region, kind: r.kind } : act); }
			A[link][r.index] = act; prev = act;
		}
	}
	return { name: 'STRUCT-L', calls: c.calls, maxContext: c.maxContext, A, blames };
}

const CHAIN_ARMS = { 'NAIVE-L': naiveL, 'CBR-L': cbrL, 'REFLEXION-L': ( w, m ) => reflexionL(w, m, { feedback: true }), 'STRUCT-L': structL };

module.exports = { makeChainWorkload, CHAIN_ARMS, naiveL, cbrL, reflexionL, structL, score, makeModel, oracle, buildPrompt, typedKey, posLabel, negLabel };
