/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP surface #1 — the OpenAI-COMPATIBLE endpoint (`sg serve`): ANY OpenAI client integrates by
 * pointing its baseURL at the server — zero integration code.
 * THE GUARANTEE SHOWN: a standard `/v1/chat/completions` client (plain fetch here; the openai SDK works
 * identically — `new OpenAI({ baseURL, apiKey: 'sg-local' })`) gets frontier-verified answers; the repeat
 * is served from the local stock at 0 frontier calls, and the PROVENANCE says so on every response
 * (headers `x-sg-served-from`/`x-sg-saved` + `usage.sg_*`).
 *
 * Self-contained: boots the server in-process over a stub frontier. In production:
 *   sg serve --frontier-model <path.gguf> --store ./stock.json     (then point any client at :4747/v1)
 */
const assert = require('node:assert');
const { createProxyCache, makeFrontierAsk } = require('../../lib/index.js').factories;
const { createServeHandler, startServeServer } = require('../../lib/sg/serve.js');

async function main() {
	// ── the server side (2 lines in production — the CLI does exactly this) ─────────────────────────────
	let frontierCalls = 0;
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(async ( { user } ) => { frontierCalls++; return 'verified: ' + user; }), retention: true });
	const srv = await new Promise(( res ) => {
		const s = startServeServer({ handler: createServeHandler({ proxy: px }), port: 0, onReady: () => res(s) });
	});
	const base = 'http://127.0.0.1:' + srv.address().port;
	console.log('serving : ' + base + '/v1   (OpenAI-compatible)');

	try {
		// ── the client side: the STANDARD OpenAI wire, nothing skynet-specific ──────────────────────────
		const complete = ( q ) => fetch(base + '/v1/chat/completions', {
			method : 'POST', headers: { 'content-type': 'application/json' },
			body   : JSON.stringify({ model: 'sg', messages: [{ role: 'user', content: q }] })
		});
		const r1 = await complete('What is the capital of France?');
		const j1 = await r1.json();
		console.log('ask #1  : [' + r1.headers.get('x-sg-served-from') + '] → ' + j1.choices[0].message.content);

		const r2 = await complete('What is the capital of France?');
		const j2 = await r2.json();
		console.log('ask #2  : [' + r2.headers.get('x-sg-served-from') + '] → ' + j2.choices[0].message.content
			+ '   (saved=' + r2.headers.get('x-sg-saved') + ' frontier call)');

		assert.equal(frontierCalls, 1, 'the repeat cost 0 frontier calls');
		assert.equal(r2.headers.get('x-sg-served-from'), 'local');
		assert.equal(j2.choices[0].message.content, j1.choices[0].message.content, '0 hallucination — the stock IS the frontier truth');
		assert.equal(j2.usage.sg_served_from, 'local', 'provenance also rides usage.sg_* through any SDK');

		console.log('BOOTSTRAP OK — standard OpenAI wire, repeat served local (0 frontier calls), provenance on every response');
	} finally { srv.close(); }
}
main().catch(( e ) => { console.error(e); process.exit(1); });
