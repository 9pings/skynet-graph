#!/usr/bin/env node
/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
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
const { createLogger } = require('../graph/log.js');
const { createPlainSink, createDashboardSink, createFileSink, mostPermissive, banner, startStatsLogger } = require('./log-sinks.js');
const pkg = require('../../package.json');

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

function openBrowser( url ) {
	const { spawn } = require('child_process');
	const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
	try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch ( e ) {}
}

// Build the shared graph logger from the common --log-* flags (used by every
// command that boots a graph). Console sink is attached by the caller (dashboard
// for `run`, plain for `studio`). The logger threshold is the most permissive any
// sink needs; each sink then filters to its own level.
function buildLogger( opts ) {
	const consoleLevel = opts['log-level'] || 'info';
	const fileLevel    = opts['log-file'] ? (opts['log-file-level'] || 'verbose') : null;
	const logger = createLogger({ label: 'sg', level: mostPermissive([consoleLevel, fileLevel].filter(Boolean)), console: false });
	if ( opts['log-file'] ) logger.addSink(createFileSink({ path: String(opts['log-file']), level: fileLevel }));
	return { logger, consoleLevel };
}

const argv = process.argv.slice(2);
const cmd  = argv[0];

switch ( cmd ) {
	case 'studio': {
		const opts = parseFlags(argv.slice(1));
		const Graph = require('../index.js');
		const { createServer } = require('../studio/server.js');
		const port = Number(opts.port) || 4848;
		const root = opts.root ? require('path').resolve(String(opts.root)) : process.cwd();
		// optional LLM backend for the prompt console (decompose -> synthesize)
		let ask;
		if ( process.env.LLM_BASE ) {
			const { makeAsk } = require('../providers/llm.js');
			ask = makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022' });
		}
		// terminal logging for the graphs the studio boots, shared across all sessions/forks
		const { logger, consoleLevel } = buildLogger(opts);
		const studioMode = opts['log-plain'] ? 'plain' : (opts['log-mode'] || (process.stdout.isTTY ? 'dashboard' : 'plain'));
		const srv = createServer({ Graph, root, ask, logger });
		// dashboard: fixed bottom status bar (reflects the ACTIVE session's graph) + scrolling
		// logs; stats live ONLY in the bar. plain (log-only): no bar, stats emitted as periodic
		// log lines instead. Banner to the console stream.
		let studioDash = null, studioStats = null;
		if ( studioMode === 'dashboard' ) {
			process.stdout.write(banner(pkg.version, !!process.stdout.isTTY) + '\n');
			try { studioDash = createDashboardSink({ getGraph: () => srv.studio.activeGraph(), stream: process.stdout, level: consoleLevel }); logger.addSink(studioDash); }
			catch ( e ) { logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel })); }
		} else {
			process.stderr.write(banner(pkg.version, !!process.stderr.isTTY) + '\n');
			logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel }));
			studioStats = startStatsLogger(logger, () => srv.studio.activeGraph(), 2000);// stats in the log stream (no bar)
		}
		process.on('SIGINT', () => { if ( studioDash && studioDash.close ) studioDash.close(); if ( studioStats ) clearInterval(studioStats); process.exit(130); });
		srv.listen(port, () => {
			const url = 'http://localhost:' + port;
			out('sg studio → ' + url + '   (corpora root: ' + root + ', logs: ' + consoleLevel + ', mode: ' + studioMode + ')');
			if ( opts.open ) openBrowser(url);
		});
		break;
	}
	case 'run': {
		const opts = parseFlags(argv.slice(1));
		if ( !opts.concepts ) die('run needs --concepts <dir>');
		const Graph = require('../index.js');
		const { createTrace } = require('./trace.js');
		const trace = opts.trace ? createTrace() : null;
		let done = false;
		let dash = null;
		let statsTimer = null;
		const finish = ( graph ) => {
			if ( done ) return; done = true;
			if ( statsTimer ) clearInterval(statsTimer);
			if ( dash && dash.close ) dash.close();   // restore the terminal before printing the summary
			out(runSummary(graph, opts.json));
			if ( trace ) out('trace -> ' + trace.write(String(opts.trace), graph, { concepts: opts.concepts }));
			process.exit(0);
		};

		// logging: shared logger + display mode (dashboard on a TTY, else plain)
		const { logger, consoleLevel } = buildLogger(opts);
		const mode = opts['log-mode'] || (opts['log-plain'] ? 'plain' : (process.stdout.isTTY ? 'dashboard' : 'plain'));
		// styled boot banner (to the same stream the console logs use)
		const bannerStream = mode === 'dashboard' ? process.stdout : process.stderr;
		bannerStream.write(banner(pkg.version, !!bannerStream.isTTY) + '\n');

		const conf = { autoMount: true, onStabilize: ( g ) => finish(g), logger };
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
		// console sink — dashboard: fixed bottom status bar + scrolling logs, stats ONLY in the
		// bar. plain (log-only): logs to stderr (stdout summary stays pipeable) + stats emitted as
		// periodic log lines. Dashboard degrades to plain off a TTY.
		if ( mode === 'dashboard' ) {
			try { dash = createDashboardSink({ graph: g, stream: process.stdout, level: consoleLevel }); logger.addSink(dash); }
			catch ( e ) { logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel })); }
		} else {
			logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel }));
			statsTimer = startStatsLogger(logger, () => g, 2000);// log-only: stats as periodic log lines
		}
		process.on('SIGINT', () => { if ( dash && dash.close ) dash.close(); if ( statsTimer ) clearInterval(statsTimer); process.exit(130); });
		// settle-hook only fires after a write; an empty/no-op seed never settles -> bound it
		setTimeout(() => finish(g), Number(opts.timeout) || 8000);
		break;
	}
	case 'ask': {
		// sg ask "<question>" — the request/response reasoning endpoint (Controller-P0).
		//   --concepts <dir>  → the TYPED APPLIANCE (lib/combos/appliance.js): intake→reason-loop→typed
		//                       refusal→memo, the §4 posture ON. A refusal NAMES the missing requirement
		//                       (never a wrong answer). This is the differentiator.
		//   (no --concepts)   → the LEGACY best-effort decompose→synthesize loop (Session), kept for compat.
		// Backend: --local-model <gguf> / env LOCAL_MODEL (embedded), or an HTTP endpoint via LLM_BASE.
		const opts = parseFlags(argv.slice(1));
		const text = (argv[1] && !argv[1].startsWith('--')) ? argv[1] : (opts.q || opts.prompt);
		if ( !text || text === true ) die('ask needs a question: sg ask "<question>" [--concepts <dir>] [--local-model <gguf> | (env LLM_BASE)] [--depth N] [--json]');

		const localModel = opts['local-model'] ? String(opts['local-model']) : process.env.LOCAL_MODEL;
		let backend;   // { localModel } | an ask function | (die)
		if ( localModel ) backend = { localModel: localModel };
		else if ( process.env.LLM_BASE ) backend = require('../providers/llm.js').makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022' });
		else die('ask needs an LLM backend: pass --local-model <path.gguf> (or env LOCAL_MODEL), or set LLM_BASE');

		const { logger, consoleLevel } = buildLogger({ ...opts, 'log-level': opts['log-level'] || 'warn' });
		logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel }));   // logs → stderr; answer → stdout
		if ( !opts.json ) process.stderr.write(banner(pkg.version, !!process.stderr.isTTY) + '\n');
		const depth = opts.depth != null ? Number(opts.depth) : undefined, timeout = Number(opts.timeout) || 180000;

		if ( opts.concepts ) {
			// the TYPED appliance — a domain concept set + the reasoning substrate; typed answer or typed refusal.
			const { createAppliance } = require('../index.js').combos;
			const app = createAppliance({ concepts: opts.concepts, ask: backend, logger: logger, maxDepth: depth });
			app.answer(String(text), { timeout: timeout }).then(( r ) => {
				if ( opts.json ) out(JSON.stringify(r, null, 2));
				else if ( r.status === 'answered' ) out(r.answer + (r.confBand ? '\n  [confidence: ' + r.confBand + ']' : ''));
				else out('REFUSED — ' + r.reason + (r.missing && r.missing.length ? ' (missing: ' + r.missing.join(', ') + ')' : ''));
				app.close(); process.exit(r.status === 'answered' ? 0 : 2);
			}).catch(( e ) => die(e.message));
		} else {
			// LEGACY best-effort loop (no typed barrier) — kept for compat; the appliance is the typed path.
			if ( !opts.json ) process.stderr.write('  (note: bare `sg ask` is the legacy best-effort loop; pass --concepts <dir> for the typed appliance)\n');
			const Graph = require('../index.js');
			const Session = require('../studio/session.js');
			const ask = (backend && backend.localModel)
				? require('../providers/llm-local.js').makeLocalAsk({ modelPath: backend.localModel })
				: backend;   // an LLM_BASE function stays as-is
			const s = new Session('ask', { Graph, ask, logger });
			if ( !opts.json ) s.on('promptProgress', ( m ) => process.stderr.write('  … ' + m.kind + (m.label ? ' ' + m.label : '') + '\n'));
			s.answer(String(text), { maxDepth: depth, timeout: timeout })
				.then(( { answer, state } ) => { out(opts.json ? JSON.stringify({ answer, objects: state.objects }, null, 2) : answer); process.exit(0); })
				.catch(( e ) => die(e.message));
		}
		break;
	}
	case 'proxy': {
		// sg proxy "<question>" — the LOCAL-FIRST PROXY CACHE (C6). Serve a COVERED query from the local
		// stock at 0 frontier calls; escalate a MISS to the frontier and enrich the stock in passing. The
		// local side NEVER fabricates (0 hallucination — verified stock or escalate); a miss always answers
		// (no false neg). The economy (frontier calls saved) is reported to stderr.
		//   --frontier-model <gguf> | env FRONTIER_MODEL | env LLM_BASE   the ground-truth generator (REQUIRED)
		//   --local-model <gguf> | env LOCAL_MODEL                        small model → semantic coverage + coverage-check (opt-in)
		//   --store <file.json>                                           durable stock across runs
		//   --json                                                        machine output (answers + metrics)
		// No positional question → read queries from stdin (one per line) = a real recurring session.
		const opts = parseFlags(argv.slice(1));
		const positional = (argv[1] && !argv[1].startsWith('--')) ? argv[1] : (opts.q || opts.prompt);
		const { createProxyCache, makeFrontierAsk, makeLocalCoverage } = require('../index.js').combos;
		const { makeLocalAsk } = require('../providers/llm-local.js');

		// FRONTIER = the ground truth (embedded gguf or an HTTP endpoint) — never invented on the local side.
		const frontierModel = opts['frontier-model'] ? String(opts['frontier-model']) : process.env.FRONTIER_MODEL;
		let frontierChat;
		if ( frontierModel ) frontierChat = makeLocalAsk({ modelPath: frontierModel, reasoningBudget: 0 });
		else if ( process.env.LLM_BASE ) frontierChat = require('../providers/llm.js').makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022' });
		else die('proxy needs a FRONTIER backend: --frontier-model <gguf> (or env FRONTIER_MODEL), or set LLM_BASE');
		const frontierAsk = makeFrontierAsk(frontierChat);

		// LOCAL (opt-in) = the semantic-key + coverage-check judge → a paraphrase hits the stock, a stale hit is rejected.
		let semantic = {};
		const localModel = opts['local-model'] ? String(opts['local-model']) : process.env.LOCAL_MODEL;
		if ( localModel ) semantic = makeLocalCoverage({ localAsk: makeLocalAsk({ modelPath: localModel, reasoningBudget: 0 }) });

		const px = createProxyCache(Object.assign({ frontierAsk, store: opts.store ? String(opts.store) : undefined, retention: true }, semantic));
		const { runProxySession, formatProxyReport } = require('./proxy-run.js');

		const readStdin = () => new Promise(( res ) => { let buf = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', ( d ) => buf += d); process.stdin.on('end', () => res(buf)); });
		(async () => {
			let queries;
			if ( positional && positional !== true ) queries = [String(positional)];
			else {
				if ( process.stdin.isTTY ) die('proxy needs a question: sg proxy "<question>" (or pipe questions on stdin, one per line)');
				queries = (await readStdin()).split('\n').map(( s ) => s.trim()).filter(Boolean);
			}
			if ( !queries.length ) die('proxy: no questions given');
			const onAnswer = ( row ) => {
				if ( opts.json ) return;
				if ( queries.length === 1 ) out(String(row.answer));                                   // single-shot: answer → stdout
				else out('[' + (row.source === 'local' ? 'cache' : 'frontier') + '] ' + row.query + '\n  → ' + String(row.answer));
			};
			const { results, metrics, saved } = await runProxySession({ proxy: px, queries, onAnswer });
			if ( opts.json ) out(JSON.stringify({ results, metrics, saved }, null, 2));
			else process.stderr.write(formatProxyReport(metrics, saved) + '\n');
			process.exit(0);
		})().catch(( e ) => die(e.message));
		break;
	}
	case 'serve': {
		// sg serve — the OpenAI-COMPATIBLE endpoint over the C6 proxy cache (roadmap FINIR, F1). Point any
		// OpenAI client's baseURL at http://host:port/v1: a covered query is served from the local stock at
		// 0 frontier calls, a miss escalates to the frontier + enriches the stock. Provenance rides EVERY
		// completion (headers x-sg-served-from/-arm/-cost/-coverage/-saved + usage.sg_*); per-request lines
		// → stderr; Ctrl-C prints the economy report. The handler/server logic lives in serve.js (stub-tested);
		// only the GPU-bound model resolution lives here — same resolution as `sg proxy`.
		//   --frontier-model <gguf> | env FRONTIER_MODEL | env LLM_BASE   the ground-truth generator (REQUIRED)
		//   --local-model <gguf> | env LOCAL_MODEL                        semantic coverage + coverage-check (opt-in)
		//   --store <file.json>    durable stock across restarts
		//   --port N (default 4747)   --host <addr> (default 127.0.0.1)   --model <id> (advertised model id)
		const opts = parseFlags(argv.slice(1));
		const { createProxyCache, makeFrontierAsk, makeLocalCoverage } = require('../index.js').combos;
		const { makeLocalAsk } = require('../providers/llm-local.js');

		const frontierModel = opts['frontier-model'] ? String(opts['frontier-model']) : process.env.FRONTIER_MODEL;
		let frontierChat;
		if ( frontierModel ) frontierChat = makeLocalAsk({ modelPath: frontierModel, reasoningBudget: 0 });
		else if ( process.env.LLM_BASE ) frontierChat = require('../providers/llm.js').makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022' });
		else die('serve needs a FRONTIER backend: --frontier-model <gguf> (or env FRONTIER_MODEL), or set LLM_BASE');
		const frontierAsk = makeFrontierAsk(frontierChat);

		let semantic = {};
		const localModel = opts['local-model'] ? String(opts['local-model']) : process.env.LOCAL_MODEL;
		if ( localModel ) semantic = makeLocalCoverage({ localAsk: makeLocalAsk({ modelPath: localModel, reasoningBudget: 0 }) });

		const px = createProxyCache(Object.assign({ frontierAsk, store: opts.store ? String(opts.store) : undefined, retention: true }, semantic));

		// a long-running server defaults to VISIBLE request lines (--log-level warn silences them)
		const { logger, consoleLevel } = buildLogger({ ...opts, 'log-level': opts['log-level'] || 'log' });
		logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel }));
		process.stderr.write(banner(pkg.version, !!process.stderr.isTTY) + '\n');

		const { createServeHandler, startServeServer } = require('./serve.js');
		const { formatProxyReport } = require('./proxy-run.js');
		const handler = createServeHandler({
			proxy: px, model: opts.model ? String(opts.model) : undefined,
			onAnswer: ( row ) => logger.log('[' + (row.source === 'local' ? 'cache' : 'frontier') + '] ' + row.query)
		});
		const port = Number(opts.port) || 4747;
		const host = opts.host ? String(opts.host) : '127.0.0.1';
		const srv = startServeServer({ handler, port, host, onReady: () => {
			out('sg serve → http://' + host + ':' + port + '/v1   (OpenAI-compatible; point a client\'s baseURL here)');
		} });
		process.on('SIGINT', () => {
			const m = px.metrics();
			process.stderr.write('\n' + formatProxyReport(m, m.local) + '\n');
			srv.close(() => process.exit(0));
			setTimeout(() => process.exit(0), 500).unref();
		});
		break;
	}
	case 'mcp': {
		// sg mcp — the MCP TOOLS server (stdio JSON-RPC; roadmap FINIR F2): the agentic surface, where the
		// TYPED capabilities are tools (ask → answer OR a STRUCTURED typed refusal; lattice_load = learning
		// through the version-gated admission; trace_tail = the debug contract). stdout is the PROTOCOL
		// channel — banner/logs go to stderr ONLY. Two modes (same model resolution as ask/proxy):
		//   --concepts <dir> (+ --local-model <gguf> | env LOCAL_MODEL | LLM_BASE)   TYPED appliance
		//   --frontier-model <gguf> | env FRONTIER_MODEL | env LLM_BASE              C6 proxy
		//   [--local-model <gguf>] (proxy: semantic coverage)   [--store <file.json>] durable stock
		// Register with a host:  claude mcp add sg -- node bin/sg mcp --frontier-model <gguf> --store ./stock.json
		const opts = parseFlags(argv.slice(1));
		const { logger, consoleLevel } = buildLogger(opts);
		logger.addSink(createPlainSink({ stream: process.stderr, level: consoleLevel }));
		process.stderr.write(banner(pkg.version, !!process.stderr.isTTY) + '\n');

		const { createMcpServer, defaultTools, startMcpStdio } = require('./mcp.js');
		const wiring = { logger };
		const localModel = opts['local-model'] ? String(opts['local-model']) : process.env.LOCAL_MODEL;
		if ( opts.concepts ) {
			let backend;
			if ( localModel ) backend = { localModel };
			else if ( process.env.LLM_BASE ) backend = require('../providers/llm.js').makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022' });
			else die('mcp --concepts needs an LLM backend: --local-model <gguf> (or env LOCAL_MODEL), or set LLM_BASE');
			wiring.appliance = require('../index.js').combos.createAppliance({ concepts: opts.concepts, ask: backend, logger });
		} else {
			const { createProxyCache, makeFrontierAsk, makeLocalCoverage } = require('../index.js').combos;
			const { makeLocalAsk } = require('../providers/llm-local.js');
			const frontierModel = opts['frontier-model'] ? String(opts['frontier-model']) : process.env.FRONTIER_MODEL;
			let frontierChat;
			if ( frontierModel ) frontierChat = makeLocalAsk({ modelPath: frontierModel, reasoningBudget: 0 });
			else if ( process.env.LLM_BASE ) frontierChat = require('../providers/llm.js').makeAsk({ base: process.env.LLM_BASE, model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022' });
			else die('mcp needs a backend: --concepts <dir> (typed appliance) or --frontier-model <gguf> / env FRONTIER_MODEL / LLM_BASE (proxy)');
			let semantic = {};
			if ( localModel ) semantic = makeLocalCoverage({ localAsk: makeLocalAsk({ modelPath: localModel, reasoningBudget: 0 }) });
			wiring.proxy = createProxyCache(Object.assign({ frontierAsk: makeFrontierAsk(frontierChat), store: opts.store ? String(opts.store) : undefined, retention: true }, semantic));
		}
		const server = createMcpServer({ tools: defaultTools(wiring), serverInfo: { name: 'skynet-graph', version: pkg.version } });
		startMcpStdio({ server });
		process.stderr.write('sg mcp ready — tools: ' + server.tools.map(( t ) => t.name).join(', ') + '\n');
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
	case 'methods': {
		const a = loadArtifact(argv[1]);
		const { describeLibrary, formatLibrary } = require('../authoring/method-explorer.js');
		const source = (a && a.format === 'sgc' && a.kind === 'methods') ? (a.methods || []) : a;   // a .sgc methods bundle or a bare library
		let registry = null;
		const ri = argv.indexOf('--registry');
		if ( ri !== -1 && argv[ri + 1] ) {
			try { const rf = JSON.parse(fs.readFileSync(argv[ri + 1], 'utf8')); registry = rf && rf.registry ? rf.registry : rf; }   // a .sgc lattice bundle or a bare registry
			catch ( e ) { die('cannot read registry ' + argv[ri + 1] + ': ' + e.message); }
		}
		out(formatLibrary(describeLibrary(source, registry ? { registry } : {})));
		break;
	}
	default:
		out([
			'sg— Skynet-Graph CLI',
			'  sg studio   [--root <dir>] [--port N] [--open] [--log-level <lvl>] [--log-plain] [--log-file <path>]',
			'              visual debug/run UI; graph logs stream to the terminal (bottom status bar on a TTY,',
			'              or --log-plain for log-only with periodic stats lines)',
			'  sg run      --concepts <dir> [--providers <dir>] [--builtins] [--sets a,b]',
			'              [--seed <file>] [--trace <out>] [--json] [--timeout <ms>]',
			'              [--log-level error|warn|log|info|verbose] [--log-mode dashboard|plain]',
			'              [--log-plain] [--log-file <path>] [--log-file-level <level>]',
			'  sg ask      "<question>" [--concepts <dir>] [--local-model <gguf> | (env LLM_BASE)] [--depth N] [--json]',
			'              typed QA appliance with --concepts (intake→reason→typed refusal→memo; a refusal',
			'              names the missing requirement); legacy best-effort loop without it. Embedded',
			'              local model or LLM_BASE; answer → stdout, logs → stderr',
			'  sg proxy    ["<question>"] --frontier-model <gguf> | (env FRONTIER_MODEL | LLM_BASE)',
			'              [--local-model <gguf>] [--store <file.json>] [--json]',
			'              local-first proxy cache (C6): a covered query is served from the local stock at',
			'              0 frontier calls, a miss escalates + enriches. 0 hallucination (verified stock or',
			'              escalate), no false neg. No question → reads a session from stdin (one/line).',
			'              --local-model adds semantic coverage (a paraphrase hits the stock). Economy → stderr',
			'  sg serve    --frontier-model <gguf> | (env FRONTIER_MODEL | LLM_BASE)',
			'              [--local-model <gguf>] [--store <file.json>] [--port N] [--host <addr>] [--model <id>]',
			'              OpenAI-COMPATIBLE endpoint over the C6 proxy: point any OpenAI client baseURL at',
			'              http://host:port/v1 — a covered query is served from the local stock at 0 frontier',
			'              calls, a miss escalates + enriches. Provenance headers x-sg-* + usage.sg_* on every',
			'              completion; per-request lines → stderr; Ctrl-C prints the economy report',
			'  sg mcp      --concepts <dir> | --frontier-model <gguf> | (env FRONTIER_MODEL | LLM_BASE)',
			'              [--local-model <gguf>] [--store <file.json>]',
			'              MCP tools server (stdio JSON-RPC) for agent hosts: ask (answer OR a STRUCTURED',
			'              typed refusal naming the missing requirement), drift/metrics, lattice_load (learning',
			'              through the version-gated admission — no direct-write tool), methods_describe,',
			'              lattice_rings, trace_tail. Register: claude mcp add sg -- node bin/sg mcp …',
			'  sg trace    <file>      list concept-applies',
			'  sg show     <file> <n>  detail of record n (prompt/reply/patch/why)',
			'  sg concepts <file>      per-concept rollup (count + total ms)',
			'  sg errors   <file>      applies that flagged an llmError',
			'  sg methods  <file.sgc> [--registry <lattice.sgc>]',
			'              list a concept-method population (title/category/description) + judge it:',
			'              class distribution, OPENNESS (distinct classes, singletons, entropy) and',
			'              COVERAGE vs a declared vocabulary (which task-classes have a method / the GAPS)'
		].join('\n'));
		process.exit(cmd ? 1 : 0);
}
