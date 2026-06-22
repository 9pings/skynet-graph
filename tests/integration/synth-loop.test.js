'use strict';
/**
 * The answer-loop: DECOMPOSE a root prompt into a tree of sub-step segments
 * (reactive concepts), then SYNTHESIZE bottom-up — each parent's answer is a
 * bounded rollup of its children's answers, leaf->root. Hermetic: deterministic
 * decompose/answer/rollup functions (no LLM), so it tests the loop MECHANICS.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { loopConceptTree, makeDecomposeProviders, synthesize } = require('../../lib/authoring/loop.js');
console.log = console.info = console.warn = () => {};

test('decompose into a binary tree, then synthesize answers bottom-up to the root', async () => {
	// deterministic "experts": split twice (maxDepth 2 -> 4 leaves), answer leaves, rollup = (a+b)
	Graph._providers = makeDecomposeProviders({
		maxDepth: 2,
		evalFn: () => ({ atomic: false }),                                  // floor decides; never atomic early
		expandFn: (scope) => [{ name: scope._.label + '.1' }, { name: scope._.label + '.2' }],
		answerFn: (scope) => 'L[' + scope._.label + ']'
	});

	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'start', label: 'start' }, { _id: 'goal', label: 'goal' }],
		segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', depth: 0, label: 'R' }]
	};

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('decompose timed out')), 20000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'loop', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
		}, { common: loopConceptTree });
	});

	// decomposition built a depth-2 binary tree => 4 leaf segments, each answered
	const segs = Object.keys(g._objById).filter((id) => g._objById[id]._etty._.Segment);
	const leaves = segs.filter((id) => g._objById[id]._etty._.Atomic);
	assert.equal(leaves.length, 4, 'four atomic leaves');
	for (const id of leaves) assert.ok(g._objById[id]._etty._.answer, `leaf ${id} answered`);
	assert.equal(g._objById['root']._etty._.expandedInto.length, 2, 'root split into 2');

	// synthesize bottom-up: rollup = "(" + children joined by "+" + ")"
	const rootAnswer = await synthesize(g, 'root', (seg, kids) => '(' + kids.join('+') + ')');

	// the root answer reflects ALL four leaves, nested by the tree shape
	assert.equal(rootAnswer, '((L[R.1.1]+L[R.1.2])+(L[R.2.1]+L[R.2.2]))', 'root answer rolled up from all leaves');
	assert.equal(g._objById['root']._etty._.answer, rootAnswer, 'root answer written back onto the graph');
	assert.equal(g._objById['root']._etty._.Synthesized, true, 'root marked synthesized');
});
