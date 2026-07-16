/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * dag-slot (roadmap §5(a), the GENERATION side) — `dag-decompose` EMITS a typed METHOD-SLOT (higher-order need), and
 * `makeSlotAwareServe` routes it to the already-built `makeHigherOrderServe`. Closes the residual "émettre les
 * method-slots depuis dag-decompose". Design (confront 2026-07-09): the slot is a TYPED, fail-closed emission
 * (`over` = a produced-key auto-added to needs; `body` snapped onto the closed `bodyKinds` enum; `combinator` snapped
 * onto map|all|any, fold EXCLUDED); the projection carries it (mirroring `sub`); a slot-aware serve reads
 * `items = inputs[over]` from the resolved bounded context. NEGATIVE controls pin the vacuity holes the red-team found:
 * an unresolved `over` REFUSES (never `[].every(Boolean)===true`), a bad `body` fail-closes (never an uncaught throw).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDagDecompose, leavesToRoadmap, SLOT_COMBINATORS } = require('../../plugins/planner/lib/dag-decompose.js');
const { makeSlotAwareServe } = require('../../plugins/planner/lib/slot-aware-serve.js');
const { createContextProjection } = require('../../plugins/planner/lib/context-project.js');
const { createPlanLoop } = require('../../plugins/planner/combo.js');
console.log = console.info = console.warn = () => {};

// a grammar-capable ask STUB: returns a fixed JSON array (the model output) per the user text. Deterministic, GPU-free.
const askReturning = ( arr ) => async () => JSON.stringify(arr);

// two dispatched SLOT-FILLER bodies (isHot n>=100 / isCold n<100), each a full concept-method mounted+gated per item.
const bodySeed = ( item ) => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, n: item }, { _id: 'OUT', Node: true }],
	segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] });
function makeBodies( counter ) {
	const body = ( cmp ) => ({
		conceptMap: { common: { childConcepts: { Ok: { _id: 'Ok', _name: 'Ok', require: ['Segment'], ensure: ['$originNode:n ' + cmp] } } } },
		contract: { write: ['Ok'], post: [] }, boundedFrom: 's', boundedKeys: ['Ok'],
		buildSeed: ( bl ) => { if ( counter ) counter.n++; return bodySeed(bl.item); }, value: ( sm ) => sm.Ok === true,
	});
	return { isHot: body('>= 100'), isCold: body('< 100') };
}
// a PLAIN producer method that yields the items collection [120,130,50] as its value (mounts a trivial graph, gate-clean).
const numsMethod = {
	conceptMap: { common: { childConcepts: {} } }, contract: { write: [], post: [] }, boundedFrom: 'IN', boundedKeys: [],
	buildSeed: () => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true }, { _id: 'OUT', Node: true }], segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] }),
	value: () => [120, 130, 50],
};

// ── EMISSION (dag-decompose) ────────────────────────────────────────────────────────────────────────────────────

test('dag-decompose EMITS a typed method-slot + AUTO-ADDS `over` to needs (the generation side of §5a)', async () => {
	const decompose = makeDagDecompose({ ask: askReturning([
		{ produces: 'nums',   stepKind: 'retrieve', instruction: 'get thresholds', needs: [] },
		{ produces: 'checks', stepKind: 'map',      instruction: 'check each',     needs: [], slot: { over: 'nums', body: 'isHot', combinator: 'map' } },
	]), stepKinds: ['retrieve', 'map'], bodyKinds: ['isHot', 'isCold'] });
	const leaves = await decompose('...');
	assert.deepEqual(leaves[1].request.slot, { over: 'nums', body: 'isHot', combinator: 'map' }, 'the slot is emitted, typed');
	assert.ok(leaves[1].readsExtra.includes('nums'), '`over` is AUTO-ADDED as a need (rides resolution+gate+coverage)');
	assert.equal(leaves[0].request.slot, undefined, 'a plain part carries NO slot');
});

test('NEGATIVE — an out-of-vocab `body` fail-closes: the slot is DROPPED, the leaf degrades to PLAIN (never an unconstrained hole)', async () => {
	const decompose = makeDagDecompose({ ask: askReturning([
		{ produces: 'checks', stepKind: 'map', instruction: 'x', needs: ['nums'], slot: { over: 'nums', body: 'ghost', combinator: 'map' } },
	]), stepKinds: ['map'], bodyKinds: ['isHot', 'isCold'] });
	const leaves = await decompose('...');
	assert.equal(leaves[0].request.slot, undefined, 'body∉bodyKinds → NO slot mounted (fail-closed drop, not a raw open string)');
});

test('NEGATIVE — an out-of-vocab `combinator` snaps to the safe default `map` (fail-closed, flagged)', async () => {
	const decompose = makeDagDecompose({ ask: askReturning([
		{ produces: 'checks', stepKind: 'map', instruction: 'x', needs: ['nums'], slot: { over: 'nums', body: 'isHot', combinator: 'zoop' } },
	]), stepKinds: ['map'], bodyKinds: ['isHot', 'isCold'] });
	const leaves = await decompose('...');
	assert.equal(leaves[0].request.slot.combinator, 'map', 'combinator∉vocab → default map');
	assert.equal(leaves[0].request.slot.combinatorMiss, true, 'the miss is flagged for audit');
});

