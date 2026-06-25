'use strict';
/**
 * OpenAI-compatible `ask` backend (lib/providers/llm.js#makeOpenAIAsk) — the bundled `makeAsk`
 * speaks Anthropic `/v1/messages`, but most local servers (vLLM / llama.cpp / LM Studio / the
 * project's local server) speak OpenAI `/v1/chat/completions`. Reads `choices[0].message.content`,
 * and — for REASONING models that spend the token budget on a separate `reasoning_content` and
 * return empty `content` — falls back to the reasoning text so JSON salvage still has something.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOpenAIAsk, makeAsk } = require('../../lib/providers/llm.js');

// swap global.fetch for one call, capturing the request and returning a canned response
function withFetch( responder, fn ) {
	const orig = global.fetch;
	const calls = [];
	global.fetch = async ( url, opts ) => { calls.push({ url, opts }); return responder(url, opts); };
	return Promise.resolve(fn(calls)).finally(() => { global.fetch = orig; });
}
const okJson = ( json ) => ({ ok: true, status: 200, async json() { return json; }, async text() { return ''; } });

test('posts /v1/chat/completions with system+user messages and returns message.content', async () => {
	await withFetch(() => okJson({ choices: [{ message: { content: 'hello' } }] }), async ( calls ) => {
		const ask = makeOpenAIAsk({ base: 'http://x:5000', model: 'm', key: 'k' });
		const out = await ask({ system: 'sys', user: 'usr', maxTokens: 50 });
		assert.equal(out, 'hello');
		assert.match(calls[0].url, /\/v1\/chat\/completions$/);
		const body = JSON.parse(calls[0].opts.body);
		assert.equal(body.model, 'm');
		assert.equal(body.max_tokens, 50);
		assert.deepEqual(body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
		assert.match(calls[0].opts.headers.authorization, /Bearer k/);
	});
});

test('omits the system message when no system prompt is given', async () => {
	await withFetch(() => okJson({ choices: [{ message: { content: 'x' } }] }), async ( calls ) => {
		await makeOpenAIAsk({ base: 'b', model: 'm' })({ user: 'u' });
		assert.deepEqual(JSON.parse(calls[0].opts.body).messages, [{ role: 'user', content: 'u' }]);
	});
});

test('falls back to reasoning_content when content is empty (reasoning models)', async () => {
	await withFetch(() => okJson({ choices: [{ message: { content: '  ', reasoning_content: '{"atomic":false}' } }] }), async () => {
		assert.equal(await makeOpenAIAsk({ base: 'b', model: 'm' })({ user: 'u' }), '{"atomic":false}');
	});
});

test('throws on an HTTP error', async () => {
	await withFetch(() => ({ ok: false, status: 500, async text() { return 'boom'; }, async json() { return {}; } }), async () => {
		await assert.rejects(makeOpenAIAsk({ base: 'b', model: 'm' })({ user: 'u' }), /500|boom/);
	});
});

test('throws on a server error body (HTTP 200 with an error object)', async () => {
	await withFetch(() => okJson({ error: { message: 'model load failed' } }), async () => {
		await assert.rejects(makeOpenAIAsk({ base: 'b', model: 'm' })({ user: 'u' }), /model load failed/);
	});
});

test('makeAsk({api:"openai"}) routes to the OpenAI client (env LLM_API also works)', async () => {
	await withFetch(() => okJson({ choices: [{ message: { content: 'routed' } }] }), async ( calls ) => {
		const out = await makeAsk({ api: 'openai', base: 'b', model: 'm' })({ user: 'u' });
		assert.equal(out, 'routed');
		assert.match(calls[0].url, /\/v1\/chat\/completions$/);
	});
});
