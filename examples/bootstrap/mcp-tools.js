/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP surface #2 — the MCP TOOLS server (`sg mcp`): the agentic surface, where the TYPED
 * capabilities are tools an MCP host (Claude Code, any client) consumes.
 * THE GUARANTEE SHOWN: `ask` returns data either way — the answer WITH provenance, or the TYPED REFUSAL
 * that names the missing requirement ({status:'refused', reason, missing[]} — never an error string, never
 * a wrong answer); the economy is visible through `metrics`; there is NO direct-write tool (learning goes
 * through ask-escalation or the version-gated `lattice_load`).
 *
 * Self-contained: drives the PURE server (the stdio transport is one line more). In production:
 *   claude mcp add sg -- node bin/sg mcp --frontier-model <path.gguf> --store ./stock.json
 */
const assert = require('node:assert');
const { createMcpServer, defaultTools } = require('../../lib/sg/mcp.js');
const { createProxyCache, makeFrontierAsk } = require('../../lib/index.js').factories;

async function main() {
	// ── proxy mode: ask/drift/metrics over the local-first cache ────────────────────────────────────────
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(async ( { user } ) => 'verified: ' + user), retention: true });
	const srv = createMcpServer({ tools: defaultTools({ proxy: px }), serverInfo: { name: 'skynet-graph', version: 'demo' } });
	const call = ( id, name, args ) => srv.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

	const tools = (await srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
	console.log('tools   :', tools.map(( t ) => t.name).join(', '));
	assert.ok(!tools.some(( t ) => /write|insert|set_/.test(t.name)), 'no direct-write tool on the surface');

	const a1 = (await call(2, 'ask', { query: 'capital of France?' })).result.structuredContent;
	const a2 = (await call(3, 'ask', { query: 'capital of France?' })).result.structuredContent;
	console.log('ask ×2  : [' + a1.source + '] then [' + a2.source + '] → ' + a2.answer);
	assert.equal(a2.source, 'local', 'the repeat is served from the stock through MCP');

	// ── appliance mode: the TYPED REFUSAL is structured DATA (the differentiator) ───────────────────────
	const appliance = { answer: async ( q ) => /france/i.test(q)
		? { status: 'answered', answer: 'Paris', confBand: 'high' }
		: { status: 'refused', reason: 'required fact out of declared vocabulary', missing: ['kind'] } };
	const typed = createMcpServer({ tools: defaultTools({ appliance }), serverInfo: { name: 'sg-typed', version: 'demo' } });
	const refusal = (await typed.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call',
		params: { name: 'ask', arguments: { query: 'zzz?' } } })).result;
	console.log('refusal :', JSON.stringify(refusal.structuredContent));
	assert.equal(refusal.isError, false, 'a refusal is a typed ANSWER, not an error');
	assert.deepEqual(refusal.structuredContent.missing, ['kind'], 'the refusal NAMES the miss, structured');

	console.log('BOOTSTRAP OK — typed tools surface: structured answers + structured refusals, no direct-write tool');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
