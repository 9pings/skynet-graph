/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * `sg mcp` — the MCP (Model Context Protocol) TOOLS server (roadmap FINIR, F2): the agentic surface where the
 * TYPED capabilities become tools an agent host (Claude Code, any MCP client) consumes. Where `sg serve` sells
 * the economy behind a generic chat wire, THIS surface exposes the differentiators STRUCTURED:
 *   • `ask` — answer OR the TYPED REFUSAL as data ({status:'refused', reason, missing:[…]} — a refusal is a
 *     typed ANSWER that names the missing requirement, never an error string);
 *   • `drift` / `metrics` — anti-drift invalidation + the economy readout (proxy mode);
 *   • `lattice_load` — LEARNING THROUGH THE GATE: a `.sgc kind:'lattice'` bundle grows the held registry via
 *     `loadLattice` (version-gated, conflicting rings REJECTED by the confluence-checked merge). There is NO
 *     tool that writes the stock or the registry directly — enrichment is ask-escalation or this gated load;
 *   • `methods_describe` / `lattice_rings` — the explorer bricks à nu (pure file reads, no model);
 *   • `trace_tail` — the debug contract: the shared logger's ring buffer, filterable {level, concept, applyId}.
 *
 * THIN assembly (doctrine): `createMcpServer` is a PURE JSON-RPC dispatcher (stub-testable, no pipe),
 * `defaultTools` wires tools onto the existing combos/bricks, `startMcpStdio` is the zero-dep stdio transport
 * (one JSON-RPC message per line — the MCP stdio framing). GPU-bound model resolution stays in cli.js.
 * stdout is the PROTOCOL channel: a host process must log to stderr only.
 *
 * Register with an MCP host, e.g.:  claude mcp add sg -- node bin/sg mcp --frontier-model <gguf> --store ./stock.json
 */

var fs = require('fs');

var PROTOCOL_VERSION = '2024-11-05';

/** Read + parse a JSON artifact (a `.sgc` bundle or a bare JSON file). Throws a plain Error on failure. */
function readJson( file ) {
	return JSON.parse(fs.readFileSync(String(file), 'utf8'));
}

/**
 * The default tool set over the existing bricks. Every tool is { name, description, inputSchema, call(args) };
 * `call` returns the STRUCTURED result (the server wraps it in MCP content). Wire what the host resolved:
 * @param w.proxy      a createProxyCache instance (proxy mode: ask/drift/metrics/lattice_load).
 * @param w.appliance  a createAppliance instance (typed-QA mode: ask returns answer OR the typed refusal).
 * @param w.logger     the shared logger (trace_tail). Optional.
 */
