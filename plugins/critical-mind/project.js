'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * projectDebate(g, onStage?) — the STRUCTURAL projection of a settled dialectic graph into the
 * result shape (everything except the presentation passes: synthesis/prose/polish stay in
 * factory-grammar's run(), which calls this then decorates).
 *
 * EXTRACTED VERBATIM from factory-grammar.js run() (07-18) so the instance DESCRIPTOR
 * (descriptor.js — the living debate) and the one-shot factory read a debate through the SAME
 * code — zero drift by construction; the parity suite (critique-grammar-parity.test.js, byte-
 * strict vs the imperative reference) is the net over this extraction.
 *
 * Self-sufficient off the graph: topic/frameStatus/threshold live on the frame node, the pool on
 * ledger.poolIds + statement facts, the viewpoints on ledger.declared + G* nodes. Key INSERTION
 * order in ledger entries mirrors the imperative crossRefute so a strict JSON.stringify
 * comparison of the two faces stays byte-identical (GPU parity bar GP1).
 *
 * Throws on a provider-recorded ask failure (dialecticError fact — parity: the imperative run()
 * rejects). Returns the small-pool error shape when the pool is inadequate.
 */

function tooSmallPool( p ) {
	const nPro = p.filter(( a ) => a.side === 'PRO' ).length, nCon = p.filter(( a ) => a.side === 'CON' ).length;
	return p.length < 4 || Math.max(nPro, nCon) < 2;
}

function projectDebate( g, onStage ) {
	onStage = typeof onStage === 'function' ? onStage : () => {};
	const etty = ( id ) => g.getEtty(id);
	const fx = ( id ) => { const e = etty(id); return (e && e._) || {}; };
	const cast = ( id, k ) => { const e = etty(id); return !!(e && e._mappedConcepts[k]); };
	const fr = fx('frame'), led = fx('ledger');
	const topic = fr.topic, frameStatus = fr.frameStatus, poolStatus = fr.poolStatus, threshold = fr.threshold;

	// a provider-recorded ask failure re-throws here (parity: the imperative run() rejects)
	const failed = ['frame'].concat(led.declared || []).map(( id ) => fx(id).dialecticError ).find(Boolean);
	if ( failed ) throw new Error(failed);

	const pool = (led.poolIds || []).map(( id ) => { const f = fx(id); return { id, side: f.side, text: f.text }; });
	if ( tooSmallPool(pool) )
		return { topic, frameStatus: poolStatus, error: 'pool too small (need ≥4 statements with ≥2 on at least one side)', pool, ledger: [], verdict: 'UNDECIDED' };
	const nPro = pool.filter(( a ) => a.side === 'PRO' ).length, nCon = pool.filter(( a ) => a.side === 'CON' ).length;
	if ( Math.min(nPro, nCon) < 2 ) onStage('POOL', 'one-sided pool (' + nPro + ' PRO / ' + nCon + ' CON) — announced, and itself a signal');
	onStage('POOL', pool.length + ' statements · status ' + poolStatus);

	const declaredKeys = led.declared || [];
	const vps = declaredKeys.map(( k ) => { const f = fx(k); return { key: k, side: f.side || null, text: f.text }; });
	onStage('SPLIT', vps.length + ' declared viewpoints · frame ' + frameStatus);

	const genKeys = Object.keys(g._objById || {}).filter(( id ) => /^G\d+$/.test(id) && fx(id).isViewpoint )
		.sort(( a, b ) => Number(a.slice(1)) - Number(b.slice(1)) );
	const retractedSet = new Set([].concat(led.proRetracted || [], led.conRetracted || []));
	const entryOf = ( key, kind ) => {
		const f = fx(key);
		const witnesses = f.w0 ? [f.w0].concat(f.w1 ? [f.w1] : []).concat(f.w2 ? [f.w2] : []) : null;
		const e = { key, kind, side: f.side || null, text: f.text, witnesses,
			status: cast(key, 'Established') ? 'active' : (retractedSet.has(key) ? 'retracted' : 'open'),
			round: kind === 'generated' ? 1 : 0, provenance: kind === 'generated' ? 'generated+witnesses' : 'declared' };
		// key INSERTION order mirrors the imperative crossRefute (attackers, then contested) so even a
		// strict JSON.stringify comparison of the two faces is byte-identical (GPU parity bar GP1)
		if ( f.contested ) { e.attackers = f.attackers; e.contested = true; }
		return e;
	};
	const ledger = declaredKeys.map(( k ) => entryOf(k, 'declared') ).concat(genKeys.map(( k ) => entryOf(k, 'generated') ));

	// journal: the R0 lines are a pure projection of the leaf facts (established-at-round-1 in
	// declared order, then retry hits by (retry#, declared order), then the retry-exhausted opens
	// — exactly the imperative emission order), followed by the generation pass's own journal.
	const journal = [];
	const dIdx = ( k ) => declaredKeys.indexOf(k);
	const dEntries = ledger.filter(( e ) => e.kind === 'declared' );
	const wit = ( k ) => { const f = fx(k); return [f.w0].concat(f.w1 ? [f.w1] : []).filter(Boolean); };
	for ( const e of dEntries ) if ( fx(e.key).w0 && !fx(e.key).retryHit && !fx(e.key).fusedRound )
		journal.push('R0 established ' + e.key + ' (' + e.side + ', ' + wit(e.key).join('+') + ')');
	dEntries.filter(( e ) => fx(e.key).retryHit )
		.sort(( a, b ) => (fx(a.key).retryHit - fx(b.key).retryHit) || (dIdx(a.key) - dIdx(b.key)) )
		.forEach(( e ) => journal.push('R0 established ' + e.key + ' (' + e.side + ', ' + wit(e.key).join('+') + ', retry ' + fx(e.key).retryHit + ')') );
	for ( const e of dEntries ) if ( fx(e.key).retryDone && !fx(e.key).retryHit )
		journal.push('R0 open ' + e.key + ' (' + (e.side || '?') + ', no valid witnesses)');
	journal.push(...(led.genJournal || []));

	const counts = { PRO: (led.pro || []).length - (led.proRetracted || []).length,
		CON: (led.con || []).length - (led.conRetracted || []).length };
	const margin = Math.abs(counts.PRO - counts.CON);
	const norm = fr.normStatus
		? (/^SETTLED_/.test(fr.normStatus) ? { status: 'SETTLED', side: fr.normStatus.slice(8) } : { status: 'CONTESTED' })
		: null;
	let verdict, basis;
	if ( cast('frame', 'Pro') ) { verdict = 'PRO'; basis = 'mechanical-count'; }
	else if ( cast('frame', 'Con') ) { verdict = 'CON'; basis = 'mechanical-count'; }
	else if ( cast('frame', 'SettledNorm') ) { verdict = norm.side; basis = 'settled-norm'; }
	else { verdict = 'UNDECIDED'; basis = norm && norm.status === 'SETTLED' ? 'norm-vs-counts-tension' : null; }

	return { topic, frameStatus, rounds: fr.genRound ? 1 : 0, journal, pool, viewpoints: vps,
		ledger, counts, margin, threshold, verdict, basis, norm };
}

module.exports = { projectDebate, tooSmallPool };
