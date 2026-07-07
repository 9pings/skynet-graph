'use strict';
// `sg serve` — the minimal OpenAI-compatible proxy DEMO: baseURL integration, exact-match SESSION cache
// (a repeat serves at 0 backend calls), provenance on every response, simulated stream. Deterministic
// (stub chat backend, no GPU). Layers under test: the PURE handler (wire shapes, guards), the zero-dep
// http wrapper (real socket + fetch).
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const { createServeDemoHandler, startServeDemoServer, queryOfMessages } = require('../../lib/sg/serve-demo.js');

// a stub CHAT backend ({system,user}) -> text, call-counted — stands in for a gguf / an endpoint.
function stubAsk() {
	const calls = { n: 0 };
	const ask = async ( { user } ) => { calls.n++; return 'A:' + user; };
	return { ask, calls };
}

test('queryOfMessages — the LAST user turn is the query; text parts join; no user turn → null', () => {
	assert.equal(queryOfMessages([{ role: 'system', content: 's' }, { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q2' }]), 'q2');
	assert.equal(queryOfMessages([{ role: 'user', content: [{ type: 'text', text: 'p1' }, { type: 'text', text: 'p2' }] }]), 'p1\np2');
	assert.equal(queryOfMessages([{ role: 'system', content: 'no user' }]), null);
	assert.equal(queryOfMessages([{ role: 'user', content: '  ' }]), null, 'an empty user turn is not a query');
	assert.equal(queryOfMessages('nope'), null);
});

test('handler — OpenAI shape + provenance: cold query → backend; the REPEAT serves from the session cache at 0 calls', async () => {
	const { ask, calls } = stubAsk();
	const handle = createServeDemoHandler({ ask });
	const req = ( q ) => ({ method: 'POST', url: '/v1/chat/completions', body: { model: 'client-model', messages: [{ role: 'user', content: q }] } });

	const r1 = await handle(req('capital of France?'));
	assert.equal(r1.status, 200);
	assert.equal(r1.body.object, 'chat.completion');
	assert.equal(r1.body.model, 'client-model', 'the client-requested model id is echoed');
	assert.equal(r1.body.choices[0].message.content, 'A:capital of France?');
	assert.equal(r1.body.choices[0].finish_reason, 'stop');
	assert.equal(r1.headers['x-sg-served-from'], 'backend', 'a cold query goes to the backend — and SAYS it');
	assert.equal(calls.n, 1);

	const r2 = await handle(req('capital of France?'));
	assert.equal(calls.n, 1, 'NO new backend call on the repeat');
	assert.equal(r2.headers['x-sg-served-from'], 'cache');
	assert.equal(r2.headers['x-sg-saved'], '1', 'backend calls avoided so far, on the wire');
	assert.equal(r2.body.choices[0].message.content, 'A:capital of France?', 'the cached answer IS the backend answer, verbatim');
	assert.equal(r2.body.usage.sg_served_from, 'cache');
	assert.equal(r2.body.usage.total_tokens, 0, 'token counts are NOT estimated (0 = not counted)');
});

test('handler — GET /v1/models lists the demo model (SDK bootstraps/model pickers work)', async () => {
	const handle = createServeDemoHandler({ ask: stubAsk().ask, model: 'my-demo' });
	const r = await handle({ method: 'GET', url: '/v1/models' });
	assert.equal(r.status, 200);
	assert.deepEqual(r.body.data.map(( m ) => m.id), ['my-demo']);
});

test('handler — guards: invalid body / no user turn / unknown route / wrong method / backend failure → OpenAI errors, never fabricated', async () => {
	const { ask, calls } = stubAsk();
	const handle = createServeDemoHandler({ ask });
	assert.equal((await handle({ method: 'POST', url: '/v1/chat/completions', body: undefined })).status, 400);
	assert.equal((await handle({ method: 'POST', url: '/v1/chat/completions', body: { messages: [{ role: 'system', content: 's' }] } })).status, 400);
	assert.equal((await handle({ method: 'GET', url: '/v2/nope' })).status, 404);
	assert.equal((await handle({ method: 'GET', url: '/v1/chat/completions' })).status, 405);
	assert.equal(calls.n, 0, 'no guard path ever reached the backend');
	const broken = createServeDemoHandler({ ask: async () => { throw new Error('backend down'); } });
	const r = await broken({ method: 'POST', url: '/v1/chat/completions', body: { messages: [{ role: 'user', content: 'q' }] } });
	assert.equal(r.status, 500);
	assert.equal(r.body.error.type, 'server_error');
});

test('handler — stream:true is SIMULATED: role delta → content delta → stop → [DONE], provenance in headers', async () => {
	const handle = createServeDemoHandler({ ask: stubAsk().ask });
	const r = await handle({ method: 'POST', url: '/v1/chat/completions', body: { stream: true, messages: [{ role: 'user', content: 'q' }] } });
	assert.equal(r.status, 200);
	assert.equal(r.headers['content-type'], 'text/event-stream');
	assert.equal(r.headers['x-sg-served-from'], 'backend');
	const frames = r.sse.map(( f ) => f.replace(/^data: /, ''));
	assert.equal(frames.length, 4);
	assert.equal(JSON.parse(frames[0]).choices[0].delta.role, 'assistant');
	assert.equal(JSON.parse(frames[1]).choices[0].delta.content, 'A:q');
	assert.equal(JSON.parse(frames[2]).choices[0].finish_reason, 'stop');
	assert.equal(frames[3], '[DONE]');
});

test('wire — real socket: fetch ×2 against the http wrapper, repeat served from cache with provenance headers', async () => {
	const { ask, calls } = stubAsk();
	const srv = startServeDemoServer({ handler: createServeDemoHandler({ ask }), port: 0 });
	await new Promise(( r ) => srv.once('listening', r));
	try {
		const base = 'http://127.0.0.1:' + srv.address().port;
		const complete = () => fetch(base + '/v1/chat/completions', {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: [{ role: 'user', content: 'boiling point?' }] })
		});
		const r1 = await complete();
		assert.equal(r1.headers.get('x-sg-served-from'), 'backend');
		assert.equal((await r1.json()).choices[0].message.content, 'A:boiling point?');
		const r2 = await complete();
		assert.equal(r2.headers.get('x-sg-served-from'), 'cache', 'the repeat is served from the session cache OVER THE WIRE');
		assert.equal(calls.n, 1, '0 backend calls on the repeat');
	} finally { srv.close(); }
});
