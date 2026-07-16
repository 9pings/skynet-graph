'use strict';
/**
 * tree-of-thoughts — class B of the strategy catalog (design §9.2 #12): state-in-graph + a thin
 * deterministic beam driver. Scripted 0-model tests: the beam keeps the top-k per depth, a pruned
 * node NEVER costs a propose call (the budget claim), the prune cascades subtrees out natively
 * (the recursive Live gate), and the run replays bit-identically.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');
const { createTreeOfThoughts } = require('../../plugins/tree-of-thoughts/factory.js');

const TOT_DIR = path.join(__dirname, '..', '..', 'plugins', 'tree-of-thoughts');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

// a scripted, deterministic harness: propose fans out labeled branches, score rewards 'a' > 'b' > 'c'
const SCORES = { a: 0.9, b: 0.6, c: 0.2 };
function scripted() {
	const calls = { propose: 0, score: 0 };
	return { calls,
		propose: async ( node ) => { calls.propose++; return ['a', 'b', 'c'].map(( l ) => (node.text === 'seed' ? '' : node.text + '-') + l ); },
		score: async ( node ) => { calls.score++; return SCORES[node.text.slice(-1)]; } };
}

test('beam search: keeps the top-k per depth, the best path is the all-a chain, pruned nodes are never expanded', async () => {
	const s = scripted();
	const tot = createTreeOfThoughts({ propose: s.propose, score: s.score, beamWidth: 2, branching: 3, maxDepth: 2 });
	const r = await tot.run('seed');
	assert.equal(r.best.text, 'a-a', 'the highest-band chain wins');
	assert.deepEqual(r.path.map(( v ) => v.text ), ['seed', 'a', 'a-a'], 'the root→leaf path is read off the structure');
	assert.equal(r.best.scoreBand, 'high', 'the kernel snapped the band (never a raw float in a gate)');
	// budget: depth 0 expands the root (1); depth 1 expands ONLY the beam (2) — the pruned 'c' cost nothing
	assert.equal(s.calls.propose, 3, 'propose ran on live frontier nodes only (1 + beamWidth)');
	assert.equal(r.expanded, 3);
	assert.equal(r.pruned, 1 + 4, 'depth1 pruned c; depth2 pruned 4 of 6 children');
	assert.equal(s.calls.score, 3 + 6, 'every proposed child scored exactly once');
});

test('the prune CASCADE is native: pruning a mid node retracts its whole live subtree (0 traversal code)', async () => {
	// structural face, driver-free: seed a 3-level chain on the grammar and prune the middle
	const cfg = resolvePlugins([definePlugin(TOT_DIR, [loadPlugin(RK_DIR)])]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, segments: [], freeNodes: [], nodes: [
			{ _id: 'n0', isThought: true, depth: 0, text: 'root' },
			{ _id: 'n0.0', isThought: true, depth: 1, parent: 'n0', text: 'mid' },
			{ _id: 'n0.0.0', isThought: true, depth: 2, parent: 'n0.0', text: 'leaf' },
		] },
		{ label: 'tot-cascade', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap);
	const settle = async () => { for ( let i = 0; i < 60; i++ ) { await nextStable(g); if ( !g._unstable.length && !g._triggeredCastCount ) { await new Promise(( r ) => setImmediate(r) ); if ( !g._unstable.length && !g._triggeredCastCount ) return; } } throw new Error('no settle'); };
	const live = ( id ) => !!g.getEtty(id)._mappedConcepts.Live;
	await settle();
	assert.ok(live('n0') && live('n0.0') && live('n0.0.0'), 'precondition: the whole chain is live');
	await new Promise(( res ) => g.ingest({ 'n0.0': { pruned: 1 } }, res) );
	await settle();
	assert.equal(live('n0'), true, 'the root survives');
	assert.equal(live('n0.0'), false, 'the pruned node left the beam');
	assert.equal(live('n0.0.0'), false, 'its DESCENDANT cascaded out — the recursive hop-watcher, no traversal code');
});

test('NEG — a beam wider than the branching prunes nothing (the driver never over-prunes)', async () => {
	const s = scripted();
	const tot = createTreeOfThoughts({ propose: s.propose, score: s.score, beamWidth: 5, branching: 3, maxDepth: 1 });
	const r = await tot.run('seed');
	assert.equal(r.pruned, 0, 'top-5 of 3 children → nothing pruned');
	assert.equal(r.best.text, 'a', 'ranking still picks the best band');
});

test('replay determinism: two runs are JSON-identical', async () => {
	const run = async () => {
		const s = scripted();
		const tot = createTreeOfThoughts({ propose: s.propose, score: s.score, beamWidth: 2, branching: 3, maxDepth: 2 });
		return JSON.stringify(await tot.run('seed'));
	};
	assert.equal(await run(), await run());
});
