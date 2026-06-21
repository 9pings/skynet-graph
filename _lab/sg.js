#!/usr/bin/env node
'use strict';
/**
 * sg — the MOE Graph inspector CLI. Reads a trace artifact (produced by
 * _lab/trace.js write()) and renders the concept-apply trace.
 *
 *   sg trace    <file>        list every concept-apply (rev, concept, target, patch, ms)
 *   sg show     <file> <n>    full detail of record n (prompt / reply / patch / why)
 *   sg concepts <file>        per-concept rollup (count + total ms), heaviest first
 *   sg errors   <file>        applies whose patch flagged an llmError
 *
 * Revision diff and path inspection are graph-API methods (diffRevisions / getPaths)
 * — use them on a live graph; not re-implemented over the static artifact here.
 */
const fs = require('fs');
const { summarizeTrace, perConcept, errorRecords, formatRecord } = require('./trace.js');

function loadArtifact( file ) {
	if ( !file ) die('missing <file>');
	let raw;
	try { raw = fs.readFileSync(file, 'utf8'); } catch ( e ) { die('cannot read ' + file + ': ' + e.message); }
	try { return JSON.parse(raw); } catch ( e ) { die('not valid JSON: ' + file); }
}
function die( msg ) { process.stderr.write('sg: ' + msg + '\n'); process.exit(1); }

// minimal fixed-width table printer
function table( rows, cols ) {
	if ( !rows.length ) return '(no records)';
	const w = {};
	cols.forEach(c => { w[c] = Math.max(c.length, ...rows.map(r => String(r[c] == null ? '' : r[c]).length)); });
	const line = r => cols.map(c => String(r[c] == null ? '' : r[c]).padEnd(w[c])).join('  ');
	const head = {}; cols.forEach(c => head[c] = c);
	return [line(head), cols.map(c => '-'.repeat(w[c])).join('  '), ...rows.map(line)].join('\n');
}

const [cmd, file, arg] = process.argv.slice(2);

switch ( cmd ) {
	case 'trace': {
		const a = loadArtifact(file);
		out(table(summarizeTrace(a.records || []), ['n', 'rev', 'concept', 'target', 'kind', 'patch', 'ms']));
		break;
	}
	case 'show': {
		const a = loadArtifact(file);
		const n = Number(arg);
		if ( !Number.isInteger(n) ) die('show needs a record index: sg show <file> <n>');
		out(formatRecord((a.records || [])[n]));
		break;
	}
	case 'concepts': {
		const a = loadArtifact(file);
		out(table(perConcept(a.records || []), ['concept', 'count', 'totalMs']));
		break;
	}
	case 'errors': {
		const a = loadArtifact(file);
		const errs = errorRecords(a.records || []);
		out(errs.length ? errs.map((r) => formatRecord(r)).join('\n\n') : '(no errored applies)');
		break;
	}
	default:
		out([
			'sg — MOE Graph inspector',
			'  sg trace    <file>      list concept-applies',
			'  sg show     <file> <n>  detail of record n (prompt/reply/patch/why)',
			'  sg concepts <file>      per-concept rollup (count + total ms)',
			'  sg errors   <file>      applies that flagged an llmError'
		].join('\n'));
		process.exit(cmd ? 1 : 0);
}

function out( s ) { process.stdout.write(s + '\n'); }
