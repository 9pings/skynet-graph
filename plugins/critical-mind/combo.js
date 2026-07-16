'use strict';
/*
 * createCriticalMind — the external critical mind as a combo (C9): split a user question into
 * declared viewpoints, ESTABLISH each one against a statement pool through a witness gate
 * (cap-2 precision, round 1 on the full pool + open points retried on the stance slice — the
 * measured v1.1 ladder), GENERATE the missing theses anchored-by-witnesses (clusters + quarantine +
 * semantic SAME/NEW gate + fuse-to-open), keep everything in a typed LEDGER, and render a
 * certification-aware verdict. An unforced brainstorm builds the FREE pool in TWO steps: list
 * statements unlabeled, then label each one by a single forced choice (PRO|CON|OFF-TOPIC):
 *
 *   frame status FREE (model-brainstormed pool) / MATERIAL (caller statements) / DECLARED
 *   (caller viewpoints) — a MECHANICAL verdict fires only at count margin ≥ 3 (the measured
 *   decidability bound; a certified .sgc perimeter is what buys margin ≥ 2 — measured 24/24);
 *   below the bound the honest output is counts + coverage + UNDECIDED, never a fake verdict.
 *
 * Assembles the measured FULL config of the generative critical loop (WIP campaigns 07-12/07-13:
 * decision ladder by margin · cluster-anchored generation · quarantine · SAME/NEW semantic gate ·
 * fuse witness-transfer to open declared points · 0-fabrication held across all negative
 * controls). The LEDGER is the deliverable; `renderProse` turns it into a readable report and
 * `polish: true` adds ONE bounded rewrite pass constrained to the given content (presentation
 * only — the ledger stays the audit trail).
 *
 * RE-ROOT (v3, the harness cycle wired in — WIP boucle-generative): after exploring the declared
 * perimeter, IF the node is UNCERTAIN (G3 placement: margin below THIS frame's decidability
 * threshold OR a declared point still open — transposed to C9's per-frame threshold so a margin-2
 * node a verdict needs is never left ungenerated) it runs ONE proven generation pass, then
 * RECONCILES the ledger (JTMS: an entry whose witnesses left the pool is retracted, the uniform
 * in-pool test cascading shared support) and decides on the enriched perimeter. `result.rounds` =
 * 1 if the re-root generated, else 0; `result.journal` = the typed delta log. Generation is a
 * SINGLE pass by design — a second generation round inflates the count on an uncertified
 * FREE/MATERIAL frame past the decidability bound by mining majority coverage (the illusion the
 * certified perimeter guards against). The full ledger-driven re-SPLIT (new viewpoints from the
 * generated vocabulary — round 2's distinctive work) awaits the real lattice (P2), out of scope
 * here; this wires the reconcile + re-decide + placement the harness proved, no more.
 *
 * DIALECTIC (v3, opt-in `dialectic: true`) — on a contested node (verdict UNDECIDED), anchored
 * cross-refutation surfaces each established point's OPPOSITE-side attackers (`attackers`) and marks
 * it `contested` (partial validity, the KP-history). It ENRICHES the audit, it does NOT decide: the
 * counts/verdict are never moved (annotation only — the anti-illusion invariant). Proven in harness.
 */

const SYSTEM = 'You are a careful analyst. Follow the output format EXACTLY.';
const GEN_TRIES = 3;
const K_RETRIES = 2;                                                          // v1.1 explore retries (open points → stance slice)
const K_ROUNDS = 2;                                                           // re-root bound (K=2, anti trou-sans-fond) — RESERVED for the future ledger-driven re-SPLIT loop (P2); today the re-root is a single proven generation pass (a 2nd generation round inflates uncertified margins — see run())
const LIST_TRIES = 2;                                                         // brainstorm list step: initial call + ONE bounded "list MORE" re-ask
const MECHANICAL_MARGIN = { FREE: 3, MATERIAL: 3, DECLARED: 3, STOCK: 2 };   // the measured bound

const parseCites = ( raw ) => /cites?:\s*NONE/i.test(String(raw || '')) ? [] : (String(raw || '').match(/[pc]\d+/g) || null);
const poolLines = ( pool ) => pool.map(( a ) => a.id + ': ' + a.text ).join('\n');
const activeCounts = ( ledger ) => { const c = { PRO: 0, CON: 0 }; for ( const e of ledger ) if ( e.status === 'active' && e.witnesses ) c[e.side]++; return c; };

