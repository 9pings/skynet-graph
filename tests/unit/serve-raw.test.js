'use strict';
/**
 * startServeServer RAW-bytes support (R5 of the instance service): a handler may return
 * `{ raw: Buffer }` — written AS-IS with its headers (no JSON.stringify) — and every request
 * descriptor carries `rawBody` (the untouched Buffer) next to the parsed JSON `body`. What lets a
 * binary `.sgp` pack ride the same zero-dep wrapper as the OpenAI JSON routes, byte-identical.
 *
 * Bars: a binary round-trip over a REAL socket is byte-identical both ways (upload rawBody ==
 * served raw) · JSON routes are untouched (body still parsed, JSON results still stringified) ·
 * invalid-JSON body still reaches the handler as undefined WITH the bytes in rawBody.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServeServer } = require('../../lib/sg/serve.js');

// bytes that are NOT valid utf8/JSON — the binary discriminator
const BLOB = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x01, 0x02]);

function boot( handler ) {
	return new Promise(( res ) => {
		const srv = startServeServer({ handler, port: 0, onReady: () => res({ srv, base: 'http://127.0.0.1:' + srv.address().port }) });
	});
}

test('raw out + rawBody in: a binary round-trip over a real socket is byte-identical; JSON routes untouched', async () => {
	let seen = null;
	const { srv, base } = await boot(async ( reqd ) => {
		if ( reqd.url === '/echo-bytes' ) { seen = reqd.rawBody; return { status: 200, headers: { 'content-type': 'application/zip' }, raw: reqd.rawBody }; }
		if ( reqd.url === '/json' ) return { status: 200, headers: { 'content-type': 'application/json' }, body: { got: reqd.body, rawLen: reqd.rawBody.length } };
		return { status: 404, headers: {}, body: {} };
	});
	try {
		const r = await fetch(base + '/echo-bytes', { method: 'POST', body: BLOB });
		assert.equal(r.status, 200);
		assert.equal(r.headers.get('content-type'), 'application/zip');
		const back = Buffer.from(await r.arrayBuffer());
		assert.deepEqual(back, BLOB, 'served raw bytes are byte-identical');
		assert.deepEqual(seen, BLOB, 'the handler received the untouched upload in rawBody');

		const j = await fetch(base + '/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
		assert.deepEqual(await j.json(), { got: { a: 1 }, rawLen: 7 }, 'JSON body still parsed; rawBody rides along');
	} finally { srv.close(); }
});

test('invalid-JSON body: `body` is undefined (the 400 contract) while rawBody still carries the bytes', async () => {
	let got;
	const { srv, base } = await boot(async ( reqd ) => {
		got = { body: reqd.body, raw: reqd.rawBody };
		return { status: 200, headers: { 'content-type': 'application/json' }, body: {} };
	});
	try {
		await fetch(base + '/x', { method: 'POST', body: BLOB });
		assert.equal(got.body, undefined, 'present-but-invalid JSON stays the 400 signal');
		assert.deepEqual(got.raw, BLOB, 'the bytes are not lost');
	} finally { srv.close(); }
});
