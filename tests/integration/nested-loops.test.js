/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * nested-loops — MAP-OF-MAPS first-class (roadmap §5(a), the nesting generalization) + a BIG mixed hierarchical plan.
 * `makeHigherOrderServe`'s body application is now RECURSIVE: when a loop's body key names ANOTHER loop, it recurses
 * (the inner loop's items = the current item) — a loop-of-loops. Bounded by construction (finite items × finite inner
 * items) + a CYCLE guard (a loop that transitively names itself is REFUSED, the control-structure analog of G3).
 * The soundness of the nesting = KG-PROXY-2 (a stack of bounded+gated hops). The big test splits a task into MIXED
 * step types — plain methods, a single loop, a NESTED map-of-maps, and a step depending on loop outputs — and runs it
 * through the REAL projection in emergent dependency order. Deterministic, GPU-free.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeHigherOrderServe } = require('../../lib/authoring/higher-order.js');
const { makeSlotAwareServe } = require('../../lib/authoring/slot-aware-serve.js');
const { createContextProjection } = require('../../lib/authoring/context-project.js');
console.log = console.info = console.warn = () => {};

// the innermost gated method: isHot (n>=100), a full concept-method mounted+gated per item.
const bodySeed = ( item ) => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, n: item }, { _id: 'OUT', Node: true }],
	segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] });
const isHot = { conceptMap: { common: { childConcepts: { Ok: { _id: 'Ok', _name: 'Ok', require: ['Segment'], ensure: ['$originNode:n >= 100'] } } } },
	contract: { write: ['Ok'], post: [] }, boundedFrom: 's', boundedKeys: ['Ok'], buildSeed: ( bl ) => bodySeed(bl.item), value: ( sm ) => sm.Ok === true };
// a plain producer method that yields a constant (mounts a trivial gate-clean graph).
const producer = ( val ) => ({ conceptMap: { common: { childConcepts: {} } }, contract: { write: [], post: [] }, boundedFrom: 'IN', boundedKeys: [],
	buildSeed: () => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true }, { _id: 'OUT', Node: true }], segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] }), value: () => val });

// the NESTED loop: maps isHot over the current item (a batch = a list of numbers). The OUTER loop maps THIS over batches.
const innerHot = { bodyKeyOf: () => 'isHot', items: ( l ) => l.item, combinator: 'map' };

// ── DIRECT map-of-maps (makeHigherOrderServe) ───────────────────────────────────────────────────────────────────

test('MAP-OF-MAPS — a loop whose body is ITSELF a loop nests (the outer maps the inner over batches)', async () => {
	const loops = {
		batchCheck: { bodyKeyOf: () => 'innerHot', items: ( l ) => l.items, combinator: 'map' },   // outer: over batches
		innerHot,                                                                                   // inner: isHot over a batch
	};
	const serve = makeHigherOrderServe({ loops, bodies: { isHot } });
	try {
		const out = await serve({ id: 'mm', produces: 'batchCheck', items: [[120, 50], [130, 90], [10]] });
		assert.deepEqual(out, [[true, false], [true, false], [false]], 'the outer loop mapped the INNER loop (isHot) over each batch');
		assert.ok(serve.pool.size() >= 1, 'the innermost body ran on a mounted shared instance (P3)');
	} finally { await serve.close(); }
});

test('NESTED all/any — combinators compose across levels (inner all, outer any)', async () => {
	const loops = {
		outer: { bodyKeyOf: () => 'innerAll', items: ( l ) => l.items, combinator: 'any' },   // any batch fully-hot?
		innerAll: { bodyKeyOf: () => 'isHot', items: ( l ) => l.item, combinator: 'all' },     // is this batch ALL hot?
	};
	const serve = makeHigherOrderServe({ loops, bodies: { isHot } });
	try {
		assert.equal(await serve({ id: 'x', produces: 'outer', items: [[120, 50], [130, 140]] }), true, 'batch 2 is all-hot → any=true');
		assert.equal(await serve({ id: 'y', produces: 'outer', items: [[120, 50], [130, 90]] }), false, 'no batch is all-hot → any=false');
	} finally { await serve.close(); }
});

test('NEGATIVE — a CYCLIC nested loop (A→B→A) is REFUSED, not an infinite recursion', async () => {
	const loops = {
		A: { bodyKeyOf: () => 'B', items: ( l ) => l.items || l.item || [1], combinator: 'map' },
		B: { bodyKeyOf: () => 'A', items: ( l ) => [1], combinator: 'map' },   // B calls A → cycle
	};
	const serve = makeHigherOrderServe({ loops, bodies: { isHot } });
	try {
		await assert.rejects(() => serve({ id: 'c', produces: 'A', items: [[1]] }), /cyclic nested loop/, 'a cyclic loop chain is refused (control-structure G3)');
	} finally { await serve.close(); }
});

// ── the BIG MIXED HIERARCHICAL PLAN through the real projection ──────────────────────────────────────────────────

test('BIG MIXED PLAN — plain + single-loop + NESTED map-of-maps + a step depending on loop outputs, emergent order', async () => {
	const serve = makeSlotAwareServe({
		methods: {
			nums:    producer([120, 130, 50]),
			batches: producer([[120, 50], [130, 90], [10]]),
			// summary reads its resolved inputs (the two loop outputs) and folds them deterministically.
			summary: { conceptMap: { common: { childConcepts: {} } }, contract: { write: [], post: [] }, boundedFrom: 'IN', boundedKeys: [],
				buildSeed: () => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true }], segments: [] }),
				value: ( sm, leaf ) => 'flags=' + JSON.stringify(leaf.inputs.flags) + ';hotAny=' + leaf.inputs.hotAny },
		},
		bodies: { isHot },
		loops: { innerHot },                                                        // the NESTED loop registered host-side
	});
	// the roadmap: 5 steps, 3 TYPES (plain producer · higher-order loop · nested map-of-maps · plain aggregator), a DAG.
	const roadmap = [
		{ id: 'nums',    produces: 'nums',    nl: 'n', needs: [] },                                                         // plain
		{ id: 'batches', produces: 'batches', nl: 'b', needs: [] },                                                         // plain
		{ id: 'flags',   produces: 'flags',   nl: 'f', needs: ['batches'], slot: { over: 'batches', body: 'innerHot', combinator: 'map' } },  // NESTED map-of-maps
		{ id: 'hotAny',  produces: 'hotAny',  nl: 'h', needs: ['nums'],    slot: { over: 'nums',    body: 'isHot',    combinator: 'any' } },   // single loop
		{ id: 'summary', produces: 'summary', nl: 's', needs: ['flags', 'hotAny'] },                                        // plain aggregator (depends on loop outputs)
	];
	try {
		const { results, order, refusal } = await createContextProjection({ serve }).run(roadmap, { statement: 'hierarchical mixed plan' });
		assert.equal(refusal, null);
		assert.deepEqual(results.nums.value, [120, 130, 50]);
		assert.deepEqual(results.batches.value, [[120, 50], [130, 90], [10]]);
		assert.deepEqual(results.flags.value, [[true, false], [true, false], [false]], 'the NESTED map-of-maps ran inside the projection');
		assert.equal(results.hotAny.value, true, 'the single loop (any) ran');
		assert.equal(results.summary.value, 'flags=[[true,false],[true,false],[false]];hotAny=true', 'the aggregator combined BOTH loop outputs');
		// emergent order: summary casts strictly AFTER both flags and hotAny (its producers).
		assert.ok(order.indexOf('summary') > order.indexOf('flags') && order.indexOf('summary') > order.indexOf('hotAny'), 'emergent dependency order');
	} finally { await serve.close(); }
});
