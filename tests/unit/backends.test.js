'use strict';
// backends.js (R0) — the public preset/config layer over the ask-makers. It answers one question:
// "given a provider name + a key, hand me a chat ask". A thin, data-driven table (openai-compat for all
// but anthropic + the embedded local model), with a resolve step (precedence spec > env > preset), a
// build step (dispatch to makeOpenAIAsk / makeAnthropicAsk / makeLocalAsk), and a secret-free listing for
// a Studio dropdown. The `egress` flag (local=false, remote=true) is the seed the no-egress routing reads.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { resolveBackend, makeBackend, listBackends, BACKENDS } = require('../../lib/providers/backends');

// save/restore a set of env vars around a test that manipulates them
function withEnv( keys, fn ) {
	const saved = {};
	for ( const k of keys ) saved[k] = process.env[k];
	try { return fn(); }
	finally { for ( const k of keys ) { if ( saved[k] === undefined ) delete process.env[k]; else process.env[k] = saved[k]; } }
}

function stubOpenAI() {
	const reqs = [];
	const srv = http.createServer(( req, res ) => {
		let b = ''; req.on('data', ( c ) => { b += c; });
		req.on('end', () => {
			reqs.push({ url: req.url, auth: req.headers.authorization, body: b });
			res.setHeader('connection', 'close'); res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ choices: [{ message: { content: 'OAI:' + JSON.parse(b).messages.slice(-1)[0].content } }] }));
		});
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, reqs, url: 'http://127.0.0.1:' + srv.address().port })));
}

function stubAnthropic() {
	const reqs = [];
	const srv = http.createServer(( req, res ) => {
		let b = ''; req.on('data', ( c ) => { b += c; });
		req.on('end', () => {
			reqs.push({ url: req.url, xkey: req.headers['x-api-key'], body: b });
			res.setHeader('connection', 'close'); res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ content: [{ text: 'ANT:' + JSON.parse(b).messages[0].content }] }));
		});
	});
	return new Promise(( r ) => srv.listen(0, '127.0.0.1', () => r({ srv, reqs, url: 'http://127.0.0.1:' + srv.address().port })));
}

test('resolveBackend — a named cloud preset fills api/base/egress/keyEnv from the table', () => {
	const d = resolveBackend({ preset: 'deepseek', key: 'k' });
	assert.equal(d.name, 'deepseek');
	assert.equal(d.api, 'openai');           // OpenAI-compatible
	assert.equal(d.base, 'https://api.deepseek.com');   // API ROOT — the maker appends /v1/chat/completions
	assert.equal(d.egress, true);
	assert.equal(d.needsKey, true);
	assert.equal(d.keyEnv, 'DEEPSEEK_API_KEY');
	assert.equal(d.key, 'k');
});

test('resolveBackend — precedence is spec > env > preset default', () => {
	withEnv(['LLM_MODEL', 'DEEPSEEK_API_KEY'], () => {
		process.env.LLM_MODEL = 'env-model';
		process.env.DEEPSEEK_API_KEY = 'env-key';
		// spec wins over env + preset
		const spec = resolveBackend({ preset: 'deepseek', base: 'http://override', model: 'spec-model', key: 'spec-key' });
		assert.equal(spec.base, 'http://override');
		assert.equal(spec.model, 'spec-model');
		assert.equal(spec.key, 'spec-key');
		// env wins over preset default when spec is silent
		const env = resolveBackend({ preset: 'deepseek' });
		assert.equal(env.model, 'env-model', 'LLM_MODEL used when spec.model absent');
		assert.equal(env.key, 'env-key', 'the preset keyEnv is read from the environment');
	});
});

test('resolveBackend — "claude" is an alias of anthropic (the one non-OpenAI flavour)', () => {
	const d = resolveBackend({ preset: 'claude', key: 'k' });
	assert.equal(d.name, 'anthropic');
	assert.equal(d.api, 'anthropic');
	assert.equal(d.base, 'https://api.anthropic.com');
});

test('resolveBackend — local: api=local, egress=false, no key, modelPath carried', () => {
	const d = resolveBackend({ preset: 'local', modelPath: '/models/x.gguf' });
	assert.equal(d.api, 'local');
	assert.equal(d.egress, false, 'the embedded model never egresses — the seed of the no-egress default');
	assert.equal(d.needsKey, false);
	assert.equal(d.modelPath, '/models/x.gguf');
});

test('resolveBackend — egress is overridable (a LAN endpoint declared non-egressing)', () => {
	const d = resolveBackend({ preset: 'custom', base: 'http://192.168.1.9:8000', egress: false });
	assert.equal(d.name, 'custom');
	assert.equal(d.egress, false);
});

test('resolveBackend — an unknown preset is a typed error', () => {
	assert.throws(() => resolveBackend({ preset: 'nope' }), ( e ) => e.code === 'UNKNOWN_BACKEND');
});

test('makeBackend — a needs-key preset with no key is a typed NO_API_KEY error (not a silent 401 later)', () => {
	withEnv(['OPENAI_API_KEY', 'LLM_KEY'], () => {
		delete process.env.OPENAI_API_KEY; delete process.env.LLM_KEY;
		assert.throws(() => makeBackend({ preset: 'openai' }), ( e ) => e.code === 'NO_API_KEY');
	});
});

test('makeBackend — OpenAI-compat: builds a working ask against a real endpoint (Bearer + /v1/chat/completions)', async () => {
	const { srv, reqs, url } = await stubOpenAI();
	try {
		const ask = makeBackend({ preset: 'custom', base: url, key: 'secret-k', model: 'm' });
		const out = await ask({ user: 'hi' });
		assert.equal(out, 'OAI:hi');
		assert.ok(reqs[0].url.endsWith('/v1/chat/completions'), 'hit the chat-completions path');
		assert.equal(reqs[0].auth, 'Bearer secret-k', 'the key rode as a Bearer header');
	} finally { srv.close(); }
});

test('makeBackend — anthropic: builds a working ask against a real endpoint (/v1/messages + x-api-key)', async () => {
	const { srv, reqs, url } = await stubAnthropic();
	try {
		const ask = makeBackend({ preset: 'anthropic', base: url, key: 'secret-k', model: 'claude-x' });
		const out = await ask({ user: 'hi' });
		assert.equal(out, 'ANT:hi');
		assert.ok(reqs[0].url.endsWith('/v1/messages'), 'hit the messages path');
		assert.equal(reqs[0].xkey, 'secret-k');
	} finally { srv.close(); }
});

test('makeBackend — local routes to the embedded maker (returns an ask, no model load)', () => {
	const ask = makeBackend({ preset: 'local', modelPath: '/nonexistent/fake.gguf' });
	assert.equal(typeof ask, 'function', 'a local backend is a chat ask, wired to node-llama-cpp lazily');
});

test('listBackends — a secret-free catalogue for a dropdown (never leaks a key)', () => {
	const list = listBackends();
	const names = list.map(( b ) => b.name);
	for ( const n of ['local', 'openai', 'anthropic', 'huggingface', 'deepseek', 'openrouter', 'custom'] ) {
		assert.ok(names.includes(n), 'preset listed: ' + n);
	}
	for ( const b of list ) {
		assert.ok(b.name && b.label && b.api, 'entry has name/label/api');
		assert.ok(!('key' in b), 'NO secret in the listing: ' + b.name);
		assert.equal(typeof b.egress, 'boolean');
	}
	assert.equal(list.find(( b ) => b.name === 'local').egress, false);
	assert.equal(list.find(( b ) => b.name === 'deepseek').egress, true);
	assert.ok(BACKENDS && BACKENDS.deepseek, 'the raw table is exported too');
});
