'use strict';
/**
 * The closed learning loop: ADAPT strategy from failures. An attempt tries a
 * strategy; if it fails it deposits a distinct-key lesson on the memory anchor
 * AND spawns the next UNTRIED strategy (reading memory to exclude failed ones),
 * until one succeeds. Proves: failed paths steer subsequent ones — live strategy
 * adaptation, deterministically (no LLM).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
console.log = console.info = console.warn = () => {};

test('the graph adapts: tries strategies, learns from failures, converges on the good one', async () => {
	const STRATS = ['A', 'B', 'C'];
	const GOOD = 'C';

	Graph._providers = {
		AI: {
			tryStrategy(graph, concept, scope, argz, cb) {
				const strat = scope._.strategy, atRev = graph.getCurrentRevision();
				if (strat === GOOD) {
					return cb(null, { $_id: '_parent', Attempt: true, solved: true, answer: 'solved:' + strat });
				}
				// failure: record a distinct-key lesson, then pick the next untried strategy
				const mem = graph.getEtty('memory')._;
				const tried = new Set(Object.keys(mem).filter(k => k.startsWith('failed_')).map(k => k.slice(7)));
				tried.add(strat);
				const next = STRATS.find(s => !tried.has(s));
				const tpl = [
					{ $_id: '_parent', Attempt: true, failedStrategy: strat },
					{ $$_id: 'memory', ['failed_' + strat]: { reason: 'bad', atRev } }
				];
				if (next) tpl.push({ _id: scope._._id + '_' + next, Segment: true, originNode: scope._.originNode, targetNode: scope._.targetNode, strategy: next });
				else tpl.push({ $_id: '_parent', exhausted: true });
				cb(null, tpl);
			}
		}
	};

	const conceptMap = {
		common: { childConcepts: { Attempt: { _id: 'Attempt', _name: 'Attempt', require: ['Segment', 'strategy'], provider: ['AI::tryStrategy'] } } }
	};
	const seed = {
		lastRev: 0,
		freeNodes: [{ _id: 'memory' }],
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'try', originNode: 'a', targetNode: 'b', strategy: 'A' }]  // first attempt
	};

	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('feedback loop timed out')), 15000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'fb', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
		}, conceptMap);
	});

	const mem = g._objById['memory']._etty._;
	assert.ok(mem.failed_A && mem.failed_B, 'learned that A and B failed');
	assert.ok(!mem.failed_C, 'did NOT mark the good strategy C as failed');

	// it explored A -> B -> C (each attempt a fresh segment) and converged
	const solved = Object.keys(g._objById)
		.map(id => g._objById[id]._etty._)
		.find(e => e.solved);
	assert.ok(solved, 'a strategy succeeded');
	assert.equal(solved.answer, 'solved:C', 'converged on the good strategy after learning A,B fail');
	assert.equal(solved.strategy, 'C', 'the solving attempt used C');

	// the failed attempts are recorded on their own segments too (auditable trail)
	const failedStrats = Object.keys(g._objById).map(id => g._objById[id]._etty._.failedStrategy).filter(Boolean).sort();
	assert.deepEqual(failedStrats, ['A', 'B'], 'auditable: A and B attempts marked failed in-graph');
});
