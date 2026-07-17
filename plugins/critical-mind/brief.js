/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/*
 * brief — the JUDGMENT BRIEF: a pure, deterministic projection of a critique result into the
 * structured dossier a FINAL JUDGE (the host's own LLM) weighs to render a justified decision
 * with a stated certainty.
 *
 * The reframe this implements (owner, 07-17): the graph guarantees the INPUTS of the judgment —
 * arguments that are real (witness-gated, 0-fabrication), traceable (verbatim quotes, ids),
 * attacked-and-standing (the KP-history) — it does NOT judge. Mechanical counts and the margin
 * are a STOP signal, never a proof; weighing arguments is inherently the LLM's job. So the brief
 * carries STRUCTURAL FACTS ONLY (counts, coverage, contestation, frame status) and the judge
 * prompt asks the HOST model to decide and to ground its certainty note in those cited facts.
 * Nothing here self-scores (the Q2 self-audit is refuted ×3), and nothing here re-weighs.
 *
 * Bounded by design (the measured "synthesis is a bounded leaf" finding): texts are capped,
 * the unused-evidence list is truncated WITH an explicit omitted counter (no silent caps).
 *
 * `carry.statements` is the FORWARD contract: the evidence pool re-emitted in the exact
 * "PRO: ..."/"CON: ..." format `critique` accepts, so a re-call (new viewpoints — a plan change,
 * dimensions separated) re-gates the same evidence under the new frame; what does not survive the
 * new perimeter is dropped by the witness gate — the cross-call analog of the JTMS retraction.
 */

const TEXT_CAP = 180;                                   // thesis / statement text in the brief
const QUOTE_CAP = 160;                                  // verbatim witness quotes
const UNUSED_CAP = 8;                                   // unused-evidence rows shown (omitted counter says the rest)

const FRAME_MEANING = {
	FREE: 'the evidence pool was brainstormed by the local model itself — the weakest provenance; treat coverage as suggestive',
	MATERIAL: 'the evidence pool was supplied by the caller — arguments are gated against it, but the pool is only as good as its source',
	DECLARED: 'the caller declared the decision frame (viewpoints); establishment ran against the supplied evidence',
	STOCK: 'the frame comes from a certified stock — the strongest perimeter',
};

const cap = ( s, n ) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/**
 * buildCritiqueBrief(result, opts) → the judgment brief, or null on an error result (pool too small).
 * A pure projection: every quote comes verbatim from result.pool, every fact from the ledger/frame —
 * nothing is fabricated, re-scored or re-weighed here.
 */
