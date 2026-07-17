/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C6 — the local-first PROXY CACHE / DISTILLER (the main use case, `createProxyCache`).
 * THE GUARANTEE SHOWN: a covered query is served from the verified local stock at 0 frontier calls; a miss
 * escalates (the user always gets an answer); the local side NEVER fabricates → 0 hallucination; `drift`
 * invalidates → the next ask re-escalates.
 *
 * Deterministic by default (a stub frontier). LIVE: `FRONTIER_MODEL=<path.gguf> node c6-proxy.js --live`
 * runs the same flow on an embedded gguf (the CLI equivalent is `sg proxy` / `sg serve`).
 */
const assert = require('node:assert');
const { createProxyCache, makeFrontierAsk } = require('../../lib/index.js').factories;

async function main() {
	// 1. the FRONTIER = the ground truth (stub here; --live wires the embedded model in one line).
	let frontierCalls = 0;
	let chat = async ( { user } ) => { frontierCalls++; return 'frontier says: ' + user; };
	if ( process.argv.includes('--live') ) {
		const { makeLocalAsk } = require('../../lib/providers/llm-local.js');
		const real = makeLocalAsk({ modelPath: process.env.FRONTIER_MODEL, reasoningBudget: 0 });
		chat = async ( m ) => { frontierCalls++; return real(m); };
	}

	// 2. the proxy — TWO lines of integration.
	const px = createProxyCache({ frontierAsk: makeFrontierAsk(chat), retention: true });

	// 3. a recurring session: 2 distinct queries, then a repeat.
	const q1 = 'What is the capital of France?';
	const r1 = await px.answer(q1);                     // miss → escalates (no false neg)
	const r2 = await px.answer('Who wrote Hamlet?');    // miss → escalates
	const r3 = await px.answer(q1);                     // covered → served LOCAL, 0 frontier calls

	console.log('[' + r1.source + ']', q1, '→', r1.answer);
	console.log('[' + r2.source + ']', 'Who wrote Hamlet?', '→', r2.answer);
	console.log('[' + r3.source + ']', q1, '→', r3.answer, '   (repeat)');
	assert.equal(frontierCalls, 2, 'the repeat cost 0 frontier calls');
	assert.equal(r3.source, 'local');
	assert.equal(r3.answer, r1.answer, 'the served answer IS the frontier ground truth — 0 hallucination');

	// 4. anti-drift: invalidate → the next ask re-escalates (never serves stale).
	await px.drift(q1);
	await px.answer(q1);
	assert.equal(frontierCalls, 3, 'the drifted entry re-escalated');

	const m = px.metrics();
	console.log('economy: served=' + m.served + ' local=' + m.local + ' frontier=' + m.frontier
		+ ' coverage=' + Math.round(m.coverage * 100) + '%');
	console.log('BOOTSTRAP OK — covered→local (0 frontier calls), miss→escalate, 0 hallucination, drift→re-escalate');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
