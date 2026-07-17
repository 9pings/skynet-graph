/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * The `zoom` MCP tool — the C7 plan loop exposed on the agentic surface (the strategy surface:
 * params/tools, never model-name suffixes). THE DIVISION OF LABOR IS THE DESIGN: the HOST AI
 * declares the plan (`leaves` is REQUIRED — the small local model as decomposer is a published
 * negative, R1a), the engine serves each leaf in a BOUNDED context (no leaf sees the whole task),
 * a leaf whose needs nobody produces is REFUSED BEFORE any model call, and the plan is driven to
 * a fixpoint. Scripted-ask throughout — 0 GPU, deterministic.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { defaultTools } = require('../../lib/sg/mcp.js');

const zoomTool = ( wiring ) => defaultTools(wiring).find(( t ) => t.name === 'zoom' );

// the annual-report plan (the C7 bootstrap shape): two base figures, two derivations.
const PLAN = [
	{ id: 'revenue', ask: 'the revenue figure' },
	{ id: 'costs', ask: 'the costs figure' },
	{ id: 'margin', ask: 'revenue minus costs', needs: ['revenue', 'costs'] },
	{ id: 'marginPct', ask: 'margin as a % of revenue, rounded', needs: ['margin', 'revenue'] },
];

// the scripted model: answers ONLY from what the prompt shows — a derivation leaf must find its
// operands IN ITS OWN PROMPT (proof the value flowed through the bounded projection, not through
// the script's knowledge of the plan).
function scriptedServe() {
	const calls = [];
	const ask = async ( q ) => {
		calls.push(q);
		const p = String(q.user);
		const num = ( key ) => { const m = p.match(new RegExp(key + ' = (-?\\d+)')); return m ? Number(m[1]) : null; };   // the USE line form
		if ( /revenue minus costs/.test(p) ) return 'reasoning...\nANSWER: ' + (num('revenue') - num('costs'));
		if ( /margin as a %/.test(p) ) return 'ANSWER: ' + Math.round(num('margin') / num('revenue') * 100);
		if ( /the revenue figure/.test(p) ) return 'ANSWER: 913';
		if ( /the costs figure/.test(p) ) return 'ANSWER: 400';
		return 'ANSWER: 0';
	};
	return { ask, calls };
}

test('MCP zoom tool — present iff critiqueAsk is wired; the plan is the HOST\'s job (leaves required)', () => {
	assert.ok(!defaultTools({}).some(( t ) => t.name === 'zoom' ), 'absent without a wired backend');
	const tool = zoomTool({ critiqueAsk: async () => 'ANSWER: x' });
	assert.ok(tool, 'present with the same backend as critique/self_consistency');
	assert.ok(tool.inputSchema.required.includes('task'));
	assert.ok(tool.inputSchema.required.includes('leaves'), 'the host AI declares the plan — R1a (small model as decomposer) is a published negative');
	assert.match(tool.description, /bounded/i, 'the description sells the guarantee, not magic');
});

test('MCP zoom — bounded serving: each leaf sees ONLY its declared inputs, derived values flow through the projection', async () => {
	const s = scriptedServe();
	const r = await zoomTool({ critiqueAsk: s.ask }).call({ task: 'Analyze the annual report', leaves: PLAN });
	assert.equal(s.calls.length, 4, 'one model call per leaf — the budget is the leaf count');
	assert.equal(r.converged, true);
	assert.deepEqual(r.refused, [], 'nothing refused on a complete plan');
	assert.match(r.answer, /margin=513/, 'derived from operands READ OFF THE PROMPT (the projection injected them)');
	assert.match(r.answer, /marginPct=56/, 'second-order derivation too — the projection ordered the leaves');
	// THE BOUNDED-CONTEXT PROOF, on the actual strings the model received:
	const promptOf = ( frag ) => String(s.calls.find(( q ) => new RegExp(frag).test(String(q.user)) ).user);
	assert.ok(!/annual report/.test(promptOf('the revenue figure')), 'a root leaf never sees the task text');
	assert.ok(!/marginPct|minus costs/.test(promptOf('the revenue figure')), 'nor its siblings\' questions');
	assert.match(promptOf('revenue minus costs'), /913[\s\S]*400|400[\s\S]*913/, 'a derivation leaf sees its two upstream VALUES — and nothing else was needed');
	assert.equal(r.asks, 4, 'the payload reports the model-call budget');
	const served = Object.fromEntries((r.leaves || []).map(( l ) => [l.id, l.value] ));
	assert.equal(served.margin, '513', 'the per-leaf detail is in the payload');
});

