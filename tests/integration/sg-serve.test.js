'use strict';
// `sg serve` — the OpenAI-compatible endpoint over the C6 proxy (roadmap FINIR F1). Deterministic (stub chat
// backend, no GPU). Layers under test: the PURE handler (wire shapes, provenance headers, guards, simulated
// stream), the zero-dep http wrapper (real socket + fetch), and THE F1 GATE — the official `openai` npm SDK,
// unmodified, completing against the server (non-stream AND stream) with repeats served from the stock at
// 0 frontier calls.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProxyCache, makeFrontierAsk } = require('../../lib/combos/proxy-cache.js');
const { createServeHandler, startServeServer, queryOfMessages } = require('../../lib/sg/serve.js');

// a stub CHAT backend ({system,user}) -> text, call-counted — stands in for an embedded gguf / an endpoint.
function stubChat() {
	const calls = { n: 0 };
	const ask = async ( { user } ) => { calls.n++; return 'A:' + user; };
	return { ask, calls };
}
function freshProxy( extra ) {
	const c = stubChat();
	const px = createProxyCache(Object.assign({ frontierAsk: makeFrontierAsk(c.ask), retention: true }, extra));
	return { px, calls: c.calls };
}

test('queryOfMessages — the LAST user turn is the query; text parts join; no user turn → null', () => {
	assert.equal(queryOfMessages([{ role: 'system', content: 's' }, { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q2' }]), 'q2');
	assert.equal(queryOfMessages([{ role: 'user', content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }] }]), 'part1\npart2');
	assert.equal(queryOfMessages([{ role: 'system', content: 'no user' }]), null);
	assert.equal(queryOfMessages([{ role: 'user', content: '   ' }]), null, 'an empty user turn is not a query');
	assert.equal(queryOfMessages('nope'), null);
});

test('handler — POST /v1/chat/completions: OpenAI shape + PROVENANCE (frontier first, LOCAL repeat at 0 frontier calls)', async () => {
	const { px, calls } = freshProxy();
	const handle = createServeHandler({ proxy: px });
	const req = ( q ) => ({ method: 'POST', url: '/v1/chat/completions', body: { model: 'client-model', messages: [{ role: 'user', content: q }] } });

	const r1 = await handle(req('capital of France?'));
	assert.equal(r1.status, 200);
	assert.equal(r1.body.object, 'chat.completion');
	assert.equal(r1.body.model, 'client-model', 'the client-requested model id is echoed');
	assert.equal(r1.body.choices[0].message.role, 'assistant');
	assert.equal(r1.body.choices[0].message.content, 'A:capital of France?', 'the frontier ground truth is the completion');
	assert.equal(r1.body.choices[0].finish_reason, 'stop');
	assert.equal(r1.headers['x-sg-served-from'], 'frontier', 'a cold query escalates — and SAYS it');
	assert.equal(calls.n, 1);

	// the REPEAT is served from the verified stock: 0 new frontier calls, and the wire says it (header + usage).
	const r2 = await handle(req('capital of France?'));
	assert.equal(calls.n, 1, 'NO new frontier call on the repeat');
	assert.equal(r2.headers['x-sg-served-from'], 'local');
	assert.equal(r2.headers['x-sg-saved'], '1', 'economy counter on the wire');
	assert.equal(r2.body.choices[0].message.content, 'A:capital of France?', 'the cached answer IS the frontier ground truth (0 hallucination)');
	assert.equal(r2.body.usage.sg_served_from, 'local');
	assert.equal(r2.body.usage.sg_saved, 1);
	assert.equal(r2.body.usage.sg_coverage, 0.5);
	assert.equal(r2.body.usage.total_tokens, 0, 'token counts are NOT estimated (0 = not counted, never a made-up number)');
});

test('handler — x-sg-sgc-version: the loaded catalog state rides every completion, LIVE (a refresh shows up); absent without the opt', async () => {
	const { px } = freshProxy();
	let sgc = 'laws@2.1.0,units@1.0.0';
	const handle = createServeHandler({ proxy: px, sgcVersion: () => sgc });
	const req = ( q ) => ({ method: 'POST', url: '/v1/chat/completions', body: { messages: [{ role: 'user', content: q }] } });

	const r1 = await handle(req('q1'));
	assert.equal(r1.headers['x-sg-sgc-version'], 'laws@2.1.0,units@1.0.0', 'the stock freshness is on the wire');
	assert.equal(r1.body.usage.sg_sgc_version, 'laws@2.1.0,units@1.0.0', 'mirrored in usage like the other sg_* fields');

	sgc = 'laws@2.1.0,units@1.1.0';   // a catalog refresh landed — the host updated its state
	const r2 = await handle(req('q2'));
	assert.equal(r2.headers['x-sg-sgc-version'], 'laws@2.1.0,units@1.1.0', 'freshness is LIVE, not frozen at boot');

	// without the opt: no header, no usage field — the lib carries no catalog notion of its own.
	const bare = createServeHandler({ proxy: freshProxy().px });
	const r3 = await bare(req('q3'));
	assert.equal(r3.headers['x-sg-sgc-version'], undefined);
	assert.equal(r3.body.usage.sg_sgc_version, undefined);
});

test('handler — GET /v1/models lists the proxy model (SDK bootstraps/model pickers work)', async () => {
	const { px } = freshProxy();
	const handle = createServeHandler({ proxy: px, model: 'my-proxy' });
	const r = await handle({ method: 'GET', url: '/v1/models' });
	assert.equal(r.status, 200);
	assert.equal(r.body.object, 'list');
	assert.deepEqual(r.body.data.map(( m ) => m.id), ['my-proxy']);
	assert.equal(r.body.data[0].owned_by, 'skynet-graph');
});

test('handler — guards: invalid body / no user turn / unknown route / wrong method → OpenAI error objects', async () => {
	const { px, calls } = freshProxy();
	const handle = createServeHandler({ proxy: px });
	const bad = await handle({ method: 'POST', url: '/v1/chat/completions', body: undefined });
	assert.equal(bad.status, 400);
	assert.match(bad.body.error.message, /JSON object/);
	assert.equal(bad.body.error.type, 'invalid_request_error');
	const noUser = await handle({ method: 'POST', url: '/v1/chat/completions', body: { messages: [{ role: 'system', content: 's' }] } });
	assert.equal(noUser.status, 400);
	assert.match(noUser.body.error.message, /user turn/);
	const lost = await handle({ method: 'GET', url: '/v2/nope' });
	assert.equal(lost.status, 404);
	const wrongMethod = await handle({ method: 'GET', url: '/v1/chat/completions' });
	assert.equal(wrongMethod.status, 405);
	assert.equal(calls.n, 0, 'no guard path ever reached the frontier');
});

test('handler — stream:true is SIMULATED: role delta → content delta → stop → [DONE], provenance in headers', async () => {
	const { px } = freshProxy();
	const handle = createServeHandler({ proxy: px });
	const r = await handle({ method: 'POST', url: '/v1/chat/completions', body: { stream: true, messages: [{ role: 'user', content: 'q' }] } });
	assert.equal(r.status, 200);
	assert.equal(r.headers['content-type'], 'text/event-stream');
	assert.equal(r.headers['x-sg-served-from'], 'frontier', 'provenance rides the SSE response headers');
	assert.equal(r.sse.length, 4);
	const frames = r.sse.map(( f ) => f.replace(/^data: /, ''));
	assert.equal(JSON.parse(frames[0]).choices[0].delta.role, 'assistant');
	assert.equal(JSON.parse(frames[1]).choices[0].delta.content, 'A:q', 'the whole answer in one content chunk (simulated stream)');
	assert.equal(JSON.parse(frames[2]).choices[0].finish_reason, 'stop');
	assert.equal(frames[3], '[DONE]');
	assert.equal(JSON.parse(frames[0]).object, 'chat.completion.chunk');
});

test('handler — a frontier failure surfaces as a 500 server_error (never a fabricated answer)', async () => {
	const px = createProxyCache({ frontierAsk: async () => { throw new Error('frontier down'); } });
	const handle = createServeHandler({ proxy: px });
	const r = await handle({ method: 'POST', url: '/v1/chat/completions', body: { messages: [{ role: 'user', content: 'q' }] } });
	assert.equal(r.status, 500);
	assert.match(r.body.error.message, /frontier down/);
	assert.equal(r.body.error.type, 'server_error');
});

test('handler — rejects a missing proxy (fail-closed wiring)', () => {
	assert.throws(() => createServeHandler({}), /needs opts\.proxy/);
});

// ── the wire: real socket + fetch ────────────────────────────────────────────────────────────────────────────

function listen( handler ) {
	return new Promise(( res ) => {
		const srv = startServeServer({ handler, port: 0, onReady: () => res({ srv, base: 'http://127.0.0.1:' + srv.address().port }) });
	});
}

test('http wrapper — end-to-end over a real socket: completion, provenance headers, invalid JSON → 400', async () => {
	const { px, calls } = freshProxy();
	const { srv, base } = await listen(createServeHandler({ proxy: px }));
	try {
		const post = ( body ) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
		const r1 = await post(JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }));
		assert.equal(r1.status, 200);
		assert.equal(r1.headers.get('x-sg-served-from'), 'frontier');
		assert.equal((await r1.json()).choices[0].message.content, 'A:ping');
		const r2 = await post(JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }));
		assert.equal(r2.headers.get('x-sg-served-from'), 'local', 'the repeat is served from the stock OVER THE WIRE');
		assert.equal(calls.n, 1);
		const badReq = await post('{not json');
		assert.equal(badReq.status, 400, 'invalid JSON body → 400 error object, not a crash');
		assert.equal((await badReq.json()).error.type, 'invalid_request_error');
		const models = await (await fetch(base + '/v1/models')).json();
		assert.equal(models.data[0].id, 'skynet-graph-proxy');
	} finally { srv.close(); }
});