function defaultTools( w ) {
	w = w || {};
	var tools = [];
	var q = { type: 'object', properties: { query: { type: 'string', description: 'the question' } }, required: ['query'] };

	if ( w.appliance || w.proxy ) tools.push({
		name: 'ask',
		description: w.appliance
			? 'Typed QA: answer from the declared domain, or a TYPED REFUSAL naming the missing requirement ({status, answer?, reason?, missing?[]}). A refusal is data, not an error.'
			: 'Local-first proxy ask: a covered query is served from the verified local stock (0 frontier calls), a miss escalates to the frontier and enriches the stock ({answer, source, cached, cost}).',
		inputSchema: q,
		call: async function ( a ) {
			if ( w.appliance ) return await w.appliance.answer(String(a.query));
			var r = await w.proxy.answer(String(a.query));
			return { answer: r.answer, source: r.source, cached: !!r.cached, cost: r.cost };
		}
	});

	if ( w.proxy ) {
		tools.push({
			name: 'drift',
			description: 'Anti-drift: invalidate the stock entry covering this query — the next ask re-escalates to the frontier.',
			inputSchema: q,
			call: async function ( a ) { await w.proxy.drift(String(a.query)); return { drifted: true, query: String(a.query) }; }
		});
		tools.push({
			name: 'metrics',
			description: 'The proxy economy readout: served/local/frontier counts, coverage, stock size/reuse.',
			inputSchema: { type: 'object', properties: {} },
			call: async function () { return w.proxy.metrics(); }
		});
		if ( w.proxy.library && typeof w.proxy.library.loadLattice === 'function' ) tools.push({
			name: 'lattice_load',
			description: 'LEARN THROUGH THE GATE: load a `.sgc kind:\'lattice\'` bundle — the held registry grows via the version-gated admission merge (a conflicting ring is REJECTED, never merged). The only registry write path.',
			inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'path to a .sgc lattice bundle' } }, required: ['file'] },
			call: async function ( a ) { return w.proxy.library.loadLattice(readJson(a.file)); }
		});
	}

	// the explorer bricks à nu — pure file reads, standalone value (no model, no graph).
	tools.push({
		name: 'methods_describe',
		description: 'Describe a concept-method population from a `.sgc kind:\'methods\'` bundle (or a bare library JSON): titles/categories, class distribution, openness (entropy/singletons), coverage vs a declared vocabulary.',
		inputSchema: { type: 'object', properties: { file: { type: 'string' }, registry: { type: 'string', description: 'optional .sgc lattice file for coverage' } }, required: ['file'] },
		call: async function ( a ) {
			var describeLibrary = require('../authoring/method-explorer.js').describeLibrary;
			var art = readJson(a.file);
			var source = (art && art.format === 'sgc' && art.kind === 'methods') ? (art.methods || []) : art;
			var opts = {};
			if ( a.registry ) { var rf = readJson(a.registry); opts.registry = rf && rf.registry ? rf.registry : rf; }
			return describeLibrary(source, opts);
		}
	});
	tools.push({
		name: 'lattice_rings',
		description: 'List the admitted synonym-ring aliases of a `.sgc kind:\'lattice\'` bundle ({key, member, alias} rows), optionally filtered by member or alias substring.',
		inputSchema: { type: 'object', properties: { file: { type: 'string' }, filter: { type: 'string', description: 'optional substring over key/member/alias' } }, required: ['file'] },
		call: async function ( a ) {
			var lp = require('../authoring/lattice-pack.js');
			var art = readJson(a.file);
			var reg;
			try { reg = lp.unpackLattice(art).registry; }        // a .sgc lattice bundle…
			catch ( e ) { reg = (art && art.registry) || art; }  // …or a bare registry JSON (à-nu)
			var rows = lp.ringsOf(reg);
			if ( a.filter ) {
				var f = String(a.filter).toLowerCase();
				rows = rows.filter(function ( r ) { return (r.key + ' ' + r.member + ' ' + r.alias).toLowerCase().indexOf(f) !== -1; });
			}
			return { rings: rows, count: rows.length };
		}
	});

	if ( w.logger && typeof w.logger.tail === 'function' ) tools.push({
		name: 'trace_tail',
		description: 'Debug: the last N records of the shared log ring buffer, filterable by level/concept/target/applyId — the same records `sg trace` joins by applyId.',
		inputSchema: {
			type: 'object',
			properties: {
				n: { type: 'number', description: 'max records (default 20)' },
				level: { type: 'string' }, concept: { type: 'string' }, target: { type: 'string' }, applyId: { type: 'string' }
			}
		},
		call: async function ( a ) {
			a = a || {};
			var filter = {};
			['level', 'concept', 'target', 'applyId'].forEach(function ( k ) { if ( a[k] != null ) filter[k] = a[k]; });
			return { records: w.logger.tail(a.n || 20, Object.keys(filter).length ? filter : undefined) };
		}
	});

	return tools;
}

/**
 * The PURE MCP server: JSON-RPC 2.0 dispatch over a tool set (no pipe — stub-testable; the transport writes
 * whatever `handle` returns, and a null return means "notification, no response").
 * @param opts.tools       [{ name, description, inputSchema, call }] (see defaultTools).
 * @param opts.serverInfo  { name, version } advertised on initialize.
 * @returns {{ handle: async (msg) => response|null, tools }}
 */
