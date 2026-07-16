/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * audit — C-audit: the durable executor's INSPECTION surface (design doc §8, "a headline win with no owner").
 * The conception sells AUDITABILITY (typed/defeasible/auditable/versioned belief — the moat over opaque CBR/RAG);
 * this makes it concrete. Pure + READ-ONLY over the `CheckpointStore` marking — no belief, no mutation.
 *
 * The marking already records everything needed: each token's `id`, `recordId`, `placeId`, `status`, `parentId`
 * (the fan-out/fan-in lineage), `reason` (the blame), `payload` (the result). `auditRun` reconstructs:
 *   - the DERIVATION FOREST per record: the parentId tree (root case → map children → fold collector);
 *   - a per-record VERDICT: done / failed / pending, the terminal place, the result payload, and — on failure —
 *     the BLAME reason (e.g. `contract:post-violated:…`, `group-failed`, `task-error:…`);
 *   - whether the record FANNED OUT (a map) and was FOLDED back (a collector reached a sink);
 *   - run TOTALS by status + the blame list.
 *
 * This is the audit trail no surface-similarity store can give: WHY a derivation holds or was retracted, traceable
 * to the typed premise and the exact step that failed.
 */

const TERMINAL = { done: 1, failed: 1 };

/**
 * Build the audit trace for a run. Read-only.
 * @param store  a CheckpointStore
 * @param runId
 * @param opts.sinks  the net's sink places (default ['done']) — to label a terminal token done-vs-elsewhere
 * @returns { records: { <recordId>: {status, terminal, result, blame, fannedOut, folded, lineage:[…]} }, totals }
 */
function auditRun( store, runId, opts ) {
	opts = opts || {};
	const sinks = new Set(opts.sinks || ['done']);
	const marking = store.marking(runId) || {};
	const toks = [];
	for ( const place of Object.keys(marking) ) for ( const t of marking[place] ) toks.push(t);

	const byRecord = {};
	for ( const t of toks ) (byRecord[t.recordId] = byRecord[t.recordId] || []).push(t);

	const records = {};
	const totals = { records: 0, done: 0, failed: 0, pending: 0, tokens: toks.length, blames: [] };

	for ( const rid of Object.keys(byRecord) ) {
		const ts = byRecord[rid].slice().sort(( a, b ) => idNum(a.id) - idNum(b.id));
		const failed = ts.filter(( t ) => t.status === 'failed' );
		const doneToks = ts.filter(( t ) => t.status === 'done' );
		const fannedOut = ts.some(( t ) => t.status === 'consumed' );      // a fan-out consumes its source
		const folded = ts.some(( t ) => t.parentId != null && t.status === 'done' && hasJoinedSiblings(ts, t.parentId) );

		// verdict: a SURVIVORS fold wins FIRST — a collector reached a sink carrying `_partial` despite some FAILED
		// (dropped) shards: that is done(partial), NOT a record failure (the drops are expected, surfaced not fatal).
		// Else failed wins (any failure quarantines the record — fail-fast); else done iff a token reached a sink;
		// else still pending (claimable/leased/parked).
		const partialDone = doneToks.find(( t ) => t.payload && t.payload._partial === true );
		let status, terminal = null, result, blame = null, partial = false, dropped = 0;
		if ( partialDone ) {
			status = 'done'; partial = true;
			terminal = partialDone.placeId; result = partialDone.payload;
			dropped = partialDone.payload._dropped != null ? partialDone.payload._dropped : failed.length;
		} else if ( failed.length ) {
			status = 'failed';
			blame = failed.map(( t ) => t.reason ).find(( r ) => r && !/^sibling-failed$|^group-failed$/.test(r) ) || failed[0].reason;
			terminal = failed[0].placeId;
		} else if ( doneToks.length ) {
			status = 'done';
			const last = doneToks[doneToks.length - 1];                    // the fold collector, if any, is the last-created done
			terminal = last.placeId; result = last.payload;
		} else {
			status = 'pending';
		}

		records[rid] = {
			status, partial, dropped, terminal, result, blame, fannedOut, folded,
			tokens: ts.length,
			lineage: ts.map(( t ) => ({ id: t.id, place: t.placeId, status: t.status, parentId: t.parentId == null ? null : t.parentId,
				reason: t.reason == null ? undefined : t.reason })),
		};
		totals.records++; totals[status]++;
		if ( blame ) totals.blames.push({ recordId: rid, reason: blame });
	}
	return { records, totals };
}

function idNum( id ) { const n = parseInt(String(id).replace(/^t/, ''), 10); return isNaN(n) ? 0 : n; }
function hasJoinedSiblings( ts, parentId ) { return ts.some(( t ) => t.parentId === parentId && t.status === 'joined' ); }

/** A compact one-line-per-record summary (for a CLI / log). */
function auditSummary( audit ) {
	const lines = [];
	for ( const rid of Object.keys(audit.records) ) {
		const r = audit.records[rid];
		lines.push(`${rid}: ${r.status}${r.partial ? ' (partial, ' + r.dropped + ' dropped)' : ''}${r.fannedOut ? ' (map' + (r.folded ? '→fold' : '') + ')' : ''}` +
			`${r.blame ? ' — ' + r.blame : ''} @${r.terminal || '?'}`);
	}
	return lines.join('\n');
}

module.exports = { auditRun, auditSummary };