// RE-ROOT reconciliation (JTMS, the harness re-root step + the owner SUIVI/RÉCONCILIATION requirement):
// an active entry whose witnesses no longer ALL live in the pool is RETRACTED. The uniform in-pool test
// gives the cascade for free — if a witness leaves the pool, EVERY entry citing it fails `every(inPool)`
// and falls together (shared-support withdrawal), while an entry retracted for one bad witness never
// drags down entries sharing its still-valid witnesses. On C9's happy path all witnesses are in-pool by
// construction, so this is a no-op; it is the load-bearing guard for injected/stale ledger entries (the
// NEG-ledger control) and the prerequisite for a future ledger-driven re-split (P2). Pure + structural.
function reconcile( ledger, pool, journal ) {
	const inPool = new Set(pool.map(( a ) => a.id ));
	const retracted = [];
	for ( const e of ledger )
		if ( e.status === 'active' && e.witnesses && !e.witnesses.every(( w ) => inPool.has(w) ) ) {
			e.status = 'retracted'; retracted.push(e.key);
			if ( journal ) journal.push('reconcile: RETRACTED ' + e.key + ' (witness left the pool)');
		}
	return retracted;
}

function createCriticalMind( opts ) {
	const ask = opts.ask;
	if ( typeof ask !== 'function' ) throw new Error('createCriticalMind: opts.ask (async {system,user,maxTokens,temperature} → text) is required');
	const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {};

	async function buildPool( topic, statements ) {
		if ( Array.isArray(statements) && statements.length ) {
			const pool = []; let p = 0, c = 0, dropped = 0;
			for ( const s of statements ) {
				const rec = typeof s === 'string' ? (s.match(/^(PRO|CON)\s*:\s*(.+)$/i) || null) : null;
				const side = rec ? rec[1].toUpperCase() : (s && s.side ? String(s.side).toUpperCase() : null);
				const text = rec ? rec[2].trim() : (s && s.text ? String(s.text).trim() : null);
				if ( (side !== 'PRO' && side !== 'CON') || !text ) { dropped++; continue; }
				pool.push({ id: side === 'PRO' ? 'p' + (++p) : 'c' + (++c), side, text });
			}
			if ( dropped ) onStage('POOL', dropped + ' statements dropped (each needs side PRO|CON + text, or a "PRO: ..." line)');
			return { pool, status: 'MATERIAL' };
		}
		// UNFORCED brainstorm, TWO-STEP. Asking the model to list AND label in one pass came back
		// near-empty and mislabeled on the low-quant ("PRO: no framework supports..." is a CON);
		// listing WITHOUT labels first, then labeling each statement by one FORCED CHOICE, is the
		// closed-competition structure that discriminates (yes/no acquiesces — measured, 5×).
		// The pool's PRO/CON distribution must reflect the question, not a forced 10-vs-10 symmetry
		// (lopsided questions must be allowed to produce lopsided pools — the count is the signal).
		// The low-quant often stops the list after 2-3 lines (measured live on a FR topic → pool
		// below the 4-statement floor). Bounded re-ask (the minSteps idiom): ONE "list MORE" retry
		// while under the floor + a margin for forced-choice drops; it never asks to balance sides.
		let cands = [];
		for ( let t = 0; t < LIST_TRIES && cands.length < 6; t++ ) {
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nList the strongest DISTINCT statements informed people ACTUALLY make about this question, whichever side (one concrete argument each, up to 20 lines).'
				+ '\nIf one side has far fewer serious statements, reflect that honestly — do NOT balance the sides artificially.'
				+ (cands.length ? '\nAlready listed (do NOT repeat these):\n' + cands.map(( c ) => '- ' + c ).join('\n')
					+ '\nList UP TO 10 MORE distinct statements, or reply exactly NONE if there are no more serious ones.' : '')
				+ '\nReply one per line, each: S: <one sentence>', maxTokens: 700, temperature: 0 }));
			if ( /^\s*NONE\s*$/i.test(out.trim()) ) break;
			const got = (out.match(/S:\s*[^\n]+/g) || []).map(( l ) => l.replace(/^S:\s*/, '').trim() ).filter(( s ) => s.length >= 5 );
			const before = cands.length;
			for ( const g of got ) if ( !cands.some(( c ) => c.toLowerCase() === g.toLowerCase() ) ) cands.push(g);
			if ( cands.length === before ) break;                                 // no progress → a same-shape retry is a no-op
		}
		cands = cands.slice(0, 24);
		const pool = []; let p = 0, c = 0, off = 0;
		for ( const text of cands ) {
			const lab = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nStatement: ' + text
				+ '\nIn the context of the question, does this statement support answering YES (PRO), support answering NO (CON), or is it OFF-TOPIC?'
				+ '\nReply ONLY one of: PRO | CON | OFF-TOPIC', maxTokens: 8, temperature: 0 }));
			const m = lab.match(/\b(OFF[- ]?TOPIC|PRO|CON)\b/i);
			const side = m && !/OFF/i.test(m[1]) ? m[1].toUpperCase() : null;
			if ( side && (side === 'PRO' ? p : c) < 12 ) pool.push({ id: side === 'PRO' ? 'p' + (++p) : 'c' + (++c), side, text });
			else off++;
		}
		if ( off ) onStage('POOL', off + ' brainstormed statements dropped by the forced-choice label (OFF-TOPIC or unparseable)');
		return { pool, status: 'FREE' };
	}

	async function declareViewpoints( topic, pool, given ) {
		if ( Array.isArray(given) && given.length )
			return given.map(( s, i ) => ({ key: 'V' + (i + 1), side: (s && s.side) ? String(s.side).toUpperCase() : null,
				text: typeof s === 'string' ? s.trim() : String(s.text || '').trim() }) ).filter(( v ) => v.text );
		const vps = [];
		for ( const side of ['PRO', 'CON'] ) {
			const slice = pool.filter(( a ) => a.side === side );
			if ( !slice.length ) continue;
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic + '\n' + side + ' statements:\n' + poolLines(slice)
				+ '\nName the 2 main DISTINCT points of view these statements support. Reply 2 lines, each: V: <short name of the viewpoint>', maxTokens: 80, temperature: 0 }));
			(out.match(/V:\s*[^\n]+/g) || []).slice(0, 2).forEach(( l ) =>
				vps.push({ key: 'V' + (vps.length + 1), side, text: l.replace(/^V:\s*/, '').trim() }) );
		}
		return vps;
	}

	// The measured v1.1 ladder (+14 pts coverage at P=24): round 1 explores every viewpoint against
	// the FULL pool; the points left OPEN are retried on their STANCE SLICE — a structural narrowing
	// (stance = input metadata, never a model output). A same-prompt retry is a no-op at temp 0
	// (measured), so a retry without a narrower slice is skipped, not repeated.
	async function explore( topic, pool, vps, ledger, journal ) {
		const leaf = async ( v, slice ) => {
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nPoint of view' + (v.side ? ' (' + v.side + ')' : '') + ': ' + v.text
				+ '\nStatements:\n' + poolLines(slice)
				+ '\nWhich statements GENUINELY make this exact point (not merely the same side)? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 }));
			// stance gate on cites (metadata): an opposite-side cite is dropped, never admitted
			return (parseCites(out) || []).filter(( x ) => slice.some(( a ) => a.id === x && (!v.side || a.side === v.side) ) );
		};
		const establish = ( entry, ids, how ) => {
			entry.witnesses = ids.slice(0, 2); entry.status = 'active';
			if ( !entry.side ) entry.side = pool.find(( a ) => a.id === ids[0] ).side;
			onStage('EXPLORE', entry.key + ' → established (' + entry.witnesses.join('+') + how + ')');
			journal.push('R0 established ' + entry.key + ' (' + entry.side + ', ' + entry.witnesses.join('+') + how + ')');
		};
		let pending = [];
		for ( const v of vps ) {
			const entry = { key: v.key, kind: 'declared', side: v.side || null, text: v.text, witnesses: null, status: 'open', round: 0, provenance: 'declared' };
			ledger.push(entry);
			const ids = await leaf(v, pool);
			if ( ids.length ) establish(entry, ids, '');
			else pending.push({ v, entry });
		}
		for ( let r = 0; r < K_RETRIES && pending.length; r++ ) {
			const next = [];
			for ( const { v, entry } of pending ) {
				const slice = v.side ? pool.filter(( a ) => a.side === v.side ) : [];
				if ( !slice.length || slice.length === pool.length ) { onStage('EXPLORE', entry.key + ' → OPEN (no narrower slice to retry on)'); continue; }
				const ids = await leaf(v, slice);
				if ( ids.length ) establish(entry, ids, ', retry ' + (r + 1));
				else next.push({ v, entry });
			}
			pending = next;
		}
		for ( const { entry } of pending ) { onStage('EXPLORE', entry.key + ' → OPEN'); journal.push('R0 open ' + entry.key + ' (' + (entry.side || '?') + ', no valid witnesses)'); }
	}

	async function generate( topic, pool, ledger, round, journal ) {
		const usedArgs = new Set(ledger.flatMap(( e ) => e.witnesses || [] ));
		for ( const side of ['PRO', 'CON'] ) {
			const tried = new Set();
			for ( let i = 0; i < GEN_TRIES; i++ ) {
				const unused = pool.filter(( a ) => a.side === side && !usedArgs.has(a.id) && !tried.has(a.id) );
				if ( unused.length < 2 ) break;
				const seed = unused[0]; tried.add(seed.id);
				const others = unused.filter(( a ) => a.id !== seed.id );
				const cOut = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
					+ '\nCandidate point (' + side + '): ' + seed.text
					+ '\nStatements:\n' + poolLines(others)
					+ '\nWhich statements GENUINELY make this exact point (not merely the same side)? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 }));
				const cIds = (parseCites(cOut) || []).filter(( x ) => others.some(( a ) => a.id === x ) );
				const slate = cIds.length ? unused.filter(( a ) => a.id === seed.id || cIds.includes(a.id) ) : unused;
				const table = ledger.filter(( e ) => e.side === side && (e.kind === 'declared' || e.status === 'active') ).map(( e ) => '- ' + e.text.slice(0, 90) );
				const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
					+ '\nKnown ' + side + ' points (already on the table):\n' + table.join('\n')
					+ '\nUNUSED statements:\n' + poolLines(slate)
					+ '\nPropose ONE NEW ' + side + ' point of view, DIFFERENT from the known points, that at least TWO of these unused statements genuinely make. '
					+ '\nReply ONE line, format: THESIS: <one short sentence> | cites: id, id   (or exactly: NONE)', maxTokens: 80, temperature: 0 }));
				(String(out).match(/[pc]\d+/g) || []).filter(( x ) => pool.some(( a ) => a.id === x ) ).forEach(( x ) => tried.add(x) );
				const srcLine = [...String(out).split(/\n/).map(( l ) => l.trim() ).filter(Boolean)].reverse().find(( l ) => /THESIS:/i.test(l) || /^NONE$/i.test(l) ) || String(out);
				if ( /^\s*NONE\s*$/i.test(srcLine) ) { onStage('GEN', side + ': honest NONE'); break; }
				const mT = srcLine.match(/THESIS:\s*([^|]{5,200})\|/i);
				const ids = [...new Set(parseCites(srcLine) || [])].filter(( x ) => pool.some(( a ) => a.id === x && a.side === side ) && !usedArgs.has(x) );
				if ( !mT || ids.length < 2 ) { onStage('GEN', side + ': gate refusal (needs ≥2 unused in-pool witnesses)'); continue; }
				const overlap = ledger.find(( e ) => e.status === 'active' && e.witnesses && ids.filter(( x ) => e.witnesses.includes(x) ).length / ids.length >= 0.5 );
				if ( overlap ) { onStage('GEN', side + ': merged into ' + overlap.key); continue; }
				const declared = ledger.filter(( e ) => e.kind === 'declared' );
				const cls = String(await ask({ system: SYSTEM, user: 'Known points:\n' + declared.map(( e, di ) => (di + 1) + '. ' + e.text.slice(0, 90) ).join('\n')
					+ '\nCandidate thesis: ' + mT[1].trim()
					+ '\nIs the candidate just a restatement of one known point?\nReply with ONLY: SAME <number> or NEW.', maxTokens: 8, temperature: 0 }));
				const mS = cls.match(/SAME\s*(\d)/i);
				if ( mS ) {
					const target = declared[Number(mS[1]) - 1];
					if ( target && target.status === 'open' && target.side === side ) {     // fuse: redundancy TRANSPORTS coverage
						target.witnesses = ids.slice(0, 2); target.status = 'active';
						ids.forEach(( x ) => usedArgs.add(x) );
						onStage('GEN', side + ': fuse — ' + target.key + ' open→established');
						journal.push('R' + round + ' fuse ' + target.key + ' open→established (' + target.witnesses.join('+') + ')');
					} else onStage('GEN', side + ': semantic SAME as ' + (target ? target.key : '?') + ' — dropped');
					continue;
				}
				const key = 'G' + (ledger.filter(( e ) => e.kind === 'generated' ).length + 1);
				ledger.push({ key, kind: 'generated', side, text: mT[1].trim(), witnesses: ids.slice(0, 3), status: 'active', round, provenance: 'generated+witnesses' });
				ids.forEach(( x ) => usedArgs.add(x) );
				onStage('GEN', side + ': NEW ' + key + ' (' + ids.slice(0, 3).join('+') + ')');
				journal.push('R' + round + ' gen-NEW ' + key + ' (' + side + ', ' + ids.slice(0, 3).join('+') + ')');
			}
		}
	}

	// DIALECTIC (v3, opt-in `dialectic: true`) — anchored cross-refutation on a CONTESTED node (verdict
	// UNDECIDED): for each established viewpoint, the OPPOSITE-side statements that SPECIFICALLY contradict
	// it become anchored `attackers` (the same classification-on-given-text family as explore, stance-gated
	// — never the refuted Q2 auto-audit). An attacked point stays ACTIVE but `contested` (partial validity
	// — the KP-history): the counts/verdict are NEVER moved (annotation only, the anti-illusion invariant);
	// the synthesis renders it as diminished. Proven in harness (WIP 2026-07-13-c9v3-dialectique: anchoring
	// 100%, 0 decision moved, NEG menteur/brouille clean). Placement: contested nodes only (the CQ finding).
	async function crossRefute( topic, pool, ledger ) {
		for ( const e of ledger.filter(( x ) => x.status === 'active' && x.witnesses ) ) {
			const oppSide = e.side === 'PRO' ? 'CON' : 'PRO';
			const slice = pool.filter(( a ) => a.side === oppSide );
			if ( !slice.length ) continue;
			const out = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nEstablished point (' + e.side + '): ' + e.text
				+ '\nOpposing statements:\n' + poolLines(slice)
				+ '\nWhich of these statements SPECIFICALLY CONTRADICT the established point (make it false or insufficient), not merely argue the other side? Cite AT MOST 2. Reply ONE line, format: cites: ids_or_NONE', maxTokens: 48, temperature: 0 }));
			// stance + in-pool gate on the attackers; never the point's own witnesses
			const att = (parseCites(out) || []).filter(( x ) => slice.some(( a ) => a.id === x ) && !(e.witnesses || []).includes(x) );
			if ( att.length ) { e.attackers = att.slice(0, 2); e.contested = true; onStage('DIALECTIC', e.key + ' contested (attacked by ' + e.attackers.join('+') + ')'); }
		}
	}

	/** deterministic prose from the LEDGER — the audit trail stays the source of truth. */
	function renderProse( r ) {
		const quote = ( id ) => { const a = r.pool.find(( x ) => x.id === id ); return a ? '“' + a.text + '”' : id; };
		const sideBlock = ( side, title ) => {
			const items = r.ledger.filter(( e ) => e.status === 'active' && e.witnesses && e.side === side );
			if ( !items.length ) return '## ' + title + '\n\nNothing could be established on this side from the pool.\n';
			let s = '## ' + title + '\n\n' + (r.synthesis[side] ? r.synthesis[side] + '\n' : '');
			for ( const e of items ) s += '\n- **' + e.text + '**' + (e.kind === 'generated' ? ' *(new angle found while reading)*' : '')
				+ (e.contested ? ' *(contested — attacked by ' + e.attackers.map(quote).join(' · ') + ')*' : '')
				+ '\n  ' + e.witnesses.map(quote).join(' · ') + '\n';
			return s;
		};
		const open = r.ledger.filter(( e ) => e.status === 'open' );
		let s = '# ' + r.topic + '\n\n'
			+ '*Frame status: **' + r.frameStatus + '**'
			+ (r.frameStatus === 'FREE' ? ' — the statement pool is model-generated; coverage is relative to this pool, not the world.' : '')
			+ (r.frameStatus === 'MATERIAL' ? ' — statements supplied by the caller; the decision frame is not certified.' : '')
			+ (r.frameStatus === 'DECLARED' ? ' — viewpoints declared by the caller.' : '') + '*\n\n'
			+ sideBlock('PRO', 'The case for') + '\n' + sideBlock('CON', 'The case against') + '\n';
		if ( open.length ) s += '## Points that could not be established\n\n' + open.map(( e ) => '- ' + e.text + ' *(no valid witnesses — left open, not faked)*' ).join('\n') + '\n\n';
		s += '## Bottom line\n\n';
		if ( r.basis === 'mechanical-count' )
			s += '**' + r.verdict + '** — anchored points ' + r.counts.PRO + ' vs ' + r.counts.CON + ' (margin ' + r.margin + ' ≥ ' + r.threshold + '): the verdict is mechanical, no model weighing involved.\n';
		else if ( r.basis === 'settled-norm' )
			s += '**' + r.verdict + '** — *on the basis of a settled norm, not of the counts* (anchored points ' + r.counts.PRO + ' vs ' + r.counts.CON
				+ ', margin ' + r.margin + ' below the bound): the contestedness probe finds this question settled among informed people. '
				+ 'This basis is an ADVISORY prior — announced, not a gated fact; the anchored coverage above is the audited part.\n';
		else if ( r.basis === 'norm-vs-counts-tension' )
			s += '**UNDECIDED, with a tension worth knowing**: the contestedness probe says the question is settled toward ' + (r.norm && r.norm.side)
				+ ', but the anchored counts lean the other way (PRO ' + r.counts.PRO + ' vs CON ' + r.counts.CON + '). '
				+ 'Neither signal overrides the other here — inspect the ledger, or supply material.\n';
		else
			s += 'Anchored points: PRO ' + r.counts.PRO + ' vs CON ' + r.counts.CON + ' (margin ' + r.margin + ')'
				+ (r.norm && r.norm.status === 'CONTESTED' ? ', and the contestedness probe confirms the question is GENUINELY contested' : '')
				+ '. On a ' + r.frameStatus + ' frame this margin is below the measured decidability bound (' + r.threshold + '), so no verdict is rendered — '
				+ 'the honest deliverable is the anchored coverage above. A certified perimeter (.sgc stock) is what buys a verdict at margin ≥ 2.\n';
		return s;
	}

	async function run( input ) {
		const topic = String(input && input.topic || '').trim();
		if ( !topic ) throw new Error('critique: input.topic is required');
		const ledger = [], journal = [];
		const { pool, status: poolStatus } = await buildPool(topic, input.statements);
		const nPro = pool.filter(( a ) => a.side === 'PRO' ).length, nCon = pool.filter(( a ) => a.side === 'CON' ).length;
		// a LOPSIDED pool is not an error — it is the signal (an unforced brainstorm on a question
		// nobody seriously argues one side of SHOULD come back one-sided; the counts then separate
		// mechanically). Refuse only when there is nothing to anchor on at all.
		if ( pool.length < 4 || Math.max(nPro, nCon) < 2 )
			return { topic, frameStatus: poolStatus, error: 'pool too small (need ≥4 statements with ≥2 on at least one side)', pool, ledger, verdict: 'UNDECIDED' };
		if ( Math.min(nPro, nCon) < 2 ) onStage('POOL', 'one-sided pool (' + nPro + ' PRO / ' + nCon + ' CON) — announced, and itself a signal');
		const frameStatus = (Array.isArray(input.viewpoints) && input.viewpoints.length) ? 'DECLARED' : poolStatus;
		onStage('POOL', pool.length + ' statements · status ' + poolStatus);
		const vps = await declareViewpoints(topic, pool, input.viewpoints);
		onStage('SPLIT', vps.length + ' declared viewpoints · frame ' + frameStatus);
		const threshold = MECHANICAL_MARGIN[frameStatus] || 3;
		await explore(topic, pool, vps, ledger, journal);
		// RE-ROOT (the harness cycle wired in): generate ONE proven pass (GEN_TRIES per side) IF the
		// node is UNCERTAIN — G3 placement: margin below THIS frame's decidability threshold OR a
		// declared point still open (transposed to C9's per-frame threshold so a margin-2 node a
		// verdict needs is never left ungenerated) — then RECONCILE the ledger (JTMS: an entry whose
		// witnesses left the pool is retracted, cascading shared support) and decide on the enriched
		// perimeter. Generation is a SINGLE pass on purpose: a second generation round changes the
		// measured budget and, on an uncertified FREE/MATERIAL frame, pushes the count past the
		// decidability bound by mining MAJORITY coverage rather than by genuine decidability — the
		// illusion the certified perimeter guards against (consigned finding, measured live on the
		// meta topic: a 2nd round flipped an honest UNDECIDED to a mechanical verdict). The full
		// ledger-driven re-SPLIT (round 2's distinctive work — new viewpoints from the generated
		// vocabulary) needs the real lattice (P2); K_ROUNDS reserves that bound for the future loop.
		const c0 = activeCounts(ledger);
		let rounds = 0;
		if ( Math.abs(c0.PRO - c0.CON) < threshold || ledger.some(( e ) => e.status === 'open' ) ) {
			await generate(topic, pool, ledger, 1, journal);
			reconcile(ledger, pool, journal);
			rounds = 1;
		}
		const counts = activeCounts(ledger);
		const margin = Math.abs(counts.PRO - counts.CON);
		let verdict = margin >= threshold ? (counts.PRO > counts.CON ? 'PRO' : 'CON') : 'UNDECIDED';
		let basis = verdict === 'UNDECIDED' ? null : 'mechanical-count';
		// CONTESTEDNESS probe (SOFT-lane semantics: an ADVISORY prior, announced as such, never a gated
		// fact) — one FORCED-CHOICE call (the closed-competition structure that discriminates; yes/no
		// acquiesces — measured). It separates "genuinely contested at this margin" (honest UNDECIDED)
		// from "settled by a broad norm" (a question that was never really open): without it, a
		// symmetric-ish pool makes UNDECIDED the answer to everything.
		let norm = null;
		if ( verdict === 'UNDECIDED' ) {
			const nOut = String(await ask({ system: SYSTEM, user: 'Question: ' + topic
				+ '\nAmong informed people, is this question genuinely CONTESTED, or is there a SETTLED answer (law, widely shared ethics, broad consensus)?'
				+ '\nReply ONLY one of: SETTLED PRO | SETTLED CON | CONTESTED', maxTokens: 8, temperature: 0 }));
			const mN = nOut.match(/SETTLED\s*(PRO|CON)/i);
			norm = mN ? { status: 'SETTLED', side: mN[1].toUpperCase() } : { status: 'CONTESTED' };
			const lean = counts.PRO > counts.CON ? 'PRO' : counts.CON > counts.PRO ? 'CON' : null;
			if ( norm.status === 'SETTLED' && (!lean || lean === norm.side) ) { verdict = norm.side; basis = 'settled-norm'; }
			else if ( norm.status === 'SETTLED' ) basis = 'norm-vs-counts-tension';    // reported, never papered over
		}
		if ( input.dialectic && verdict === 'UNDECIDED' ) await crossRefute(topic, pool, ledger);   // enrich the contested node — annotation only, never moves the counts
		const synthesis = {};
		for ( const side of ['PRO', 'CON'] ) {
			const items = ledger.filter(( e ) => e.status === 'active' && e.witnesses && e.side === side );
			if ( !items.length ) continue;
			synthesis[side] = String(await ask({ system: SYSTEM, user: 'Question: ' + topic + '\nEstablished ' + side + ' points:\n'
				+ items.map(( c ) => '- ' + c.text.slice(0, 90) ).join('\n') + '\nSummarize the ' + side + ' case in ONE line (no ids).', maxTokens: 60, temperature: 0 })).trim();
		}
		const result = { topic, frameStatus, rounds, journal, pool, viewpoints: vps, ledger, counts, margin, threshold, verdict, basis, norm, synthesis };
		result.prose = renderProse(result);
		if ( input.polish ) {                                                     // presentation-only rewrite, content-locked
			const polished = String(await ask({ system: 'You are an editor. Rewrite the report below into flowing prose. Use ONLY the content provided. Do NOT add facts, numbers, or claims. Keep the frame-status caveat and the bottom line verbatim in meaning.',
				user: result.prose, maxTokens: 700, temperature: 0 }));
			result.polished = polished.trim();
		}
		return result;
	}

	return { run, renderProse };
}

module.exports = { createCriticalMind, reconcile };
