'use strict';
// `sg mcp` — the MCP tools server (roadmap FINIR F2). Deterministic (stub backends, no GPU). Under test: the
// PURE JSON-RPC dispatch (handshake, tools/list, tools/call, errors), the TYPED REFUSAL arriving STRUCTURED
// (data, not an error string), the proxy economy visible through MCP, LEARNING THROUGH THE GATE (lattice_load
// routes via loadLattice; NO direct-write tool exists), the explorer tools à nu, and the stdio wire framing.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { createMcpServer, defaultTools, startMcpStdio } = require('../../lib/sg/mcp.js');
const { createProxyCache, makeFrontierAsk } = require('../../lib/factories/proxy-cache.js');
const { packLattice } = require('../../lib/authoring/lattice/lattice-pack.js');
const { createLogger } = require('../../lib/graph/log.js');

function stubChat() {
	const calls = { n: 0 };
	const ask = async ( { user } ) => { calls.n++; return 'A:' + user; };
	return { ask, calls };
}
function server( wiring ) {
	return createMcpServer({ tools: defaultTools(wiring), serverInfo: { name: 'skynet-graph', version: '1.0.0-test' } });
}
const call = ( srv, id, name, args ) => srv.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('mcp — handshake: initialize advertises tools + serverInfo; initialized notification gets NO response; ping pongs', async () => {
	const srv = server({});
	const init = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } } });
	assert.equal(init.jsonrpc, '2.0');
	assert.equal(init.result.protocolVersion, '2025-03-26', 'the client protocol version is echoed');
	assert.deepEqual(init.result.capabilities, { tools: {} });
	assert.equal(init.result.serverInfo.name, 'skynet-graph');
	assert.equal(await srv.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification gets no response');
	assert.deepEqual((await srv.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).result, {});
	const lost = await srv.handle({ jsonrpc: '2.0', id: 3, method: 'no/such' });
	assert.equal(lost.error.code, -32601);
});

test('mcp — tools/list: proxy wiring exposes ask/drift/metrics/lattice_load + explorers; NO direct-write tool exists', async () => {
	const { px } = { px: createProxyCache({ frontierAsk: makeFrontierAsk(stubChat().ask) }) };
	const srv = server({ proxy: px, logger: createLogger({ console: false }) });
	const r = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
	const names = r.result.tools.map(( t ) => t.name);
	assert.deepEqual(names.sort(), ['ask', 'drift', 'lattice_load', 'lattice_rings', 'methods_describe', 'metrics', 'trace_tail']);
	r.result.tools.forEach(( t ) => { assert.ok(t.description.length > 20); assert.equal(t.inputSchema.type, 'object'); });
	// the learn-through-the-gate NEGATIVE: no tool writes the stock or the registry directly.
	assert.ok(!names.some(( n ) => /set|write|put|insert|add_(entry|answer)/.test(n)), 'no direct-write tool on the surface');
});

test('mcp — ask (proxy): economy THROUGH MCP — first structured answer escalates, the repeat is served local', async () => {
	const c = stubChat();
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(c.ask), retention: true });
	const srv = server({ proxy: px });
	const r1 = await call(srv, 1, 'ask', { query: 'capital of France?' });
	assert.equal(r1.result.isError, false);
	assert.deepEqual(r1.result.structuredContent, { answer: 'A:capital of France?', source: 'frontier', cached: false, cost: 1 });
	assert.equal(JSON.parse(r1.result.content[0].text).source, 'frontier', 'the text content mirrors the structured result');
	const r2 = await call(srv, 2, 'ask', { query: 'capital of France?' });
	assert.equal(r2.result.structuredContent.source, 'local', 'the repeat is served from the stock through MCP');
	assert.equal(c.calls.n, 1, '0 new frontier calls on the repeat');
	const m = await call(srv, 3, 'metrics', {});
	assert.equal(m.result.structuredContent.coverage, 0.5);
	// drift → the next ask re-escalates (anti-drift through MCP).
	await call(srv, 4, 'drift', { query: 'capital of France?' });
	await call(srv, 5, 'ask', { query: 'capital of France?' });
	assert.equal(c.calls.n, 2, 'the drifted entry re-escalated');
});

