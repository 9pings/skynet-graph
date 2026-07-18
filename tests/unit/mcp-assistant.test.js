'use strict';
/**
 * The ASSISTANT-lane MCP tools (design WIP/2026-07-10-design-mcp-assistant-llm.md, owner-approved): the lib
 * presents itself as the LLM's assistant over TWO EXPLICIT LANES — SOFT (hint / state_recall: advisory, no
 * guarantee, says so) and HARD (propose: gated, typed verdict, non-bypassable — "the LLM forces" downgrades
 * PROVENANCE, never the admission). The former INSTANCES lane (graph_invoke / graph_instances on the P3
 * pool) was REMOVED 07-18 — the pool is method-dispatch infra (lib/runtime/worker-pool.js), and instances
 * are the mindsmith instance service's typed tools; the removal is pinned by a negative below.
 * Pure stubs (the wirings are injected); the live end-to-end is the KG-MCP gate.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultTools } = require('../../lib/sg/mcp.js');

const by = ( tools, name ) => tools.find(( t ) => t.name === name);

test('lanes appear only when wired — no hints/gate/state/pool → none of the assistant tools exist', () => {
	const tools = defaultTools({});
	for ( const n of ['hint', 'propose', 'state_recall', 'state_note', 'graph_invoke', 'graph_instances'] )
		assert.equal(by(tools, n), undefined, n + ' must not appear unwired');
});

test('hint (SOFT) — returns the slot-glossed certified menu, explicitly advisory', async () => {
	const tools = defaultTools({ hints: { certifiedShapes: ['aggregate>select', 'join>filter>select'], gloss: { aggregate: 'count/total', select: 'projection' } } });
	const r = await by(tools, 'hint').call({ query: 'how many singers' });
	assert.equal(r.advisory, true, 'the SOFT lane says it is advisory');
	assert.equal(r.menu.length, 2);
	assert.match(r.menu[0], /aggregate>select \(aggregate=count\/total, select=projection\)/);
	assert.match(by(tools, 'hint').description, /no guarantee|advisory/i, 'the tool description names the lane');
});

test('hint — an injected proposeMenu narrows the menu (surface-dispatch optimization)', async () => {
	const tools = defaultTools({ hints: { certifiedShapes: ['a>b', 'c>d'], proposeMenu: ( q ) => ['c>d'] } });
	const r = await by(tools, 'hint').call({ query: 'x' });
	assert.deepEqual(r.menu, ['c>d']);
});

test('propose (HARD) — an admissible proposal is admitted', async () => {
	const tools = defaultTools({ gate: { check: async ( p ) => ({ ok: p.shape === 'a>b' }) } });
	const r = await by(tools, 'propose').call({ proposal: { shape: 'a>b' } });
	assert.equal(r.status, 'admitted');
});

test('propose (HARD) — a refusal carries blame + ONLY gate-tested admissible options (never guessed)', async () => {
	const tools = defaultTools({
		gate: {
			check: async ( p ) => p.shape === 'ok1' || p.shape === 'ok2' ? { ok: true } : { ok: false, blame: 'shape ∉ referential' },
			optionsOf: async ( p ) => [{ shape: 'bad' }, { shape: 'ok1' }, { shape: 'ok2' }]
		}
	});
	const r = await by(tools, 'propose').call({ proposal: { shape: 'nope' } });
	assert.equal(r.status, 'refused');
	assert.equal(r.blame, 'shape ∉ referential');
	assert.deepEqual(r.options.map(( o ) => o.shape), ['ok1', 'ok2'], 'options are enumerated THROUGH the gate — bad is filtered out');
});

test('propose (HARD) — force=true NEVER admits: the result is recorded-untrusted, the record hook sees it', async () => {
	let recorded = null;
	const tools = defaultTools({
		gate: {
			check: async () => ({ ok: false, blame: 'refused' }),
			record: ( p, meta ) => { recorded = { p, meta }; }
		}
	});
	const r = await by(tools, 'propose').call({ proposal: { shape: 'x' }, force: true });
	assert.equal(r.status, 'recorded-untrusted', 'forcing downgrades provenance, never bypasses the gate');
	assert.equal(r.certified, false);
	assert.equal(recorded.meta.forced, true, 'the forced record is traced (auditable)');
	assert.match(by(tools, 'propose').description, /never|non-bypassable|force/i, 'the description states the gate never yields');
});

test('state_recall (SOFT) + state_note — recall returns the synthesized state; note goes through the wired ingest', async () => {
	const noted = [];
	const tools = defaultTools({
		state: {
			recall: () => ({ facts: [{ key: 'Planned', value: true, provenance: 'gate' }], frontier: ['leaf-2'] }),
			note: async ( fact ) => { noted.push(fact); return { accepted: true }; }
		}
	});
	const rec = await by(tools, 'state_recall').call({});
	assert.equal(rec.facts[0].key, 'Planned');
	const n = await by(tools, 'state_note').call({ key: 'UserGoal', value: 'refactor auth' });
	assert.equal(n.accepted, true);
	assert.deepEqual(noted, [{ key: 'UserGoal', value: 'refactor auth' }], 'the note is the TYPED fact, passed to the sequenced ingest wiring');
});

test('REMOVED lane stays removed: wiring a pool exposes NO graph_invoke/graph_instances tool (07-18 — instances belong to the instance service)', () => {
	const pool = {
		keys: () => ['k1'], stats: () => ({ instances: 1, uses: 1 }),
		evict: () => true, invoke: async () => ({})
	};
	const tools = defaultTools({ pool });
	assert.equal(by(tools, 'graph_invoke'), undefined, 'graph_invoke must not resurface');
	assert.equal(by(tools, 'graph_instances'), undefined, 'graph_instances must not resurface');
});

// --- stockWiring: a .sgc methods bundle → the hint/gate wirings (the cli.js `--stock` bridge) ---
const { stockWiring } = require('../../lib/sg/mcp.js');

test('stockWiring — certified shapes come from structure.taskKind (deduped, sorted); hint + propose wire up', async () => {
	const bundle = { format: 'sgc', kind: 'methods', methods: [
		{ structure: { taskKind: 'subtract>divide' } },
		{ structure: { taskKind: 'divide' } },
		{ structure: { taskKind: 'subtract>divide' } },        // dup → dedup
		{ structure: {} },                                     // no taskKind → skipped
	] };
	const w = stockWiring(bundle);
	assert.deepEqual(w.hints.certifiedShapes, ['divide', 'subtract>divide']);
	const tools = defaultTools(w);
	const hint = await by(tools, 'hint').call({ query: 'q' });
	assert.deepEqual(hint.menu, ['divide', 'subtract>divide']);
	const ok = await by(tools, 'propose').call({ proposal: { shape: 'divide' } });
	assert.equal(ok.status, 'admitted');
	const ko = await by(tools, 'propose').call({ proposal: { shape: 'nope' } });
	assert.equal(ko.status, 'refused');
	assert.match(ko.blame, /référentiel|referential|certified/i);
	assert.deepEqual(ko.options.map(( o ) => o.shape), ['divide', 'subtract>divide'], 'options = the certified shapes, gate-tested');
});

test('stockWiring — an empty/invalid bundle throws (fail-fast, no silent empty referential)', () => {
	assert.throws(() => stockWiring({ methods: [] }), /stock/i);
	assert.throws(() => stockWiring(null), /stock/i);
});