// ── THE F1 GATE — the official `openai` SDK, unmodified, against the server ─────────────────────────────────

test('F1 GATE — the official openai SDK completes against `sg serve`: non-stream, stream, and stock economy', async ( t ) => {
	let OpenAI;
	try { OpenAI = require('openai'); } catch ( e ) { t.skip('devDependency `openai` not installed'); return; }

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-serve-'));
	const file = path.join(dir, 'stock.json');
	const c = stubChat();
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(c.ask), store: file, retention: true });
	const { srv, base } = await listen(createServeHandler({ proxy: px }));
	try {
		const client = new OpenAI({ baseURL: base + '/v1', apiKey: 'sg-local' });   // ← the WHOLE integration

		// non-stream: the SDK parses our wire format as a standard completion.
		const r1 = await client.chat.completions.create({ model: 'sg', messages: [{ role: 'user', content: 'capital of France?' }] });
		assert.equal(r1.choices[0].message.content, 'A:capital of France?');
		assert.equal(r1.usage.sg_served_from, 'frontier', 'sg_* usage extensions ride through the SDK untouched');

		// repeat: served from the stock — 0 new frontier calls, visible through the SDK.
		const r2 = await client.chat.completions.create({ model: 'sg', messages: [{ role: 'user', content: 'capital of France?' }] });
		assert.equal(c.calls.n, 1, 'the repeat cost 0 frontier calls');
		assert.equal(r2.usage.sg_served_from, 'local');
		assert.equal(r2.choices[0].message.content, 'A:capital of France?');

		// stream:true — the SDK's SSE iterator consumes the simulated stream.
		const stream = await client.chat.completions.create({ model: 'sg', messages: [{ role: 'user', content: 'capital of France?' }], stream: true });
		let text = '', sawStop = false;
		for await ( const chunk of stream ) {
			text += chunk.choices[0].delta.content || '';
			if ( chunk.choices[0].finish_reason === 'stop' ) sawStop = true;
		}
		assert.equal(text, 'A:capital of France?', 'the streamed text reassembles to the stock answer');
		assert.ok(sawStop, 'the finish_reason chunk closed the stream');
		assert.equal(c.calls.n, 1, 'the streamed repeat ALSO cost 0 frontier calls');

		// models list through the SDK.
		const models = await client.models.list();
		assert.equal(models.data[0].id, 'skynet-graph-proxy');

		// durable stock: a FRESH proxy + server over the same --store replays at 0 frontier calls, via the SDK.
		srv.close();
		const c2 = stubChat();
		const px2 = createProxyCache({ frontierAsk: makeFrontierAsk(c2.ask), store: file, retention: true });
		const { srv: srv2, base: base2 } = await listen(createServeHandler({ proxy: px2 }));
		try {
			const client2 = new OpenAI({ baseURL: base2 + '/v1', apiKey: 'sg-local' });
			const r3 = await client2.chat.completions.create({ model: 'sg', messages: [{ role: 'user', content: 'capital of France?' }] });
			assert.equal(c2.calls.n, 0, 'cross-restart: the persisted stock served the query — NO frontier call at all');
			assert.equal(r3.usage.sg_served_from, 'local');
		} finally { srv2.close(); }
	} finally { try { srv.close(); } catch ( e ) {} fs.rmSync(dir, { recursive: true, force: true }); }
});
