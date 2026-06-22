'use strict';
/**
 * Base providers packaged for host opt-in (Phase-0): a real importable
 * `providers/` so a host wires Graph._providers in one line instead of
 * hand-rolling the haversine / LLM glue inline.
 *
 * Pure-unit level: haversine math, JSON salvage, the backend-agnostic LLM
 * factory (ask injected = the external boundary), and the register() helper.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CommonGeo, haversineKm, createLLMProvider, parseJSON, register } = require('../../lib/providers');

test('haversineKm computes great-circle distance in km', () => {
	const paris = { lat: 48.8566, lng: 2.3522 };
	const singapore = { lat: 1.3521, lng: 103.8198 };
	const km = haversineKm(paris, singapore);
	assert.ok(km > 10000 && km < 11500, `Paris->Singapore ~10.7Mm, got ${km}`);
	assert.equal(Math.round(haversineKm(paris, paris)), 0, 'zero distance to itself');
});

test('CommonGeo.Distance provider emits a Distance fact from node Positions', () => {
	const graph = {
		getRef(ref, scope) {
			return ref === 'originNode:Position' ? { lat: 48.8566, lng: 2.3522 }
				: ref === 'targetNode:Position' ? { lat: 1.3521, lng: 103.8198 }
					: undefined;
		}
	};
	let out;
	CommonGeo.Distance(graph, {}, {}, [], (e, r) => { out = r; });
	assert.equal(out.$_id, '_parent');
	assert.ok(out.Distance.inKm > 10000, 'inKm filled');
});

test('CommonGeo.Distance yields null when a Position is missing', () => {
	const graph = { getRef: () => undefined };
	let called = false, out = 'unset';
	CommonGeo.Distance(graph, {}, {}, [], (e, r) => { called = true; out = r; });
	assert.equal(called, true);
	assert.equal(out, null);
});

test('parseJSON salvages the last balanced JSON block from chatty model output', () => {
	assert.deepEqual(parseJSON('blah {"a":1} more'), { a: 1 });
	assert.deepEqual(parseJSON('reasoning... {"draft":true} ...final {"atomic":false}'), { atomic: false });
	assert.deepEqual(parseJSON('```json\n{"x":[1,2]}\n```'), { x: [1, 2] });
	assert.throws(() => parseJSON('no json here'));
});

test('createLLMProvider is backend-agnostic: injected ask drives prompt + JSON fact mapping', async () => {
	const seen = {};
	const ask = async ({ system, user, maxTokens }) => {
		seen.system = system; seen.user = user; seen.maxTokens = maxTokens;
		return 'thinking... {"atomic": false, "reason": "broad"}';
	};
	const prov = createLLMProvider({ ask });
	assert.ok(prov.LLM && typeof prov.LLM.complete === 'function', 'returns LLM::complete fragment');

	const graph = { getRef: (ref, scope) => scope._[ref] };
	const scope = { _: { label: 'recon AD' } };
	const concept = { _name: 'EvalComplexity', _schema: { prompt: { system: 'You judge.', user: 'Step: ${label}', maxTokens: 500, json: true } } };

	const facts = await new Promise((res) => prov.LLM.complete(graph, concept, scope, [], (e, r) => res(r)));
	assert.equal(seen.user, 'Step: recon AD', 'user prompt interpolates ${label} from scope');
	assert.equal(seen.maxTokens, 500);
	assert.equal(facts.$_id, '_parent');
	assert.equal(facts.EvalComplexity, true, 'concept flagged');
	assert.equal(facts.atomic, false, 'parsed JSON merged as facts');
	assert.equal(facts.reason, 'broad');
});

test('createLLMProvider wraps the result under `as` when given, and degrades on ask error', async () => {
	const ask = async () => 'just prose, no json';
	const concept = { _name: 'Summary', _schema: { prompt: { user: 'sum it', as: 'text' } } };
	const graph = { getRef: () => undefined };
	const ok = await new Promise((res) => createLLMProvider({ ask }).LLM.complete(graph, concept, { _: {} }, [], (e, r) => res(r)));
	assert.equal(ok.text, 'just prose, no json', 'raw text stored under `as`');

	const boom = createLLMProvider({ ask: async () => { throw new Error('HTTP 500'); } });
	const degraded = await new Promise((res) => boom.LLM.complete(graph, { _name: 'X', _schema: {} }, { _: {} }, [], (e, r) => res(r)));
	assert.equal(degraded.llmError, 'HTTP 500', 'error captured as a fact, not thrown');
	assert.equal(degraded.X, true, 'concept still flagged so the graph can settle');
});

test('LLM::complete canonicalization barrier: discrete facts tracked, prose untracked, memo key stable across re-prose', async () => {
	const concept = {
		_name: 'Risk',
		_schema: { prompt: { facts: { severity: { enum: ['low', 'high'] }, priceK: { grain: 100, from: 'price' } }, prose: 'note' } }
	};
	const graph = { getRef: () => undefined };
	const run = (reply) => new Promise((res) =>
		createLLMProvider({ ask: async () => reply }).LLM.complete(graph, concept, { _: {} }, [], (e, r) => res(r)));

	// two semantically-equal replies, TEXTUALLY divergent (the K1 scenario)
	const a = await run('{"severity":"HIGH","price":1203.40,"prose":"verbose flowery reply A"}');
	const b = await run('reasoning... {"severity":"high","price":1188,"prose":"a totally different wording B"}');

	assert.equal(a.severity, 'high'); assert.equal(a.priceK, 1200);
	assert.equal(a.severity, b.severity, 'enum snapped to the SAME canonical value');
	assert.equal(a.priceK, b.priceK, 'price wobble collapsed to the SAME bucket');
	assert.equal(a.RiskFactsDigest, b.RiskFactsDigest, 'identical discrete memo key across runs (K1 defeated)');
	assert.equal(a.Risk, true, 'self-flag set');
	assert.equal(a.price, undefined, 'raw/untracked reply keys do NOT leak onto the object');
	assert.equal(a.note, 'verbose flowery reply A', 'free text lands on the declared (untracked) prose key');
	assert.notEqual(a.note, b.note, 'prose preserved and differs — it is terminal, never a dependency');

	const miss = await run('{"severity":"apocalyptic","price":50}');
	assert.deepEqual(miss.RiskCanonMiss, ['severity'], 'out-of-vocab enum fails CLOSED + visible');
	assert.equal(miss.severity, null);
});

test('register wires base providers onto a Graph-like in one line', () => {
	const G = {};
	register(G); // defaults: CommonGeo + a default LLM
	assert.ok(G._providers.CommonGeo && typeof G._providers.CommonGeo.Distance === 'function');
	assert.ok(G._providers.LLM && typeof G._providers.LLM.complete === 'function');

	const G2 = { _providers: { Existing: { fn() {} } } };
	register(G2, [{ CommonGeo }]);
	assert.ok(G2._providers.Existing, 'preserves pre-existing providers');
	assert.ok(G2._providers.CommonGeo, 'merges the selected fragment');
	assert.ok(!G2._providers.LLM, 'only the selected fragment registered');
});
