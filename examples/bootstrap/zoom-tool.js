/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP surface #3 — the `zoom` MCP TOOL: the plan loop (README F2) reached the way an agent host
 * reaches it. THE DIVISION OF LABOR IS THE DESIGN: the HOST AI declares the plan (`leaves` + `needs` —
 * the small local model as decomposer is a published negative, R1a), the engine guarantees the serving.
 *
 * THE GUARANTEE SHOWN, three parts, all through the REAL JSON-RPC server (not a look-alike):
 *   1. BOUNDED SERVING — each leaf's model prompt carries ONLY its own self-contained ask + the upstream
 *      VALUES it declared. Never the task text, never a sibling's question. Proven on the actual strings.
 *   2. A HOLE IN THE PLAN IS REFUSED, NEVER GUESSED — a `needs` nobody produces refuses the WHOLE plan,
 *      typed + named, before ANY model call.
 *   3. THE COST LADDER — with a stock proxy wired, covered leaves are served LOCAL (0 frontier calls)
 *      and the payload carries the amortization readout (`economy` + per-leaf `source`).
 *
 * Deterministic, no GPU:  node examples/bootstrap/zoom-tool.js
 */
const assert = require('node:assert');
const { createMcpServer, defaultTools } = require('../../lib/sg/mcp.js');
const { title, say, gap, step: beat, good, bad, val, done: finish } = require('../_say.js');

// the host-declared plan: two base figures, one derivation that needs both.
const PLAN = [
	{ id: 'revenue', ask: 'the revenue figure' },
	{ id: 'costs', ask: 'the costs figure' },
	{ id: 'margin', ask: 'revenue minus costs', needs: ['revenue', 'costs'] },
];

// the scripted model answers ONLY from what its prompt shows — a derivation must find its operands
// IN ITS OWN PROMPT, which proves the values flowed through the bounded projection.
function scripted() {
	const seen = [];
	const ask = async ( q ) => {
		seen.push(String(q.user));
		const p = String(q.user);
		const n = ( key ) => Number((p.match(new RegExp(key + ' = (-?\\d+)')) || [])[1]);
		if ( /revenue minus costs/.test(p) ) return 'ANSWER: ' + (n('revenue') - n('costs'));
		if ( /revenue figure/.test(p) ) return 'ANSWER: 913';
		return 'ANSWER: 400';
	};
	return { ask, seen };
}
const rpc = ( srv, id, args ) => srv.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'zoom', arguments: args } });

async function main() {
	title('A BIG TASK, PIECE BY PIECE — THROUGH THE MCP TOOL');
	say('Your agent declares the plan; the engine serves it. `zoom` is the same plan loop as');
	say('c7-plan-loop.js, reached the way a real host reaches it: a JSON-RPC tool call.');
	gap();

	// ── 1. bounded serving through the real server ──────────────────────────────────────────────────
	const s = scripted();
	const srv = createMcpServer({ tools: defaultTools({ critiqueAsk: s.ask }) });
	const r1 = (await rpc(srv, 1, { task: 'Analyze the annual report', leaves: PLAN })).result.structuredContent;
	beat(1, 'Three declared leaves. THIS is the entire prompt each one\'s model call received:');
	gap();
	for ( const u of s.seen ) { say('   ┌' + '─'.repeat(70)); for ( const line of u.split('\n') ) say('   │ ' + line); say('   └' + '─'.repeat(70)); }
	assert.equal(r1.converged, true);
	assert.match(r1.answer, /margin=513/, 'the derivation used values read off its OWN prompt');
	assert.ok(s.seen.every(( u ) => !/annual report/.test(u) ), 'NO prompt ever carried the task text');
	assert.ok(!/costs figure/.test(s.seen.find(( u ) => /revenue figure/.test(u) )), 'nor a sibling\'s question');
	good('no leaf ever saw the task or its siblings — and the derived figure is right (margin=513)');
	val('model calls', r1.asks);
	gap();

	// ── 2. the typed plan refusal — zero model calls ────────────────────────────────────────────────
	const s2 = scripted();
	const srv2 = createMcpServer({ tools: defaultTools({ critiqueAsk: s2.ask }) });
	const r2 = (await rpc(srv2, 2, { task: 't', leaves: [
		{ id: 'revenue', ask: 'the revenue figure' },
		{ id: 'marginPct', ask: 'margin percent', needs: ['margin', 'revenue'] },   // nobody produces `margin`
	] })).result.structuredContent;
	beat(2, 'Now the plan cites a figure NOBODY produces. What happens?');
	assert.equal(r2.status, 'refused-plan');
	assert.equal(s2.seen.length, 0, 'zero model calls');
	bad('the WHOLE plan is refused: ' + JSON.stringify(r2.missing));
	good('typed + named + before any model call — a plan bug is caught offline, never guessed around');
	gap();

	// ── 3. the cost ladder + the economy readout ────────────────────────────────────────────────────
	const proxy = { answer: async ( q ) => /figure/.test(String(q))
		? { answer: /revenue/.test(String(q)) ? '913' : '400', source: 'local', cached: true, cost: 0 }
		: { answer: String((( m ) => m('revenue') - m('costs'))(( k ) => Number((String(q).match(new RegExp(k + ' = (-?\\d+)')) || [])[1]))), source: 'frontier', cached: false, cost: 1 } };
	const srv3 = createMcpServer({ tools: defaultTools({ proxy }) });
	const r3 = (await rpc(srv3, 3, { task: 'Analyze the annual report', leaves: PLAN })).result.structuredContent;
	beat(3, 'Same plan, with a verified local stock wired (the C6 ladder):');
	assert.deepEqual(r3.economy, { local: 2, frontier: 1, cost: 1 });
	assert.match(r3.answer, /margin=513/);
	for ( const lf of r3.leaves ) say('       ' + lf.id + ' ← served ' + lf.source);
	good('covered leaves cost 0 frontier calls; the readout is in the payload, not in prose');
	val('economy', JSON.stringify(r3.economy));

	finish('your agent plans, the engine serves bounded, refuses holes typed, and shows the bill.', 'BOOTSTRAP OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