test('MCP zoom — a leaf needing what nobody produces is REFUSED BEFORE any model call (typed, named)', async () => {
	const s = scriptedServe();
	const r = await zoomTool({ critiqueAsk: s.ask }).call({
		task: 'Analyze the annual report',
		leaves: [{ id: 'revenue', ask: 'the revenue figure' }, { id: 'marginPct', ask: 'margin %', needs: ['margin', 'revenue'] }],
	});
	assert.equal(r.status, 'refused-plan', 'a typed refusal, not an error string');
	assert.match(JSON.stringify(r.missing), /margin/, 'the hole is NAMED');
	assert.equal(s.calls.length, 0, 'the model was never asked — the découpage bug is caught offline');
	assert.match(r.advice, /needs|produce/i, 'the advice says how to fix the plan');
});

test('MCP zoom — givens: a base fact of the task is injected into the leaves that declared it', async () => {
	const s = scriptedServe();
	const r = await zoomTool({ critiqueAsk: s.ask }).call({
		task: 'apply the rate',
		leaves: [{ id: 'taxed', ask: 'the rate applied', needs: ['rate'] }],
		givens: { rate: 20 },
	});
	assert.equal(r.status, undefined, 'a given satisfies the need — no plan refusal');
	assert.match(String(s.calls[0].user), /20/, 'the given VALUE reached the leaf prompt');
});

test('MCP zoom — P5 wiring: with the C6 proxy wired, leaves ride the COST LADDER (stock-first, escalation load-bearing) and the economy is in the payload', async () => {
	// the scripted ladder: base figures are COVERED by the stock (served local, 0 frontier calls),
	// the derivation is a miss and ESCALATES — exactly the amortization regime P5 sells.
	const proxyCalls = [];
	const proxy = { answer: async ( q ) => {
		proxyCalls.push(String(q));
		const p = String(q);
		const num = ( key ) => { const m = p.match(new RegExp(key + ' = (-?\\d+)')); return m ? Number(m[1]) : null; };
		if ( /the revenue figure/.test(p) ) return { answer: '913', source: 'local', cached: true, arm: 'match', cost: 0 };
		if ( /the costs figure/.test(p) ) return { answer: '400', source: 'local', cached: true, arm: 'match', cost: 0 };
		return { answer: String(num('revenue') - num('costs')), source: 'frontier', cached: false, arm: 'escalate', cost: 1 };
	} };
	const tool = zoomTool({ proxy });                              // NO critiqueAsk — the ladder alone serves
	assert.ok(tool, 'zoom is available on the proxy wiring alone (sg mcp --store)');
	const r = await tool.call({ task: 'Analyze the annual report', leaves: [
		{ id: 'revenue', ask: 'the revenue figure' }, { id: 'costs', ask: 'the costs figure' },
		{ id: 'margin', ask: 'revenue minus costs', needs: ['revenue', 'costs'] },
	] });
	assert.equal(r.converged, true);
	assert.match(r.answer, /margin=513/, 'the upstream values flowed through the bounded projection into the ladder query');
	assert.deepEqual(r.economy, { local: 2, frontier: 1, cost: 1 }, 'THE AMORTIZATION READOUT: covered leaves cost 0 frontier calls');
	const srcOf = Object.fromEntries(r.leaves.map(( l ) => [l.id, l.source] ));
	assert.equal(srcOf.revenue, 'local');
	assert.equal(srcOf.margin, 'frontier', 'each leaf NAMES where it was served from — provenance, not vibes');
	assert.ok(!/annual report/.test(proxyCalls.find(( q ) => /revenue figure/.test(q) )), 'the ladder query stays bounded too');
});

test('MCP zoom — reason-first parse: the LAST ANSWER line wins; an unparseable leaf is flagged, never a silent empty', async () => {
	let n = 0;
	const replies = ['I first thought ANSWER: 1 but no.\nANSWER: 7', 'no final line at all'];
	const r = await zoomTool({ critiqueAsk: async () => replies[n++] }).call({
		task: 't', leaves: [{ id: 'a', ask: 'first' }, { id: 'b', ask: 'second' }],
	});
	const served = Object.fromEntries((r.leaves || []).map(( l ) => [l.id, l.value] ));
	assert.equal(served.a, '7', 'the last ANSWER line is the verdict (reason-first replies)');
	assert.deepEqual(r.unparsed, ['b'], 'a reply with no ANSWER line is NAMED');
	assert.match(r.advice, /maxTokens|unparsed/i, 'and the advice names the measured cause');
});
