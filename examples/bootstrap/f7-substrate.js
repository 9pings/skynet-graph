/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP F7 — THE VERSIONABLE REASONING SUBSTRATE: the runnable face of README feature **F7**, and of
 * "Use 1" — the engine standing on its own, with **no LLM anywhere in this file**.
 *
 * The pitch F7 makes is that reasoning state should be versionable the way source is: every settle captures
 * a revision, you can diff two of them, roll back to one (rules included), and fork a sub-world to try
 * something without touching the parent. This file exercises exactly those verbs on the real engine.
 *
 * THE GUARANTEE SHOWN:
 *   1. EVERY SETTLE IS A REVISION. History accrues by itself — you do not snapshot, you just read.
 *   2. DIFF IS STRUCTURAL. `diffRevisions(a, b)` reports added / removed / changed objects, not a text diff.
 *   3. ROLLBACK RESTORES THE RULES TOO. This is the part people miss: `rollbackTo` re-mounts the concept
 *      tree of that revision, so undoing a step where you ALSO changed a rule undoes the rule change. A
 *      graph whose rules are data can be versioned; one whose rules are code cannot.
 *   4. A FORK IS A SANDBOX. A child sub-graph works its own sub-problem — possibly with DIFFERENT
 *      capabilities (its own concept sets) — and nothing lands in the parent until an explicit merge.
 *
 * Deterministic, no GPU, no model:  node examples/bootstrap/f7-substrate.js
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');

const fact = ( g, id, k ) => g._objById[id] && g._objById[id]._etty._[k];
const cast = ( g, id, k ) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);

// A rule, as data: an order is Large when its total clears the threshold. Nothing here is an LLM.
const RULES = { common: { childConcepts: {
	Large: { _id: 'Large', _name: 'Large', require: ['isOrder'], ensure: ['$total >= 100'] },
} } };
// …and the same rule with the threshold moved. Rules are DATA, so this is just another object.
const RULES_STRICTER = { common: { childConcepts: {
	Large: { _id: 'Large', _name: 'Large', require: ['isOrder'], ensure: ['$total >= 500'] },
} } };

async function settle( g ) {
	for ( let i = 0; i < 60; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r) );
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('the substrate graph did not settle');
}

async function main() {
	Graph._providers = {};
	const g = new Graph(
		{ lastRev: 0, segments: [], freeNodes: [], nodes: [{ _id: 'o1', isOrder: true, total: 120 }] },
		{ label: 'f7', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		RULES);
	await settle(g);

	// ── 1. every settle captured a revision — you did not have to ask for one ─────────────────────
	const revA = g.getCurrentRevision();
	console.log('rev A   →', revA, '| o1.Large =', cast(g, 'o1', 'Large'), '(total 120 ≥ 100)');
	assert.equal(cast(g, 'o1', 'Large'), true, 'the rule cast on the data');
	assert.ok(g.getRevisions().length >= 1, 'history accrues by itself');

	// ── 2. grow the graph, then DIFF the two revisions structurally ────────────────────────────────
	await new Promise(( res ) => g.ingest({ o2: { isOrder: true, total: 40 } }, res) );
	await settle(g);
	const revB = g.getCurrentRevision();
	const diff = g.diffRevisions(revA, revB);
	console.log('rev B   →', revB, '| o2.Large =', cast(g, 'o2', 'Large'), '(total 40 < 100 → the rule did NOT cast)');
	console.log('diff    →', JSON.stringify({ added: Object.keys(diff.added), removed: Object.keys(diff.removed), changed: Object.keys(diff.changed) }));
	assert.equal(cast(g, 'o2', 'Large'), false, 'the same rule, honestly not casting on the small order');
	assert.ok('o2' in diff.added, 'the diff NAMES the object that appeared — structural, not textual');
	assert.equal(diff.added.o2.total, 40, 'and carries its facts, so a diff is inspectable, not just a signal');

	// ── 3. ROLLBACK — and note what comes back: the RULES, not just the data ───────────────────────
	// Change the rule (a stricter threshold) AND watch the belief state follow: o1 stops being Large.
	g.patchConcept('Large', RULES_STRICTER.common.childConcepts.Large);
	await settle(g);
	console.log('stricter→ o1.Large =', cast(g, 'o1', 'Large'), '(the rule moved to ≥ 500 → the belief followed, no recompute code)');
	assert.equal(cast(g, 'o1', 'Large'), false, 'a live rule change re-derives the belief state');

	// now undo. THE POINT: this restores the RULE as well — the threshold goes back to 100 by itself.
	g.rollbackTo(revB);
	await settle(g);
	console.log('rollback→ back at rev', revB, '| o1.Large =', cast(g, 'o1', 'Large'), '← the RULE came back too, not just the data');
	assert.equal(cast(g, 'o1', 'Large'), true, 'rollbackTo re-mounted the rules of that revision — rules are data, so they version');
	assert.ok(g._objById['o2'], 'and the data at revB is intact');

	// ── 4. FORK — a sandbox: the child works, and the parent stays untouched until an explicit merge ──
	const child = g.fork(
		{ lastRev: 0, segments: [], freeNodes: [], nodes: [{ _id: 'draft', isOrder: true, total: 900 }] },
		{ label: 'child', logLevel: 'error' });
	await settle(child);
	console.log('fork    →', JSON.stringify({ childDraftLarge: cast(child, 'draft', 'Large'), parentHasDraft: !!g._objById['draft'] }));
	assert.equal(cast(child, 'draft', 'Large'), true, 'the child reasons with the inherited rules');
	assert.equal(!!g._objById['draft'], false, 'THE SANDBOX: the child\'s work is INVISIBLE to the parent');

	// reintegrate explicitly — the host decides what crosses the boundary, and in what shape.
	g.merge(child, 'o1', ( c ) => ({ $$_id: 'o1', bestDraftTotal: c._objById['draft']._etty._.total }) );
	await settle(g);
	console.log('merge   →', JSON.stringify({ 'o1.bestDraftTotal': fact(g, 'o1', 'bestDraftTotal') }), '← only the projection crossed');
	assert.equal(fact(g, 'o1', 'bestDraftTotal'), 900, 'the projected value landed — nothing else did');
	assert.equal(!!g._objById['draft'], false, 'the child\'s internals never leaked into the parent');
	assert.equal(child._dead, true, 'merge consumed the child (it destroys it) — the sandbox is not left running');
	g.destroy && g.destroy();

	console.log('BOOTSTRAP OK — every settle is a revision; diff is structural; rollback restores the RULES too; a fork is a real sandbox until an explicit merge');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