test('`fold` is NOT in the emittable combinator vocabulary (a reducer is not LLM-emittable — host-only)', () => {
	assert.ok(!SLOT_COMBINATORS.includes('fold'), 'fold excluded from the emittable enum');
	assert.deepEqual(SLOT_COMBINATORS, ['map', 'all', 'any']);
});

// ── END-TO-END (emission → projection → slot-aware serve) ───────────────────────────────────────────────────────

test('END-TO-END — an emitted higher-order leaf is dispatched over its RESOLVED items (the loop-in-loop, non-vacuous)', async () => {
	const counter = { n: 0 };
	const decompose = makeDagDecompose({ ask: askReturning([
		{ produces: 'nums',   stepKind: 'retrieve', instruction: 'thresholds', needs: [] },
		{ produces: 'checks', stepKind: 'map',      instruction: 'check each', needs: [], slot: { over: 'nums', body: 'isHot', combinator: 'map' } },
	]), stepKinds: ['retrieve', 'map'], bodyKinds: ['isHot', 'isCold'] });
	const leaves = await decompose('...');
	const serve = makeSlotAwareServe({ methods: { nums: numsMethod }, bodies: makeBodies(counter) });
	try {
		const { results, refusal } = await createContextProjection({ serve }).run(leavesToRoadmap(leaves), { statement: 'go' });
		assert.equal(refusal, null);
		assert.deepEqual(results.nums.value, [120, 130, 50], 'the producer leaf yielded the items');
		assert.deepEqual(results.checks.value, [true, true, false], 'the dispatched body isHot ran over the RESOLVED items [120,130,50]');
		assert.equal(counter.n, 3, 'the body was invoked EXACTLY 3× — not a vacuous empty pass');
	} finally { await serve.close(); }
});

test('SWAP the emitted body → inverted result (isHot vs isCold), same loop — through decompose+projection', async () => {
	const mk = ( body ) => makeDagDecompose({ ask: askReturning([
		{ produces: 'nums',   stepKind: 'retrieve', instruction: 't', needs: [] },
		{ produces: 'checks', stepKind: 'map',      instruction: 'c', needs: [], slot: { over: 'nums', body: body, combinator: 'map' } },
	]), stepKinds: ['retrieve', 'map'], bodyKinds: ['isHot', 'isCold'] });
	for ( const [body, expected] of [['isHot', [true, true, false]], ['isCold', [false, false, true]]] ) {
		const leaves = await mk(body)('...');
		const serve = makeSlotAwareServe({ methods: { nums: numsMethod }, bodies: makeBodies() });
		try {
			const { results } = await createContextProjection({ serve }).run(leavesToRoadmap(leaves), { statement: 'go' });
			assert.deepEqual(results.checks.value, expected, 'body ' + body + ' → ' + JSON.stringify(expected));
		} finally { await serve.close(); }
	}
});

test('combinators all/any over the dispatched body (the loop reduces) — routed from the emitted combinator', async () => {
	for ( const [comb, expected] of [['all', false], ['any', true]] ) {   // isHot over [120,130,50]: not-all, some
		const leaves = await makeDagDecompose({ ask: askReturning([
			{ produces: 'nums',   stepKind: 'retrieve', instruction: 't', needs: [] },
			{ produces: 'checks', stepKind: 'map',      instruction: 'c', needs: [], slot: { over: 'nums', body: 'isHot', combinator: comb } },
		]), stepKinds: ['retrieve', 'map'], bodyKinds: ['isHot', 'isCold'] })('...');
		const serve = makeSlotAwareServe({ methods: { nums: numsMethod }, bodies: makeBodies() });
		try {
			const { results } = await createContextProjection({ serve }).run(leavesToRoadmap(leaves), { statement: 'go' });
			assert.equal(results.checks.value, expected, comb + ' → ' + expected);
		} finally { await serve.close(); }
	}
});

test('NEGATIVE (the red-team break) — an UNRESOLVED `over` REFUSES, it never returns a vacuous []/true', async () => {
	// hand-build a higher-order leaf whose `over` has NO producer in the plan → guardPlan must refuse UNCOVERED
	// (because `over` is a need), NOT let items resolve to [] and pass vacuously.
	const roadmap = [{ id: 'checks', produces: 'checks', nl: 'c', needs: ['ghost_nums'], slot: { over: 'ghost_nums', body: 'isHot', combinator: 'all' } }];
	const serve = makeSlotAwareServe({ methods: {}, bodies: makeBodies() });
	try {
		const { results, refusal } = await createContextProjection({ serve }).run(roadmap, { statement: 'go' });
		assert.equal(refusal, 'UNCOVERED', 'an uncovered items source is a TYPED refusal (over is a need) — not a silent empty loop');
		assert.notEqual(results.checks && results.checks.value, true, 'never the vacuous all([])===true');
	} finally { await serve.close(); }
});

