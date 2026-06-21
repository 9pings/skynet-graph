'use strict';
/**
 * Concept-apply trace collector + render helpers — the engine behind the `sg`
 * inspector CLI. Host-side (not part of the engine): wire `cfg.onConceptApply =
 * trace.onConceptApply`, run the graph, then write/inspect the artifact.
 *
 *   const trace = createTrace();
 *   new Graph(seed, { ..., onConceptApply: trace.onConceptApply }, conceptMap);
 *   // on stabilize:
 *   trace.write('run.json', graph, { objective });
 */
const fs = require('fs');

function createTrace() {
	const records = [];
	const api = {
		records,
		onConceptApply( rec ) { records.push(rec); },
		// bundle records + a final graph snapshot (serialize()) for post-hoc inspection
		toArtifact( graph, meta ) {
			return { meta: meta || {}, snapshot: graph ? graph.serialize() : null, records };
		},
		write( path, graph, meta ) {
			fs.writeFileSync(path, JSON.stringify(api.toArtifact(graph, meta), null, 2));
			return path;
		}
	};
	return api;
}

// compact one-line summary of a patch (the applied mutation template)
function patchSummary( patch ) {
	if ( !patch ) return '';
	const arr = Array.isArray(patch) ? patch : [patch];
	const segs = arr.filter(o => o && o.Segment).length;
	const parts = [];
	if ( segs ) parts.push('+' + segs + ' seg' + (segs > 1 ? 's' : ''));
	for ( const o of arr ) {
		for ( const k of Object.keys(o || {}) ) {
			if ( k === '_id' || k === '$$_id' || k === '$_id' || k === '_rev' || k === 'Segment' || k === 'Node' ) continue;
			let v = o[k];
			v = (v && typeof v === 'object') ? (Array.isArray(v) ? '[' + v.length + ']' : JSON.stringify(v)) : String(v);
			if ( v.length > 24 ) v = v.slice(0, 23) + '…';
			parts.push(k + ':' + v);
		}
	}
	const s = parts.join(' ');
	return s.length > 48 ? s.slice(0, 47) + '…' : s;
}

// one summary row per record (for `sg trace`)
function summarizeTrace( records ) {
	return records.map(( r, i ) => ({
		n      : i,
		rev    : r.rev,
		concept: r.conceptName,
		target : r.targetId,
		kind   : r.kind,
		patch  : patchSummary(r.patch),
		ms     : Math.round(r.ms || 0)
	}));
}

// per-concept rollup (count + total ms), heaviest first (for finding expensive branches)
function perConcept( records ) {
	const by = {};
	for ( const r of records ) {
		const c = by[r.conceptName] = by[r.conceptName] || { concept: r.conceptName, count: 0, totalMs: 0 };
		c.count++;
		c.totalMs += Math.round(r.ms || 0);
	}
	return Object.keys(by).map(k => by[k]).sort(( a, b ) => b.totalMs - a.totalMs);
}

// records whose patch flagged an llmError (for `sg errors`)
function errorRecords( records ) {
	return records.filter(r => JSON.stringify(r.patch || '').includes('llmError'));
}

// full detail of one record (for `sg show <n>`)
function formatRecord( rec ) {
	if ( !rec ) return '(no such record)';
	const lines = [];
	lines.push(`#${rec.rev}  ${rec.conceptName}  ->  ${rec.targetId}   [${rec.kind}, ${Math.round(rec.ms || 0)}ms]`);
	if ( rec.why && rec.why.length ) {
		lines.push('  why fired:');
		for ( const w of rec.why ) {
			let v = (w.value && typeof w.value === 'object') ? JSON.stringify(w.value) : String(w.value);
			lines.push(`    ${w.require} = ${v}` + (w.producedAtRev != null ? `  @rev ${w.producedAtRev}` : ''));
		}
	}
	if ( rec.prompt ) {
		if ( rec.prompt.system ) lines.push('  prompt.system: ' + rec.prompt.system);
		if ( rec.prompt.user ) lines.push('  prompt.user:   ' + rec.prompt.user);
	}
	if ( rec.reply != null ) lines.push('  reply: ' + (typeof rec.reply === 'string' ? rec.reply : JSON.stringify(rec.reply)));
	lines.push('  patch: ' + JSON.stringify(rec.patch));
	return lines.join('\n');
}

module.exports = { createTrace, summarizeTrace, perConcept, errorRecords, formatRecord, patchSummary };