test('mcp — ask (appliance): the TYPED REFUSAL arrives STRUCTURED (isError false — a refusal is a typed answer)', async () => {
	// a stub appliance honoring the createAppliance answer contract.
	const appliance = {
		answer: async ( q ) => /in-vocab/.test(q)
			? { status: 'answered', answer: '42', confBand: 'high' }
			: { status: 'refused', reason: 'required fact out of declared vocabulary', missing: ['metric.unit'] }
	};
	const srv = server({ appliance });
	const ok = await call(srv, 1, 'ask', { query: 'in-vocab question' });
	assert.equal(ok.result.structuredContent.status, 'answered');
	const refusal = await call(srv, 2, 'ask', { query: 'out of vocab question' });
	assert.equal(refusal.result.isError, false, 'a refusal is NOT an error — it is a typed answer');
	assert.equal(refusal.result.structuredContent.status, 'refused');
	assert.match(refusal.result.structuredContent.reason, /vocabulary/);
	assert.deepEqual(refusal.result.structuredContent.missing, ['metric.unit'], 'the refusal NAMES the missing requirement, structured');
});

test('mcp — tools/call guards: unknown tool → -32602; a tool failure → isError:true (tool-level, not protocol)', async () => {
	const srv = server({ proxy: createProxyCache({ frontierAsk: async () => { throw new Error('frontier down'); } }) });
	const unknown = await call(srv, 1, 'nope', {});
	assert.equal(unknown.error.code, -32602);
	const failed = await call(srv, 2, 'ask', { query: 'q' });
	assert.equal(failed.result.isError, true);
	assert.match(failed.result.content[0].text, /frontier down/);
	const invalid = await srv.handle({ id: 3, method: 'tools/list' });   // no jsonrpc tag
	assert.equal(invalid.error.code, -32600);
});