test('NEGATIVE — a slot whose `over` resolved to a NON-array is refused by the runtime belt (not iterated char-by-char)', async () => {
	// producer yields a STRING, not an array → the belt must refuse, not iterate its characters.
	const strMethod = Object.assign({}, numsMethod, { value: () => 'oops' });
	let fellBack = null;
	const roadmap = [
		{ id: 'nums',   produces: 'nums',   nl: 'n', needs: [] },
		{ id: 'checks', produces: 'checks', nl: 'c', needs: ['nums'], slot: { over: 'nums', body: 'isHot', combinator: 'map' } },
	];
	const serve = makeSlotAwareServe({ methods: { nums: strMethod }, bodies: makeBodies(),
		fallback: ( leaf, ctx, info ) => { fellBack = info; return 'REFUSED'; } });
	try {
		const { results } = await createContextProjection({ serve }).run(roadmap, { statement: 'go' });
		assert.equal(results.checks.value, 'REFUSED', 'a non-array items source falls back (typed), never iterates a string');
		assert.equal(fellBack.reason, 'slot-unresolved');
	} finally { await serve.close(); }
});

test('NEGATIVE — an unknown `body` at serve time hits the FALLBACK, never an uncaught throw', async () => {
	// bypass the decompose fail-closed drop by hand-building the slot with an unknown body key.
	let fellBack = null;
	const roadmap = [
		{ id: 'nums',   produces: 'nums',   nl: 'n', needs: [] },
		{ id: 'checks', produces: 'checks', nl: 'c', needs: ['nums'], slot: { over: 'nums', body: 'ghost', combinator: 'map' } },
	];
	const serve = makeSlotAwareServe({ methods: { nums: numsMethod }, bodies: makeBodies(),
		fallback: ( leaf, ctx, info ) => { fellBack = info; return 'FORGE'; } });
	try {
		const { results } = await createContextProjection({ serve }).run(roadmap, { statement: 'go' });
		assert.equal(results.checks.value, 'FORGE', 'a dispatch miss on the body routes to the §5 forge fallback');
		assert.equal(fellBack.reason, 'no-body');
	} finally { await serve.close(); }
});

test('PLAN-LOOP path — an emitted slot survives the C7 leaf shape (request.id dispatch, relabelled inputs); regression: no DIVERGENT', async () => {
	// the production path: createPlanLoop(decompose, serveLeaf=slot-aware). The plan-loop leaf keys on `request.id`
	// (id is prefixed `n_<key>`, no `produces`) and relabels inputs to write-keys — a naive `produces||id` keyOf
	// mis-dispatches → the Step provider errors → the concept re-fires to the apply-cap (1000) = DIVERGENT. The
	// robust keyOf (request.id || produces || id) fixes it; this pins the regression.
	const decompose = makeDagDecompose({ ask: askReturning([
		{ produces: 'nums',   stepKind: 'retrieve', instruction: 't', needs: [] },
		{ produces: 'checks', stepKind: 'map',      instruction: 'c', needs: [], slot: { over: 'nums', body: 'isHot', combinator: 'map' } },
	]), stepKinds: ['retrieve', 'map'], bodyKinds: ['isHot', 'isCold'] });
	const serve = makeSlotAwareServe({ methods: { nums: numsMethod }, bodies: makeBodies() });
	try {
		const r = await createPlanLoop({ decompose, serveLeaf: serve }).run('go', { statement: 'go' });
		assert.equal(r.projected, true, 'the plan projected (a real intra-plan dependency: checks needs nums)');
		assert.deepEqual(r.refused, [], 'nothing refused — the higher-order leaf dispatched cleanly (no DIVERGENT re-fire)');
		assert.match(r.answer, /checks=true,true,false/, 'the emitted slot ran the dispatched loop over the relabelled resolved items');
	} finally { await serve.close(); }
});

test('ROUTING — a PLAIN leaf (no slot) goes to makeMethodServe; a slot leaf goes to the higher-order loop', async () => {
	const roadmap = [
		{ id: 'nums',   produces: 'nums',   nl: 'n', needs: [] },                                                          // plain
		{ id: 'checks', produces: 'checks', nl: 'c', needs: ['nums'], slot: { over: 'nums', body: 'isHot', combinator: 'map' } },  // higher-order
	];
	const serve = makeSlotAwareServe({ methods: { nums: numsMethod }, bodies: makeBodies() });
	try {
		const { results } = await createContextProjection({ serve }).run(roadmap, { statement: 'go' });
		assert.deepEqual(results.nums.value, [120, 130, 50], 'plain leaf → mounted method (value)');
		assert.deepEqual(results.checks.value, [true, true, false], 'slot leaf → dispatched loop over items');
	} finally { await serve.close(); }
});
