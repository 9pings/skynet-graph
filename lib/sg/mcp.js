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

	// C9 — the external CRITICAL MIND as a tool (design A5, rhetoric lanes). The host LLM supplies the
	// topic (+ optional statements/viewpoints); the lib runs ITS local model through the witness-gated
	// loop and returns the typed LEDGER + a certification-aware verdict. The frame status
	// (FREE/MATERIAL/DECLARED) is ALWAYS in the payload; below the measured margin bound the verdict is
	// an honest UNDECIDED — the ledger + counts are the deliverable, never a fake weighing.
	if ( typeof w.critiqueAsk === 'function' ) tools.push({
		name: 'critique',
		description: 'Run the external critical mind on a question: declared viewpoints established through a witness gate over a statement pool, anchored generation of missing theses (0-fabrication), typed ledger, per-side synthesis, and a certification-aware verdict (mechanical only at the measured margin bound; otherwise UNDECIDED with counts). Supply `statements` ("PRO: ..."/"CON: ..." lines) to critique YOUR material (frame MATERIAL) and/or `viewpoints` to declare the frame (DECLARED); with neither, the pool is model-brainstormed and the payload SAYS so (frame FREE).',
		inputSchema: { type: 'object', properties: {
			topic: { type: 'string', description: 'the question under critique' },
			statements: { type: 'array', items: { type: 'string' }, description: 'optional pool, one statement per entry, each prefixed "PRO: " or "CON: "' },
			viewpoints: { type: 'array', items: { type: 'string' }, description: 'optional declared viewpoints (the decision frame becomes DECLARED)' },
			polish: { type: 'boolean', description: 'add a presentation-only rewrite of the prose (content-locked)' },
		}, required: ['topic'] },
		call: async function ( a ) {
			// the GRAMMAR face (same signature/result — parity is test-enforced vs the imperative
			// reference, critique-grammar-parity.test.js): the debate runs as a concept set on the
			// engine, the ledger IS the graph. factory.js stays exported as the imperative fallback.
			if ( !w._criticalMind ) w._criticalMind = require('../../plugins/critical-mind/factory-grammar.js').createCriticalMind({ ask: w.critiqueAsk });
			var r = await w._criticalMind.run({ topic: String(a.topic), statements: a.statements, viewpoints: a.viewpoints, polish: !!a.polish });
			// The ITERATION CONTRACT (the server cannot reach the web/host tools — YOU can): OPEN points
			// and a sub-threshold margin are a TYPED REQUEST FOR DATA. Gather real statements that bear
			// on them (web, docs, your context), then call `critique` again with `statements` — the frame
			// upgrades to MATERIAL and the loop converges at the host level (bounded rounds are yours).
			var open = (r.ledger || []).filter(function ( e ) { return e.status === 'open'; });
			var advice = null;
			if ( r.error ) advice = 'pool too small: supply `statements` ("PRO: ..."/"CON: ..." entries).';
			else if ( open.length || r.verdict === 'UNDECIDED' ) advice = 'This is a typed data request, not a dead end: '
				+ (open.length ? 'gather statements that genuinely bear on the OPEN points [' + open.map(function ( e ) { return e.text.slice(0, 50); }).join(' · ') + '] ' : '')
				+ (r.verdict === 'UNDECIDED' ? 'and/or on whichever side you believe is under-evidenced ' : '')
				+ 'from sources YOU can reach (web/docs), then call critique again with statements=[...] — the frame becomes MATERIAL and the margin can move honestly.';
			return { frameStatus: r.frameStatus, verdict: r.verdict, basis: r.basis, norm: r.norm, counts: r.counts, margin: r.margin, threshold: r.threshold,
				ledger: r.ledger, synthesis: r.synthesis, prose: r.polished || r.prose, advice: advice, error: r.error };
		}
	});

	// ── the ASSISTANT lanes (design 2026-07-10, owner-approved): the lib as the LLM's assistant. TWO EXPLICIT
	// LANES — SOFT (advisory, no guarantee, says so) and HARD (gated, typed verdict, NON-BYPASSABLE: forcing
	// downgrades PROVENANCE, never the admission) — plus the INSTANCES lane (the P3 shared-instance pool).

	// SOFT: `hint` — the orientation menu (certified shapes, slot-glossed). Score lever, no guarantee attached.
	if ( w.hints && Array.isArray(w.hints.certifiedShapes) ) tools.push({
		name: 'hint',
		description: 'SOFT lane (advisory, no guarantee): the certified-shape menu for this query, slot-glossed — orientation lifts the score (+13 to +36 pts measured) but admission is a separate, gated step (`propose`).',
		inputSchema: q,
		call: async function ( a ) {
			var qualifyMenu = require('../../plugins/mixture-serve/factory.js').qualifyMenu;
			var shapes = (typeof w.hints.proposeMenu === 'function' && w.hints.proposeMenu(String(a.query))) || w.hints.certifiedShapes;
			return { menu: w.hints.gloss ? qualifyMenu(shapes, w.hints.gloss) : shapes.slice(), advisory: true, certified: true };
		}
	});

	// HARD: `propose` — the negotiate step exposed (the LLM host IS the proposer; bounded rounds are its discipline).
	if ( w.gate && typeof w.gate.check === 'function' ) tools.push({
		name: 'propose',
		description: 'HARD lane (the gate NEVER yields): submit a typed proposal — admitted, or refused with blame + the admissible options ENUMERATED THROUGH the gate (tested, never guessed). force=true does NOT admit: it records the result as untrusted provenance (traced, auditable, outside the certified layer).',
		inputSchema: { type: 'object', properties: {
			proposal: { type: 'object', description: 'the typed proposal (domain-shaped)' },
			force: { type: 'boolean', description: 'insist despite a refusal — recorded untrusted, never admitted' }
		}, required: ['proposal'] },
		call: async function ( a ) {
			var v = await w.gate.check(a.proposal);
			if ( v && v.ok ) return { status: 'admitted', certified: true };
			var blame = (v && v.blame) || 'refused';
			if ( a.force ) {
				if ( typeof w.gate.record === 'function' ) w.gate.record(a.proposal, { forced: true, blame: blame });
				return { status: 'recorded-untrusted', certified: false, blame: blame };
			}
			var options = [];
			if ( typeof w.gate.optionsOf === 'function' ) {
				var cands = (await w.gate.optionsOf(a.proposal)) || [];
				for ( var i = 0; i < cands.length && options.length < 8; i++ ) {
					var ov = await w.gate.check(cands[i]);
					if ( ov && ov.ok ) options.push(cands[i]);
				}
			}
			return { status: 'refused', blame: blame, options: options };
		}
	});

	// SOFT: `state_recall` + gated `state_note` — the CERTIFIED TASK-STATE (synthesized by stabilization/JTMS,
	// bounded projection — not an append log). `note` posts a TYPED fact through the host's SEQUENCED ingest.
	if ( w.state && typeof w.state.recall === 'function' ) tools.push({
		name: 'state_recall',
		description: 'SOFT lane (advisory read): the synthesized task-state — typed facts with provenance + the open frontier, bounded projection (Σ_sep). A drifted premise RETRACTS its facts (JTMS), it does not rot.',
		inputSchema: { type: 'object', properties: {} },
		call: async function () { return w.state.recall(); }
	});
	if ( w.state && typeof w.state.note === 'function' ) tools.push({
		name: 'state_note',
		description: 'Post ONE typed fact ({key, value}) to the task-state through the sequenced ingest (never an out-of-band write); the graph synthesizes — the note lands with provenance and is retractable.',
		inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key'] },
		call: async function ( a ) { return await w.state.note({ key: String(a.key), value: a.value }); }
	});

	// INSTANCES: the P3 shared-instance pool — invoke a concept-method by contract key; list/release instances.
	if ( w.pool && typeof w.pool.invoke === 'function' ) {
		tools.push({
			name: 'graph_invoke',
			description: 'Invoke a concept-method on its SHARED instance (P3 pool, keyed by contract): stabilizes the seed on a fresh graph in the worker and returns ONLY the bounded projection (summaryFacts + write-footprint) — a refusal (frontier drift / post-violation) is a typed answer.',
			inputSchema: { type: 'object', properties: {
				libraryKey: { type: 'string', description: 'the contract/dispatch key' },
				seed: { type: 'object', description: 'the case seed (slot bindings included)' }
			}, required: ['libraryKey'] },
			call: async function ( a ) { return await w.pool.invoke(String(a.libraryKey), { seed: a.seed }); }
		});
		tools.push({
			name: 'graph_instances',
			description: 'The instance lifecycle: list the pooled graph instances (keys, uses) or release one (`release`: its next invoke re-creates it fresh — deactivation, not deletion of anything learned).',
			inputSchema: { type: 'object', properties: { release: { type: 'string', description: 'optional key to release' } } },
			call: async function ( a ) {
				a = a || {};
				if ( a.release ) { var okE = w.pool.evict(String(a.release)); return { released: a.release, ok: okE !== false }; }
				var st = w.pool.stats();
				return { keys: w.pool.keys(), instances: st.instances, uses: st.uses };
			}
		});
	}

	// SOFT: `plan_sync` — the graph plan mirrored onto the HOST's native task list, AT THE HOST'S CHOICE
	// (pull-based: the LLM calls it when it wants a mirror, or never). MCP cannot invoke host tools, so the
	// graph EMITS a typed delta the host applies verbatim (TaskCreate/TaskUpdate, TodoWrite, …).
	if ( w.plan && typeof w.plan.snapshot === 'function' ) ( function () {
		var mirrorState = null;
		tools.push({
			name: 'plan_sync',
			description: 'SOFT lane, OPTIONAL (your choice, pull-based): the typed delta between the graph\'s multistep plan and the last sync — apply the ops VERBATIM to your native task system (create/update/complete/reopen). `complete` means GATE-ADMITTED (not claimed); `reopen` fires when a completed step\'s premise DRIFTED (JTMS retraction). reset=true resends the full state.',
			inputSchema: { type: 'object', properties: { reset: { type: 'boolean', description: 'resend the full plan state' } } },
			call: async function ( a ) {
				if ( a && a.reset ) mirrorState = null;
				var r = require('../authoring/core/task-mirror.js').diffPlanToTaskOps(await w.plan.snapshot(), mirrorState);
				mirrorState = r.mirror;
				return { taskOps: r.ops };
			}
		});
	} )();

	// the explorer bricks à nu — pure file reads, standalone value (no model, no graph).
	tools.push({
		name: 'methods_describe',
		description: 'Describe a concept-method population from a `.sgc kind:\'methods\'` bundle (or a bare library JSON): titles/categories, class distribution, openness (entropy/singletons), coverage vs a declared vocabulary.',
		inputSchema: { type: 'object', properties: { file: { type: 'string' }, registry: { type: 'string', description: 'optional .sgc lattice file for coverage' } }, required: ['file'] },
		call: async function ( a ) {
			var describeLibrary = require('../../plugins/learning/lib/method-explorer.js').describeLibrary;
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
			var lp = require('../authoring/lattice/lattice-pack.js');
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

/**
 * stockWiring — a `.sgc kind:'methods'` bundle (or bare {methods}) → the ASSISTANT wirings (hints + gate) over
 * its certified vocabulary (the per-method class key `structure.taskKind`). The cli.js `--stock` bridge: `hint`
 * serves the certified menu, `propose` gates a {shape} proposal against the frozen referential and enumerates
 * the admissible options. Fail-fast on an empty bundle (a silent empty referential would refuse everything).
 */
function stockWiring( bundle ) {
	var methods = (bundle && (bundle.methods || (bundle.format === 'sgc' && bundle.kind === 'methods' && bundle.methods))) || null;
	var seen = Object.create(null);
	(methods || []).forEach(function ( m ) { var k = m && m.structure && m.structure.taskKind; if ( k ) seen[k] = true; });
	var shapes = Object.keys(seen).sort();
	if ( !shapes.length ) throw new Error('stockWiring: no certified shapes in the stock bundle (need .sgc kind:methods with structure.taskKind per method)');
	return {
		hints: { certifiedShapes: shapes },
		gate: {
			check: function ( p ) { return shapes.indexOf(p && p.shape) >= 0 ? { ok: true } : { ok: false, blame: 'shape "' + (p && p.shape) + '" ∉ certified referential (' + shapes.length + ' shapes)' }; },
			optionsOf: function () { return shapes.map(function ( shape ) { return { shape: shape }; }); }
		}
	};
}

module.exports = { createMcpServer: createMcpServer, defaultTools: defaultTools, startMcpStdio: startMcpStdio, stockWiring: stockWiring };