function createMcpServer( opts ) {
	opts = opts || {};
	var tools = opts.tools || [];
	var serverInfo = opts.serverInfo || { name: 'skynet-graph', version: '0.0.0' };
	var byName = {};
	tools.forEach(function ( t ) { byName[t.name] = t; });

	var reply = function ( id, result ) { return { jsonrpc: '2.0', id: id, result: result }; };
	var rpcError = function ( id, code, message ) { return { jsonrpc: '2.0', id: id, error: { code: code, message: message } }; };

	return {
		tools: tools,
		handle: async function ( msg ) {
			if ( !msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' ) return rpcError(msg && msg.id != null ? msg.id : null, -32600, 'invalid JSON-RPC 2.0 message');
			var id = msg.id, method = msg.method, params = msg.params || {};
			var notification = (id === undefined);

			switch ( method ) {
				case 'initialize':
					return reply(id, {
						protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
						capabilities: { tools: {} },
						serverInfo: serverInfo
					});
				case 'notifications/initialized':
				case 'notifications/cancelled':
					return null;   // notifications get no response
				case 'ping':
					return reply(id, {});
				case 'tools/list':
					return reply(id, { tools: tools.map(function ( t ) { return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }) });
				case 'tools/call': {
					var tool = byName[params.name];
					if ( !tool ) return rpcError(id, -32602, 'unknown tool: ' + params.name);
					try {
						var result = await tool.call(params.arguments || {});
						// STRUCTURED first (a typed refusal is data): text mirror for hosts without structuredContent.
						return reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
					}
					catch ( e ) {
						// a TOOL failure is a tool-level error (isError), not a protocol error — the host shows it.
						return reply(id, { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
					}
				}
				default:
					return notification ? null : rpcError(id, -32601, 'method not found: ' + method);
			}
		}
	};
}

/**
 * The zero-dep stdio transport: one JSON-RPC message per line (the MCP stdio framing). Injectable streams for
 * tests; a parse failure answers a JSON-RPC -32700 instead of crashing the server.
 * @param o.server  a createMcpServer instance.
 * @param o.input   readable (default process.stdin);  o.output writable (default process.stdout).
 * @returns {{ close }}
 */
function startMcpStdio( o ) {
	o = o || {};
	if ( !o.server || typeof o.server.handle !== 'function' ) throw new Error('startMcpStdio needs o.server (a createMcpServer instance)');
	var input = o.input || process.stdin, output = o.output || process.stdout;
	var buf = '';
	var write = function ( res ) { if ( res ) output.write(JSON.stringify(res) + '\n'); };
	// responses go out in ARRIVAL order (a promise chain) — a sync parse error must not overtake the async
	// handling of an earlier message.
	var chain = Promise.resolve();
	var enqueue = function ( job ) { chain = chain.then(job, job); };
	// the parameter CAPTURES the message per line — several lines can coalesce into one data chunk, and a
	// loop-scoped `var` would leave every queued job handling the LAST parsed message.
	var handleLine = function ( msg ) {
		enqueue(function () {
			return Promise.resolve(o.server.handle(msg)).then(write, function ( e ) {
				write({ jsonrpc: '2.0', id: msg && msg.id != null ? msg.id : null, error: { code: -32603, message: String(e && e.message || e) } });
			});
		});
	};
	var onData = function ( d ) {
		buf += d;
		var nl;
		while ( (nl = buf.indexOf('\n')) !== -1 ) {
			var line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if ( !line ) continue;
			var msg;
			try { msg = JSON.parse(line); }
			catch ( e ) { enqueue(function () { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }); continue; }
			handleLine(msg);
		}
	};
	input.setEncoding && input.setEncoding('utf8');
	input.on('data', onData);
	return { close: function () { input.removeListener('data', onData); } };
}

module.exports = { createMcpServer: createMcpServer, defaultTools: defaultTools, startMcpStdio: startMcpStdio };
