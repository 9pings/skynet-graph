'use strict';
/**
 * context-project — GRAPH-NATIVE CONTEXT PROJECTION (lib/authoring/context-project.js). Promoted from the study
 * `WIP/experiments/2026-07-08-graph-context-completion/` (reactive-pool.js the reference, recursive.js multi-level).
 * DETERMINISTIC (no GPU, no network): a stub `serve` is injected, so the graph-native mechanism is exercised
 * end-to-end without a model. Locks the projection's gates, each with a discriminating negative control:
 *
 *   1 FLAT       — independent parts all build, each on its OWN bounded context (no cross-leaf leakage).
 *   2 CHAIN      — a consumer casts AFTER its producer (counter gate) and reads the producer's value (context completed).
 *   3 PARALLEL   — two parts needing the same input are INDEPENDENT (both build, neither waits on the other).
 *   4 RECURSIVE  — a composite re-decomposes; down-projection feeds its children; the terminal REPORTS UP; the
 *                  downstream reads the remonted value and NOT the sub-plan internals (bounded across the level).
 *   5 GUARD-CYCLE    — a circular dependency is REFUSED offline (never seeded). NEG: the acyclic plan runs.
 *   6 GUARD-UNCOVERED— a need with no producer is REFUSED offline. NEG: covered plan runs.
 *   7 REBOOT     — serialize → new Graph → identical state, 0 re-fire (a completed roadmap is a fixpoint), incl. runtime sub-steps.
 *   8 DETERMINISM— the same roadmap yields the same results.
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const cp = require('../../lib/authoring/context-project.js');
const { createContextProjection, guardPlan, makeProviders, defaultComplete, buildSeed, CONCEPT_MAP, allSteps } = cp;

// a deterministic stub serve: the value names WHICH input keys it saw (bounded) → we can assert the neighbourhood.
const serve = async ( leaf ) => leaf.produces + '<' + Object.keys(leaf.inputs).sort().join('+') + '>';
const proj = () => createContextProjection({ serve });

const CHAIN = [
	{ id: 'P1', needs: [],                          produces: 'glossary' },
	{ id: 'P2', needs: ['glossary'],                produces: 'engineModel' },
	{ id: 'P4', needs: ['glossary'],                produces: 'intro' },        // independent of P2
	{ id: 'P3', needs: ['engineModel'],             produces: 'apiSurface' },
	{ id: 'P5', needs: ['apiSurface', 'glossary'],  produces: 'examples' },     // MULTI-DEP (2 resources)
];
const RECURSIVE = [
	{ id: 'T1', needs: [],         produces: 'spec' },
	{ id: 'Tc', needs: ['spec'],   produces: 'engine', sub: [
		{ id: 'C1', needs: ['spec'],   produces: 'parser' },
		{ id: 'C2', needs: ['parser'], produces: 'engine' },   // TERMINAL → reports up
	] },
	{ id: 'T2', needs: ['engine'], produces: 'doc' },
];

test('1 FLAT — independent parts all build on their own bounded context', async () => {
	const flat = [{ id: 'A', needs: [], produces: 'a' }, { id: 'B', needs: [], produces: 'b' }];
	const r = await proj().run(flat, { statement: 'goal' });
	assert.equal(r.refusal, null);
	assert.equal(r.results.A.value, 'a<>', 'A built with no inputs');
	assert.equal(r.results.B.value, 'b<>', 'B built with no inputs (independent, no leakage from A)');
});

test('2 CHAIN — a consumer casts after its producer and reads its value (context completed)', async () => {
	const r = await proj().run(CHAIN, { statement: 'doc' });
	assert.equal(r.refusal, null);
	const pos = Object.fromEntries(r.order.map(( id, i ) => [id, i] ));
	assert.ok(pos['P1'] < pos['P2'], 'P2 (needs glossary) casts after P1');
	assert.ok(pos['P2'] < pos['P3'], 'P3 (needs engineModel) casts after P2');
	assert.ok(pos['P3'] < pos['P5'] && pos['P1'] < pos['P5'], 'P5 (multi-dep) casts after BOTH its producers — the counter gate');
	// context completion: P2 read the glossary VALUE produced by P1 (in its bounded prompt)
	assert.match(r.results.P2.prompt, new RegExp('glossary=' + r.results.P1.value.replace(/[<>]/g, ( c ) => '\\' + c )), 'P2 prompt carries P1s glossary value');
	assert.equal(r.results.P5.value, 'examples<apiSurface+glossary>', 'P5 saw both its inputs');
});

test('3 PARALLEL — two parts needing the same input are independent (both build)', async () => {
	const r = await proj().run(CHAIN, { statement: 'doc' });
	assert.equal(r.results.P2.kind, 'leaf'); assert.equal(r.results.P4.kind, 'leaf');
	assert.equal(r.results.P2.value, 'engineModel<glossary>');
	assert.equal(r.results.P4.value, 'intro<glossary>', 'P4 built off glossary too — parallel branch, no false dependency');
});

test('4 RECURSIVE — composite decomposes, down-projects, terminal reports up; downstream is bounded', async () => {
	const r = await proj().run(RECURSIVE, { statement: 'build-compiler' });
	assert.equal(r.refusal, null);
	assert.equal(r.results.Tc.kind, 'composite', 'Tc re-decomposed (no value of its own)');
	assert.equal(r.results.C1.kind, 'leaf'); assert.equal(r.results.C2.kind, 'leaf');
	// C1 consumed the DOWN-projected spec; C2 (terminal) reports engine UP; T2 reads the remonted engine
	assert.equal(r.results.C1.value, 'parser<spec>', 'C1 built from the down-projected spec');
	assert.equal(r.graph.getEtty('POOL')._.val_engine, r.results.C2.value, 'parent pool val_engine == C2.out (remontée value-faithful)');
	assert.match(r.results.T2.prompt, /engine=engine</, 'T2 built from the remonted engine value');
	// BOUNDED across the level: T2 reads only `engine`, never the sub-plan-internal `parser`. The invariant is WHICH
	// KEYS a node reads (its needs / input set), not whether an opaque value happens to encode its own provenance.
	assert.equal(r.results.T2.value, 'doc<engine>', 'T2s input KEY set is {engine} only — it never read parser (the composite hid its internals)');
	assert.deepEqual(r.results.T2.needs, ['engine'], 'T2 reads ONLY engine (bounded across the level)');
	assert.deepEqual(r.results.C2.needs, ['parser'], 'C2 reads parser INSIDE the composite (the sub-plan-internal dep)');
});

test('5 GUARD-CYCLE — a circular dependency is refused offline, never seeded', async () => {
	const cyclic = [{ id: 'X', needs: ['fy'], produces: 'fx' }, { id: 'Y', needs: ['fx'], produces: 'fy' }];
	assert.equal(guardPlan(cyclic).ok, false, 'guardPlan flags the cycle');
	const r = await proj().run(cyclic, {});
	assert.equal(r.refusal, 'CYCLE');
	assert.equal(r.graph, null, 'refused BEFORE seeding (no graph booted)');
});

test('6 GUARD-UNCOVERED — a need with no producer is refused offline; NEG: covered runs', async () => {
	const orphan = CHAIN.concat([{ id: 'P6', needs: ['perfBaseline'], produces: 'benchmarks' }]);
	const g = guardPlan(orphan);
	assert.equal(g.ok, false); assert.deepEqual(g.uncovered.map(( u ) => u.step ), ['P6']);
	assert.equal((await proj().run(orphan, {})).refusal, 'UNCOVERED');
	// NEG: recursive sub-level uncovered is caught too
	const badSub = JSON.parse(JSON.stringify(RECURSIVE)); badSub[1].sub[0].needs = ['ast'];
	assert.equal((await proj().run(badSub, {})).refusal, 'UNCOVERED', 'a mis-split SUB-plan is caught recursively');
	// NEG control: the covered plan runs
	assert.equal((await proj().run(CHAIN, { statement: 'd' })).refusal, null);
});

test('7 REBOOT — serialize → new Graph → identical, 0 re-fire (incl. runtime sub-steps)', async () => {
	const r = await proj().run(RECURSIVE, { statement: 'build-compiler' });
	const ids = allSteps(RECURSIVE).map(( s ) => s.id );
	const stateOf = ( gg ) => ids.map(( id ) => { const f = gg.getEtty(id)._; return id + ':' + (f.Step === true ? f.out : f.Decompose === true ? 'DEC' : 'UNBUILT'); } ).join('|');
	const before = stateOf(r.graph);
	const snapshot = r.graph.serialize();
	const rebootOrder = [];
	const saved = Graph._providers;
	Graph._providers = Object.assign({}, saved, makeProviders(serve, defaultComplete, {}, rebootOrder));
	let g2;
	try {
		g2 = new Graph(snapshot, { label: 'reboot', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {} }, CONCEPT_MAP);
		await nextStable(g2);
	} finally { Graph._providers = saved; }
	assert.equal(stateOf(g2), before, 'rebooted state identical (deterministic, incl. sub-segments)');
	assert.equal(rebootOrder.length, 0, 'nothing re-fired — the completed recursive roadmap is a stable fixpoint');
});

test('8 DETERMINISM — the same roadmap yields the same results', async () => {
	const a = await proj().run(CHAIN, { statement: 'doc' });
	const b = await proj().run(CHAIN, { statement: 'doc' });
	assert.deepEqual(a.results, b.results);
});