test('mcp — lattice_load: learning goes THROUGH the version-gated admission (loadLattice), never a direct write', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mcp-'));
	try {
		// a registry with one enum key; the bundle ships one VALID ring alias (member ∈ enum) and the load
		// must route through the gate — we witness the gate by its verdict shape {adopted|merged, admitted}.
		const bundle = packLattice({ version: '1.0.0', keys: { unit: { enum: ['celsius', 'kelvin'], synonyms: { celsius: ['centigrade'] } } } }, { name: 'test-lattice', version: '1.0.0' });
		const file = path.join(dir, 'lattice.sgc.json');
		fs.writeFileSync(file, JSON.stringify(bundle));

		const px = createProxyCache({ frontierAsk: makeFrontierAsk(stubChat().ask) });   // no host registry → ADOPT through the gate
		const srv = server({ proxy: px });
		const r = await call(srv, 1, 'lattice_load', { file });
		assert.equal(r.result.isError, false);
		const v = r.result.structuredContent;
		assert.equal(v.loadSafe, true);
		assert.equal(v.adopted, true, 'no host registry → the packaged canon is ADOPTED via loadLattice');
		assert.deepEqual(v.admitted, [{ key: 'unit', member: 'celsius', alias: 'centigrade' }], 'the shipped ring came through the gate, witnessed by the verdict');
		// and the registry actually grew on the library (the gate is the ONLY write path).
		assert.equal(px.library.registry().keys.unit.synonyms.celsius[0], 'centigrade');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mcp — explorer tools à nu: lattice_rings (bundle + filter) and methods_describe on .sgc files', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mcp-'));
	try {
		const latFile = path.join(dir, 'lat.sgc.json');
		fs.writeFileSync(latFile, JSON.stringify(packLattice({ version: '1', keys: {
			unit: { enum: ['celsius'], synonyms: { celsius: ['centigrade', 'degc'] } },
			agg : { enum: ['count'], synonyms: { count: ['number of'] } }
		} })));
		const srv = server({});
		const all = await call(srv, 1, 'lattice_rings', { file: latFile });
		assert.equal(all.result.structuredContent.count, 3);
		const filtered = await call(srv, 2, 'lattice_rings', { file: latFile, filter: 'centi' });
		assert.deepEqual(filtered.result.structuredContent.rings, [{ key: 'unit', member: 'celsius', alias: 'centigrade' }]);

		const mFile = path.join(dir, 'methods.sgc.json');
		fs.writeFileSync(mFile, JSON.stringify({ format: 'sgc', kind: 'methods', methods: [
			{ structure: { op: 'select' }, content: { col: 'a' } },
			{ structure: { op: 'select' }, content: { col: 'b' } },
			{ structure: { op: 'count' }, content: {} }
		] }));
		const d = await call(srv, 3, 'methods_describe', { file: mFile });
		assert.equal(d.result.isError, false);
		assert.equal(d.result.structuredContent.methods.length, 3);
		assert.ok(Array.isArray(d.result.structuredContent.population.categories), 'the class distribution is on the readout');
		assert.equal(d.result.structuredContent.population.openness.distinctClasses, 2, '2 distinct classes (op=select, op=count)');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('mcp — trace_tail: the shared log ring buffer, filterable (the sg trace debug contract)', async () => {
	const logger = createLogger({ console: false, level: 'info' });
	logger.log('served', { q: 1 });
	logger.warn('slow frontier');
	logger.info('detail');
	const srv = server({ logger });
	const all = await call(srv, 1, 'trace_tail', { n: 10 });
	assert.equal(all.result.structuredContent.records.length, 3);
	const warns = await call(srv, 2, 'trace_tail', { n: 10, level: 'warn' });
	assert.deepEqual(warns.result.structuredContent.records.map(( r ) => r.msg), ['slow frontier'], 'level filter honored');
});

test('mcp — stdio wire: line-framed JSON-RPC end-to-end (initialize → tools/list → tools/call), parse error answered not crashed', async () => {
	const c = stubChat();
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(c.ask) });
	const input = new PassThrough(), output = new PassThrough();
	const t = startMcpStdio({ server: server({ proxy: px }), input, output });
	const lines = [];
	let buf = '';
	output.on('data', ( d ) => {
		buf += d;
		let nl;
		while ( (nl = buf.indexOf('\n')) !== -1 ) { lines.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1); }
	});
	const send = ( m ) => input.write(JSON.stringify(m) + '\n');
	const until = ( n ) => new Promise(( res, rej ) => {
		const t0 = setInterval(() => { if ( lines.length >= n ) { clearInterval(t0); res(); } }, 5);
		setTimeout(() => { clearInterval(t0); rej(new Error('timeout waiting for ' + n + ' responses, got ' + lines.length)); }, 2000);
	});

	// ONE coalesced chunk (several messages per data event — the real-pipe case that bites a loop-scoped var)
	// + a broken line mid-stream: responses must come back in arrival order with the RIGHT ids.
	input.write([
		JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
		JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),   // no response expected
		JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
		'{broken json',                                                            // parse error → -32700, not a crash
		JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ask', arguments: { query: 'q' } } })
	].join('\n') + '\n');
	send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ask', arguments: { query: 'q' } } });
	await until(5);

	assert.equal(lines[0].id, 1);
	assert.equal(lines[0].result.serverInfo.name, 'skynet-graph');
	assert.equal(lines[1].id, 2);
	assert.ok(lines[1].result.tools.length >= 3);
	assert.equal(lines[2].error.code, -32700, 'the broken line was answered with a parse error');
	assert.equal(lines[3].id, 3, 'the message AFTER the broken line kept its own id (per-line capture)');
	assert.equal(lines[3].result.structuredContent.answer, 'A:q');
	assert.equal(lines[4].id, 4);
	assert.equal(lines[4].result.structuredContent.source, 'local', 'the repeat over the wire is served from the stock');
	t.close();
});