function buildCritiqueBrief( result, opts ) {
	if ( !result || result.error ) return null;
	const o = opts || {};
	const textCap = o.textCap || TEXT_CAP, quoteCap = o.quoteCap || QUOTE_CAP, unusedCap = o.unusedCap || UNUSED_CAP;
	const pool = result.pool || [];
	const poolById = {};
	for ( const a of pool ) poolById[a.id] = a;
	const ledger = result.ledger || [];
	const quoteOf = ( id ) => poolById[id] ? { id, quote: cap(poolById[id].text, quoteCap) } : { id };   // unknown id: kept, never invented

	const active = ledger.filter(( e ) => e.status === 'active' && e.witnesses );
	const open = ledger.filter(( e ) => e.status === 'open' );
	const retracted = ledger.filter(( e ) => e.status === 'retracted' );

	const sides = { PRO: [], CON: [] };
	for ( const e of active ) {
		const t = { id: e.key, text: cap(e.text, textCap), origin: e.kind,
			witnesses: (e.witnesses || []).map(quoteOf) };
		if ( e.contested ) { t.contested = true; t.attackedBy = (e.attackers || []).map(( id ) => Object.assign(quoteOf(id), { side: poolById[id] ? poolById[id].side : null }) ); }
		if ( sides[e.side] ) sides[e.side].push(t);
	}

	// evidence cited NOWHERE (neither witness of an active thesis nor anchored attacker): it exists,
	// supports nothing established — the judge should know it is there (uncovered material is a fact).
	const cited = new Set();
	for ( const e of active ) {
		for ( const w of e.witnesses || [] ) cited.add(w);
		for ( const a of e.attackers || [] ) cited.add(a);
	}
	const unused = pool.filter(( a ) => !cited.has(a.id) );

	return {
		question: result.topic,
		frame: { status: result.frameStatus, threshold: result.threshold,
			meaning: FRAME_MEANING[result.frameStatus] || null },
		// the STOP layer — what the mechanical bound rendered, never a weighing
		verdictMechanical: { verdict: result.verdict, basis: result.basis || null,
			note: 'counts are mechanical; the margin is a stop signal below the measured bound, not a proof of the stronger case' },
		signals: {
			counts: result.counts, margin: result.margin,
			belowBound: typeof result.margin === 'number' && typeof result.threshold === 'number' ? result.margin < result.threshold : null,
			pool: { size: pool.length,
				PRO: pool.filter(( a ) => a.side === 'PRO' ).length,
				CON: pool.filter(( a ) => a.side === 'CON' ).length },
			coverage: { witnessesCited: cited.size, poolSize: pool.length },
			theses: { established: active.length, open: open.length, retracted: retracted.length,
				generated: ledger.filter(( e ) => e.kind === 'generated' ).length,
				contested: active.filter(( e ) => e.contested ).length },
			norm: result.norm || null,
		},
		sides,
		open: open.map(( e ) => ({ id: e.key, side: e.side || null, text: cap(e.text, textCap) }) ),
		withdrawn: retracted.map(( e ) => ({ id: e.key, side: e.side || null, text: cap(e.text, textCap),
			note: 'retracted by reconciliation — its support did not survive; do not weigh it, but know it fell' }) ),
		unusedEvidence: { shown: unused.slice(0, unusedCap).map(( a ) => ({ id: a.id, side: a.side, text: cap(a.text, textCap) }) ),
			omitted: Math.max(0, unused.length - unusedCap) },
		synthesis: result.synthesis || {},
		// the FORWARD contract — the pool, re-callable verbatim
		carry: { statements: pool.map(( a ) => a.side + ': ' + a.text ) },
		iteration: {
			addEvidence: 'gather real statements bearing on the OPEN points (or the under-evidenced side) and call `critique` again with statements=[...] — the frame becomes MATERIAL and establishment re-runs',
			splitDimensions: 'if the question mixes disjoint dimensions, call `critique` again once per dimension (or with separated `viewpoints`), forwarding carry.statements so the same evidence re-gates under the new frame',
		},
	};
}

/**
 * renderJudgePrompt(brief) → a SELF-CONTAINED prompt for the host's own model: weigh the brief,
 * render a justified decision, and state a certainty grounded ONLY in the brief's cited facts.
 */
