'use strict';
/**
 * mcts — class B of the strategy catalog (design §9.2 #13): state-in-graph + a thin deterministic
 * UCB1 driver. Scripted 0-model tests: the search converges on the winning move, the Expandable
 * gate is the LIVE frontier (uncasts on expanded/terminal — watched facts), terminal nodes are
 * never grown, and the whole search replays bit-identically (no randomness in the driver).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { loadPlugin, definePlugin, resolvePlugins } = require('../../lib/plugins');
const { createMCTS } = require('../../plugins/mcts/factory.js');

const MC_DIR = path.join(__dirname, '..', '..', 'plugins', 'mcts');
const RK_DIR = path.join(__dirname, '..', '..', 'plugins', 'reason-kernel');

// a scripted, deterministic game: one ply — 'good' always wins the rollout, 'bad' always loses
const oneply = () => ({
	actions: async ( node ) => node.parent == null ? ['good', 'bad'] : [],
	simulate: async ( node ) => node.move === 'good' ? 1 : 0,
});

test('the search converges on the winning move (deterministic UCB1, no randomness)', async () => {
	const mcts = createMCTS(Object.assign(oneply(), { iterations: 9 }));
	const r = await mcts.run('game');
	assert.equal(r.best.move, 'good', 'the winning move gets the visits');
	assert.equal(r.root.visits, 9, 'every iteration backpropagated to the root');
	const good = r.children.find(( k ) => k.move === 'good' ), bad = r.children.find(( k ) => k.move === 'bad' );
	assert.ok(good.visits > bad.visits, 'exploitation dominates on a deterministic win');
	assert.equal(good.wins, good.visits, 'the good arm never lost a rollout');
	assert.equal(bad.wins, 0, 'the bad arm never won one');
	assert.equal(r.root.wins, good.wins, 'root wins == the sum of winning rollouts');
});

test('the Expandable gate is the LIVE frontier: uncasts on expanded / on terminal (watched facts)', async () => {
	const cfg = resolvePlugins([definePlugin(MC_DIR, [loadPlugin(RK_DIR)])]);
	Graph._providers = cfg.providers;
	const g = new Graph(
		{ lastRev: 0, segments: [], freeNodes: [], nodes: [
			{ _id: 'a', isThought: true, visits: 0, wins: 0, text: 'a' },
			{ _id: 'b', isThought: true, visits: 0, wins: 0, text: 'b' } ] },
		{ label: 'mcts-gate', isMaster: true, autoMount: true, conceptSets: cfg.conceptSets, bagRefManagers: {}, logLevel: 'error' },
		cfg.conceptMap);
	const settle = async () => { for ( let i = 0; i < 60; i++ ) { await nextStable(g); if ( !g._unstable.length && !g._triggeredCastCount ) { await new Promise(( r ) => setImmediate(r) ); if ( !g._unstable.length && !g._triggeredCastCount ) return; } } throw new Error('no settle'); };
	const expandable = ( id ) => !!g.getEtty(id)._mappedConcepts.Expandable;
	await settle();
	assert.ok(expandable('a') && expandable('b'), 'fresh nodes are the frontier');
	await new Promise(( res ) => g.ingest({ a: { expanded: 1 }, b: { terminal: 1 } }, res) );
	await settle();
	assert.equal(expandable('a'), false, 'an expanded node left the frontier (the ensure fell)');
	assert.equal(expandable('b'), false, 'a terminal node left the frontier');
	g.destroy && g.destroy();
});

test('NEG — a terminal root (no actions) grows nothing: best is null, never a fabricated move', async () => {
	const mcts = createMCTS({ actions: async () => [], simulate: async () => 1, iterations: 3 });
	const r = await mcts.run('dead-end');
	assert.equal(r.best, null, 'no move to recommend');
	assert.equal(r.children.length, 0, 'no children fabricated');
	assert.equal(r.root.terminal, true, 'the root was marked terminal');
	assert.equal(r.root.visits, 3, 'the rollouts still ran on the root (honest stats)');
});

test('replay determinism: two searches are JSON-identical', async () => {
	const run = async () => JSON.stringify(await createMCTS(Object.assign(oneply(), { iterations: 7 })).run('game'));
	assert.equal(await run(), await run());
});
