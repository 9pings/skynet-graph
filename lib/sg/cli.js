#!/usr/bin/env node
'use strict';
/**
 * sg — the Skynet-Graph CLI.
 *
 * Boot a graph standalone from plain directories:
 *   sg run --concepts <dir> [--providers <dir>] [--builtins] [--sets a,b]
 *          [--seed <file.json>] [--trace <out.json>] [--json] [--timeout <ms>]
 *
 * Inspect a trace artifact (produced by --trace, or lib/sg/trace.js write()):
 *   sg trace    <file>        list every concept-apply (rev, concept, target, patch, ms)
 *   sg show     <file> <n>    full detail of record n (prompt / reply / patch / why)
 *   sg concepts <file>        per-concept rollup (count + total ms), heaviest first
 *   sg errors   <file>        applies whose patch flagged an llmError
 */
const fs = require('fs');
const { summarizeTrace, perConcept, errorRecords, formatRecord } = require('./trace.js');

function die( msg ) { process.stderr.write('sg: ' + msg + '\n'); process.exit(1); }
function out( s ) { process.stdout.write(s + '\n'); }

function loadArtifact( file ) {
	if ( !file ) die('missing <file>');
	let raw;
	try { raw = fs.readFileSync(file, 'utf8'); } catch ( e ) { die('cannot read ' + file + ': ' + e.message); }
	try { return JSON.parse(raw); } catch ( e ) { die('not valid JSON: ' + file); }
}

// minimal fixed-width table printer
function table( rows, cols ) {
	if ( !rows.length ) return '(no records)';
	const w = {};
	cols.forEach(c => { w[c] = Math.max(c.length, ...rows.map(r => String(r[c] == null ? '' : r[c]).length)); });
	const line = r => cols.map(c => String(r[c] == null ? '' : r[c]).padEnd(w[c])).join('  ');
	const head = {}; cols.forEach(c => head[c] = c);
	return [line(head), cols.map(c => '-'.repeat(w[c])).join('  '), ...rows.map(line)].join('\n');
}

// --key value | --flag(boolean) parser
function parseFlags( args ) {
	const o = {};
	for ( let i = 0 ; i < args.length ; i++ ) {
		const a = args[i];
		if ( !a.startsWith('--') ) continue;
		const key  = a.slice(2);
		const next = args[i + 1];
		if ( next === undefined || next.startsWith('--') ) o[key] = true;
		else { o[key] = next; i++; }
	}
	return o;
}

// concise post-stabilize report (or full object dump with --json)
function runSummary( graph, asJson ) {
	const ser  = JSON.parse(graph.serialize().graph);
	const objs = ser.conceptMaps || [];
	if ( asJson ) return JSON.stringify(objs, null, 2);
	const lines = ['stabilized: ' + objs.length + ' object(s), rev ' + ser.lastRev];
	for ( const o of objs ) {
		const facts = Object.keys(o).filter(k => k[0] !== '_').slice(0, 14);
		lines.push('  ' + (o._id || '(no id)') + '  {' + facts.join(', ') + '}');
	}
	return lines.join('\n');
}

const argv = process.argv.slice(2);
const cmd  = argv[0];

switch ( cmd ) {
	case 'run': {
		const opts = parseFlags(argv.slice(1));
		if ( !opts.concepts ) die('run needs --concepts <dir>');
		const Graph = require('../index.js');
		const { createTrace } = require('./trace.js');
		const trace = opts.trace ? createTrace() : null;
		let done = false;
		const finish = ( graph ) => {
			if ( done ) return; done = true;
			out(runSummary(graph, opts.json));
			if ( trace ) out('trace -> ' + trace.write(String(opts.trace), graph, { concepts: opts.concepts }));
			process.exit(0);
		};
		const conf = { autoMount: true, onStabilize: ( g ) => finish(g) };
		if ( opts.sets )  conf.conceptSets = String(opts.sets).split(',');
		if ( trace )      conf.onConceptApply = trace.onConceptApply;
		const g = Graph.fromDirs({
			concepts   : opts.concepts,
			providers  : opts.providers,
			builtins   : opts.builtins ? true : undefined,
			seed       : opts.seed ? String(opts.seed) : undefined,
			providerCtx: { env: process.env },
			conf
		});
		// settle-hook only fires after a write; an empty/no-op seed never settles -> bound it
		setTimeout(() => finish(g), Number(opts.timeout) || 8000);
		break;
	}
	case 'trace': {
		const a = loadArtifact(argv[1]);
		out(table(summarizeTrace(a.records || []), ['n', 'rev', 'concept', 'target', 'kind', 'patch', 'ms']));
		break;
	}
	case 'show': {
		const a = loadArtifact(argv[1]);
		const n = Number(argv[2]);
		if ( !Number.isInteger(n) ) die('show needs a record index: sg show <file> <n>');
		out(formatRecord((a.records || [])[n]));
		break;
	}
	case 'concepts': {
		const a = loadArtifact(argv[1]);
		out(table(perConcept(a.records || []), ['concept', 'count', 'totalMs']));
		break;
	}
	case 'errors': {
		const a = loadArtifact(argv[1]);
		const errs = errorRecords(a.records || []);
		out(errs.length ? errs.map(( r ) => formatRecord(r)).join('\n\n') : '(no errored applies)');
		break;
	}
	default:
		out([
			'sg — Skynet-Graph CLI',
			'  sg run      --concepts <dir> [--providers <dir>] [--builtins] [--sets a,b]',
			'              [--seed <file>] [--trace <out>] [--json] [--timeout <ms>]',
			'  sg trace    <file>      list concept-applies',
			'  sg show     <file> <n>  detail of record n (prompt/reply/patch/why)',
			'  sg concepts <file>      per-concept rollup (count + total ms)',
			'  sg errors   <file>      applies that flagged an llmError'
		].join('\n'));
		process.exit(cmd ? 1 : 0);
}