function renderJudgePrompt( brief ) {
	if ( !brief ) return null;
	const L = [];
	L.push('You are the JUDGE of a structured debate. A deterministic critical-mind engine prepared the brief below.');
	L.push('');
	L.push('TRUST RULES (how this brief was built — rely on them):');
	L.push('1. Every quote is VERBATIM from the evidence pool and passed a witness gate: the arguments are real and traceable. None were invented.');
	L.push('2. Counts and margin are MECHANICAL. The margin is a STOP signal (below the bound the engine refuses to decide) — it is NOT proof of the stronger case. Weighing the arguments is YOUR job.');
	L.push('3. A "contested" thesis was SPECIFICALLY attacked by the cited opposing statements. Attacked is not refuted: it stands with partial validity — weigh it against its attackers.');
	L.push('4. A "generated" thesis was proposed by a model but only admitted with real unused witnesses (0-fabrication).');
	L.push('5. OPEN points were never established — treat them as missing evidence, not as arguments.');
	L.push('6. Frame ' + brief.frame.status + ': ' + (brief.frame.meaning || '') + '.');
	L.push('');
	L.push('QUESTION: ' + brief.question);
	L.push('');
	for ( const side of ['PRO', 'CON'] ) {
		const items = (brief.sides[side] || []);
		L.push(side + ' — ' + items.length + ' established thesis(es):');
		for ( const t of items ) {
			L.push('  [' + t.id + '] ' + t.text + (t.origin === 'generated' ? '  (generated, witness-gated)' : ''));
			for ( const w of t.witnesses ) L.push('      witness ' + w.id + ': "' + (w.quote || '(text unavailable)') + '"');
			if ( t.contested ) for ( const a of t.attackedBy ) L.push('      ATTACKED by ' + a.id + ': "' + (a.quote || '(text unavailable)') + '"');
		}
		if ( !items.length ) L.push('  (none established)');
		if ( brief.synthesis[side] ) L.push('  one-line synthesis: ' + brief.synthesis[side]);
		L.push('');
	}
	if ( brief.open.length ) {
		L.push('OPEN (never established — missing evidence):');
		for ( const e of brief.open ) L.push('  [' + e.id + '] (' + (e.side || '?') + ') ' + e.text);
		L.push('');
	}
	if ( brief.withdrawn.length ) {
		L.push('WITHDRAWN (retracted by reconciliation — do not weigh):');
		for ( const e of brief.withdrawn ) L.push('  [' + e.id + '] (' + (e.side || '?') + ') ' + e.text);
		L.push('');
	}
	if ( brief.unusedEvidence.shown.length ) {
		L.push('UNUSED EVIDENCE (in the pool, supports no established thesis' + (brief.unusedEvidence.omitted ? '; ' + brief.unusedEvidence.omitted + ' more omitted' : '') + '):');
		for ( const a of brief.unusedEvidence.shown ) L.push('  ' + a.id + ' (' + a.side + '): "' + a.text + '"');
		L.push('');
	}
	L.push('STRUCTURAL FACTS: counts PRO ' + brief.signals.counts.PRO + ' / CON ' + brief.signals.counts.CON
		+ ' · margin ' + brief.signals.margin + (brief.signals.belowBound ? ' (below the mechanical bound — engine verdict: ' + brief.verdictMechanical.verdict + ')' : '')
		+ ' · pool ' + brief.signals.pool.size + ' (' + brief.signals.pool.PRO + ' PRO / ' + brief.signals.pool.CON + ' CON)'
		+ ' · evidence cited ' + brief.signals.coverage.witnessesCited + '/' + brief.signals.coverage.poolSize
		+ ' · contested ' + brief.signals.theses.contested + ' · open ' + brief.signals.theses.open
		+ (brief.signals.norm ? ' · norm probe: ' + brief.signals.norm.status + (brief.signals.norm.side ? ' (' + brief.signals.norm.side + ')' : '') : ''));
	L.push('');
	L.push('YOUR TASK — weigh the established theses against their attackers and render the judgment. If the question mixes DISJOINT dimensions (e.g. legal vs moral), do NOT force one verdict: answer per dimension (CONDITIONAL), or request a re-run with separated viewpoints.');
	L.push('Reply EXACTLY in this format:');
	L.push('DECISION: PRO | CON | CONDITIONAL | UNDECIDABLE');
	L.push('ON <dimension>: <PRO|CON> — because [thesis ids]   (CONDITIONAL only, one line per dimension)');
	L.push('WHY: 2-6 sentences citing thesis ids [V1] and witness ids (p1, c2). Use ONLY material from this brief.');
	L.push('CERTAINTY: high | moderate | low — grounded in: <the structural facts and standings you relied on (frame status, coverage, contestation, margin)>');
	L.push('NEXT: <optional — what real evidence would raise your certainty (maps to the iteration contract)>');
	return L.join('\n');
}

module.exports = { buildCritiqueBrief, renderJudgePrompt };
