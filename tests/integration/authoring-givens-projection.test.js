'use strict';
/**
 * givens × projection × plan-loop — the tiered-plan gap (i)+(iii) wiring (givens.js + context-project + plan-loop +
 * dag-decompose.minSteps). DETERMINISTIC (stub serve/ask, no GPU): locks that the task's BASE FACTS reach the leaf's
 * bounded context through the pool (`val_<given>`, pre-satisfied gate), that an unknown base key is still a typed
 * UNCOVERED refusal (the guard keeps its teeth), that plan-loop routes given-only plans through the projection
 * (the fast path no longer starves leaves), and that the granularity floor re-asks ONCE, bounded.
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createContextProjection, guardPlan, buildSeed } = require('../../lib/authoring/context-project.js');
const { createPlanLoop } = require('../../lib/combos/plan-loop.js');
const { makeDagDecompose, leavesToRoadmap, DECOMPOSE_SYSTEM } = require('../../lib/authoring/dag-decompose.js');
const { numberGivens, seedOf } = require('../../lib/authoring/givens.js');

// deterministic stub: the value names the input KEY=VALUE pairs it saw → we can assert exactly what reached the leaf.
const serve = async ( leaf ) => leaf.produces + '{' + Object.keys(leaf.inputs).sort().map(( k ) => k + '=' + leaf.inputs[k] ).join(',') + '}';
const GIVENS = { g1_wide: 6, g2_tall: 4 };

test('buildSeed — givens land as val_<key> pool entries and pre-satisfy the citing steps gate', () => {
	const seed = buildSeed([{ id: 'A', needs: ['g1_wide', 'up'], produces: 'area' }], 'goal', GIVENS);
	const pool = seed.nodes.find(( n ) => n._id === 'POOL' );
	assert.equal(pool.val_g1_wide, 6);
	assert.deepEqual(pool.available, ['g1_wide', 'g2_tall']);
	const seg = seed.segments.find(( s ) => s._id === 'A' );
	assert.deepEqual(seg.got, ['g1_wide'], 'the given need is pre-satisfied');
	assert.equal(seg.expected, 2, 'the gate still counts ALL needs — only `up` remains awaited');
	assert.equal(pool.wait_up.length, 1, 'non-given needs keep their wait index');
	assert.equal(pool.wait_g1_wide, undefined, 'a given is never waited on');
});

test('projection — a leaf citing givens builds with the VALUES injected into its bounded context', async () => {
	const roadmap = [
		{ id: 'A', needs: ['g1_wide', 'g2_tall'], produces: 'area' },
		{ id: 'B', needs: ['area', 'g1_wide'],    produces: 'ratio' },     // mixed: upstream + given
	];
	const r = await createContextProjection({ serve }).run(roadmap, { statement: 'rect', givens: GIVENS });
	assert.equal(r.refusal, null);
	assert.equal(r.results.A.value, 'area{g1_wide=6,g2_tall=4}', 'A saw the task literals — gap (i) closed');
	assert.equal(r.results.B.value, 'ratio{area=area{g1_wide=6,g2_tall=4},g1_wide=6}', 'B saw upstream AND given');
	assert.ok(r.order.indexOf('A') < r.order.indexOf('B'), 'the counter gate still orders producer→consumer');
});

test('projection — givens flow DOWN a composite (inherited like any down-projected input)', async () => {
	const roadmap = [{ id: 'C', needs: ['g1_wide'], produces: 'out', sub: [
		{ id: 'C1', needs: ['g1_wide'], produces: 'half' },
		{ id: 'C2', needs: ['half'],    produces: 'out' },
	] }];
	const r = await createContextProjection({ serve }).run(roadmap, { statement: 'rec', givens: GIVENS });
	assert.equal(r.refusal, null);
	assert.equal(r.results.C1.value, 'half{g1_wide=6}', 'the sub-leaf read the down-projected given');
});

test('GUARD — an unknown base key is UNCOVERED (typed refusal, teeth kept); NEG: supplying it runs', async () => {
	const roadmap = [{ id: 'A', needs: ['g9_ghost'], produces: 'x' }];
	assert.equal(guardPlan(roadmap, Object.keys(GIVENS)).ok, false);
	const r = await createContextProjection({ serve }).run(roadmap, { givens: GIVENS });
	assert.equal(r.refusal, 'UNCOVERED', 'a leaf citing a non-existent given is refused BEFORE seeding');
	const ok = await createContextProjection({ serve }).run(roadmap, { givens: { g9_ghost: 1 } });
	assert.equal(ok.refusal, null, 'NEG control: the same plan runs once the given exists');
});

test('plan-loop — a given-only plan takes the PROJECTION path and the leaves see the values', async () => {
	const seen = {};
	const loop = createPlanLoop({
		decompose: async () => [
			{ id: 'n_area', request: { id: 'area', kind: 'compute' }, nl: 'width times height', readsExtra: ['g1_wide', 'g2_tall'] },
			{ id: 'n_peri', request: { id: 'peri', kind: 'compute' }, nl: 'perimeter',          readsExtra: ['g1_wide', 'g2_tall'] },
		],
		serveLeaf: async ( leaf ) => { seen[leaf.request.id] = Object.assign({}, leaf.inputs); return 1; },
	});
	const r = await loop.run('rect 6x4', { givens: GIVENS });
	assert.equal(r.refusal, null);
	assert.equal(r.projected, true, 'givens force the projection path (the fast path would starve the leaves)');
	assert.deepEqual(seen.area, { g1_wide: 6, g2_tall: 4 }, 'the leaf executor received the task literals');
	assert.deepEqual(seen.peri, { g1_wide: 6, g2_tall: 4 });
});

test('plan-loop — NEG control: without ctx.givens the same plan starves (documents exactly what gap (i) fixes)', async () => {
	const seen = {};
	const loop = createPlanLoop({
		decompose: async () => [{ id: 'n_a', request: { id: 'area', kind: 'compute' }, nl: 'w×h', readsExtra: ['g1_wide'] }],
		serveLeaf: async ( leaf ) => { seen.area = Object.assign({}, leaf.inputs || {}); return 1; },
	});
	await loop.run('rect', {});
	assert.deepEqual(seen.area, {}, 'no givens channel → the leaf never sees the literal (the old broken behavior)');
});

test('leavesToRoadmap — given keys survive into needs; foreign readsExtra stays context-only', () => {
	const leaves = [{ id: 'n_a', request: { id: 'a' }, nl: 'x', readsExtra: ['g1_wide', 'noise'] }];
	assert.deepEqual(leavesToRoadmap(leaves, GIVENS)[0].needs, ['g1_wide']);
	assert.deepEqual(leavesToRoadmap(leaves)[0].needs, [], 'without givens the old semantics is unchanged');
});

test('minSteps — a too-coarse split re-asks ONCE with a blame, keeps the larger; bounded', async () => {
	const calls = [];
	const one = JSON.stringify([{ produces: 'all', stepKind: 'compute', instruction: 'do it', needs: [] }]);
	const three = JSON.stringify([
		{ produces: 'a', stepKind: 'compute', instruction: 's1', needs: [] },
		{ produces: 'b', stepKind: 'compute', instruction: 's2', needs: ['a'] },
		{ produces: 'c', stepKind: 'compute', instruction: 's3', needs: ['b'] },
	]);
	const ask = async ({ system }) => { calls.push(system); return calls.length === 1 ? one : three; };
	let reasked = null;
	const leaves = await makeDagDecompose({ ask, stepKinds: ['compute'], minSteps: 2, onReask: ( i ) => { reasked = i; } })('multi-step task');
	assert.equal(leaves.length, 3, 'the re-asked (larger) split is kept');
	assert.equal(calls.length, 2, 'exactly ONE re-ask — bounded');
	assert.match(calls[1], /TOO COARSE/, 'the re-ask carries the coarseness blame');
	assert.equal(reasked.firstCount, 1);
	// NEG: still coarse after the retry → the larger split is kept, no loop
	const stubborn = async () => one;
	const l2 = await makeDagDecompose({ ask: stubborn, stepKinds: ['compute'], minSteps: 2 })('task');
	assert.equal(l2.length, 1, 'honest degrade — never loops past one retry');
	// NEG: no minSteps → no re-ask
	const calls3 = [];
	await makeDagDecompose({ ask: async ({ system }) => { calls3.push(system); return one; }, stepKinds: ['compute'] })('task');
	assert.equal(calls3.length, 1);
});

test('DECOMPOSE_SYSTEM — the GIVENS needs-rule is part of the contract', () => {
	assert.match(DECOMPOSE_SYSTEM, /GIVENS/);
	assert.match(DECOMPOSE_SYSTEM, /or a GIVEN key/i, 'the COVERED rule admits given keys');
});

test('end-to-end wiring — numberGivens → seedOf → projection (the P0 harness path), deterministic', async () => {
	const task = 'A rectangle is 6 wide and 4 tall. Area?';
	const givens = seedOf(numberGivens(task));
	const roadmap = [{ id: 'A', needs: Object.keys(givens), produces: 'area' }];
	const a = await createContextProjection({ serve }).run(roadmap, { statement: task, givens });
	const b = await createContextProjection({ serve }).run(roadmap, { statement: task, givens });
	assert.equal(a.results.A.value, 'area{g1_wide=6,g2_tall=4}');
	assert.deepEqual(a.results, b.results, 'deterministic re-run');
});
