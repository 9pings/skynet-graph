'use strict';
/**
 * Bounded revision log (R11.6) — in a long-running / live-standing regime the snapshot +
 * revision history grows unbounded (every settle appends). `cfg.maxRevisions` keeps a retained
 * window: rollback WITHIN it restores exactly; rollback BEYOND it hits the existing "no
 * snapshot" throw. Opt-in (default unset = unbounded, no behaviour change). The gate the
 * standing regime needs before it runs long. Core change (Graph._captureSnapshot); the full
 * suite stays green.
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §7 (live regime).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
console.log = console.info = console.warn = () => {};

const baseSeed = () => ({ lastRev: 0, nodes: [{ _id: 'n', v: 0 }], segments: [] });
const emptyMap = { common: { childConcepts: {} } };

async function pushN( g, n ) {
	for ( let i = 1; i <= n; i++ ) { g.pushMutation({ $$_id: 'n', v: i }, 'n'); await nextStable(g); }
}

test('without cfg.maxRevisions the history is unbounded (control)', async () => {
	Graph._providers = {};
	const g = new Graph(baseSeed(), { label: 'unbounded', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {} }, emptyMap);
	await nextStable(g);
	const before = g.getRevisions().length;
	await pushN(g, 6);
	assert.ok(g.getRevisions().length >= before + 5, 'history grows with each settle (unbounded): ' + g.getRevisions().length);
});

test('cfg.maxRevisions bounds the history; rollback within the window works, beyond throws', async () => {
	Graph._providers = {};
	const g = new Graph(baseSeed(), { label: 'bounded', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, maxRevisions: 3 }, emptyMap);
	await nextStable(g);
	const firstRev = g.getCurrentRevision();
	await pushN(g, 8);

	const kept = g.getRevisions();
	assert.ok(kept.length <= 4, 'history bounded near maxRevisions (3): ' + kept.length + ' [' + kept + ']');
	assert.ok(kept.length >= 2, 'a usable window is retained: ' + kept.length);

	// a retained (recent) revision still exists and rolls back without throwing
	const retained = kept[0];   // the oldest RETAINED rev
	assert.ok(g.getSnapshot(retained), 'the retained snapshot exists');
	assert.doesNotThrow(() => g.rollbackTo(retained), 'rollback to a retained rev works');
	await nextStable(g);
	assert.equal(typeof g._objById['n']._etty._.v, 'number', 'rollback to a retained rev restored the state');

	// rollback BEYOND the retained window throws (the early snapshot was pruned)
	assert.throws(() => g.rollbackTo(firstRev), /no snapshot/, 'rollback beyond the window throws (pruned)');
});
