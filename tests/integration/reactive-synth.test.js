'use strict';
/**
 * Reactive synthesis (roadmap #2): the bottom-up rollup runs INSIDE stabilization —
 * each answered segment appends its id to its parent's grow-only `answeredBy` via the
 * race-free `{__push}` primitive, and a `Rollup` concept gated on
 * `ensure:["$answeredBy.length == $expandedInto.length"]` fires once per parent when
 * its last child reports. NO `synthesize()` post-pass is called — the root answer is on
 * the graph by the time it settles, and it equals the deterministic post-pass result.
 * Zero core change (it rides `{__push}` + `.length` + `ensure`).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { reactiveLoopConceptTree, makeDecomposeProviders } = require('../../lib/authoring/loop.js');
console.log = console.info = console.warn = () => {};

test('synthesis happens reactively in-stabilization, bottom-up, with no post-pass', async () => {
	let rollupFires = 0;
	// same deterministic "experts" as the post-pass test, PLUS an injected bounded rollup.
	Graph._providers = makeDecomposeProviders({
		maxDepth: 2,
		evalFn: () => ({ atomic: false }),
		expandFn: (scope) => [{ name: scope._.label + '.1' }, { name: scope._.label + '.2' }],
		answerFn: (scope) => 'L[' + scope._.label + ']',
		rollupFn: (seg, kids) => { rollupFires++; return '(' + kids.join('+') + ')'; }
	});

	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'start', label: 'start' }, { _id: 'goal', label: 'goal' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', depth: 0, label: 'R' }]
	};

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('reactive synth timed out')), 20000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'reactive', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done || !graph._objById['root']._etty._.answer) return; done = true; clearTimeout(timer); resolve(graph); }
		}, { common: reactiveLoopConceptTree });
	});

	const facts = (id) => g._objById[id]._etty._;

	// the depth-2 binary tree: 4 answered leaves, 3 expanded (rolled-up) internal nodes
	const segs = Object.keys(g._objById).filter((id) => facts(id).Segment);
	const leaves = segs.filter((id) => facts(id).Atomic);
	const expanded = segs.filter((id) => facts(id).expandedInto);
	assert.equal(leaves.length, 4, 'four atomic leaves');
	assert.equal(expanded.length, 3, 'three expanded internal nodes (root + 2 mid)');
	assert.equal(rollupFires, 3, 'each internal node rolled up exactly once (completion-gated, no re-fire)');

	// each parent's answeredBy is a COMPLETE grow-only set of its children's ids
	for (const id of expanded) {
		const e = facts(id);
		assert.equal(e.answeredBy.length, e.expandedInto.length, `${id}: all children reported`);
		assert.deepEqual([...e.answeredBy].sort(), [...e.expandedInto].sort(), `${id}: answeredBy == children (G-Set)`);
	}

	// the root answer was produced REACTIVELY (no synthesize() call) and is the same
	// nested bottom-up fold the deterministic post-pass yields.
	assert.equal(facts('root').Rollup, true, 'root rolled up by a concept, in-stabilization');
	assert.equal(facts('root').Answered, true);
	assert.equal(facts('root').answer, '((L[R.1.1]+L[R.1.2])+(L[R.2.1]+L[R.2.2]))', 'root answer folded from all four leaves');
});
