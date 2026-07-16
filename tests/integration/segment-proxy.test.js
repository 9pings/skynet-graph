'use strict';
/**
 * segment-proxy (roadmap P2) — a concept-method mounted as a reactive PROXY: it casts on its contract's conditions,
 * delegates its body to another instance (P1 invoke), gates the result (P4 assertPost), and posts the summaryFacts as
 * its cast → JTMS-visible. The good C.8 (an interface, not a COW object). The cast is the cost gradient: delegate →
 * gate → last-resort learning FALLBACK (forge from the reconstituted parent stack, under the gate). ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { makeSegmentProxy, reconstructStack } = require('../../plugins/planner/lib/segment-proxy.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
console.log = console.info = console.warn = () => {};

// the DELEGATE (runs on the shared instance): compute Hot from the frozen input temp.
const METHOD_TREE = { common: { childConcepts: {
	Hot: { _id: 'Hot', _name: 'Hot', require: ['Segment'], ensure: ['$originNode:temp >= 100'] },
} } };
// build the delegate seed from the cast segment's own `temp` (the slot binding).
const buildSeed = ( scope ) => ({ lastRev: 0,
	nodes: [ { _id: 'IN', Node: true, temp: scope._.temp }, { _id: 'OUT', Node: true } ],
	segments: [ { _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' } ] });

// the CALLER graph: a Task segment carrying temp + a downstream Alert that consumes the proxy's posted Hot.
const CONF = ( l ) => ({ label: l, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' });
const callerSeed = ( temp ) => ({ lastRev: 0,
	nodes: [ { _id: 'a', Node: true }, { _id: 'b', Node: true } ],
	segments: [ { _id: 'task', Segment: true, Task: true, temp: temp, originNode: 'a', targetNode: 'b' } ] });
const factsOf = ( g, id ) => { const o = g._objById[id]; return (o && o._etty && o._etty._) || {}; };

function callerTree( proxyFragment ) {
	return { common: { childConcepts: Object.assign({
		Alert: { _id: 'Alert', _name: 'Alert', require: ['Segment'], ensure: ['$Hot == true'] },   // consumes the proxy's output
	}, proxyFragment) } };
}
function boot( proxy, temp ) {
	const saved = Graph._providers;
	Graph._providers = Object.assign({}, saved, proxy.provider);
	const g = new Graph(callerSeed(temp), CONF('caller'), callerTree(proxy.conceptFragment));
	return { g, restore: () => { Graph._providers = saved; } };
}

test('SOUND — the proxy casts, DELEGATES to another instance, gates, posts Hot JTMS-visible (downstream casts)', async () => {
	const proxy = makeSegmentProxy({ name: 'TempProxy', castWhen: ['Task'], contract: { write: ['Hot'], post: ['$Hot == true'] },
		methodMap: METHOD_TREE, buildSeed, boundedFrom: 's', boundedKeys: ['Hot'] });
	const { g, restore } = boot(proxy, 120);
	try {
		await nextStable(g);
		assert.equal(factsOf(g, 'task').TempProxy, true, 'the proxy cast');
		assert.equal(factsOf(g, 'task').Hot, true, 'the delegate result crossed back and posted as the proxy cast');
		assert.equal(factsOf(g, 'task').Alert, true, 'JTMS-visible — the caller downstream cast on the posted summaryFact');
	} finally { restore(); }
});

test('GATE teeth → FALLBACK — an under-declared write (G1) refuses the delegate; the forge fallback fires with the parent STACK', async () => {
	let seenStack = null, seenReason = null;
	const proxy = makeSegmentProxy({ name: 'TempProxy', castWhen: ['Task'],
		contract: { write: [], post: ['$Hot == true'] },                            // under-declares the write → G1 refuses
		methodMap: METHOD_TREE, buildSeed, boundedFrom: 's', boundedKeys: ['Hot'],
		forge: ({ stack, reason, blame }) => { seenStack = stack; seenReason = reason;
			return [ { $_id: '_parent', TempProxy: true, forged: true, forgedBlame: blame && blame.kind } ]; } });
	const { g, restore } = boot(proxy, 120);
	try {
		await nextStable(g);
		assert.equal(seenReason, 'gate-refused', 'the last-resort fallback fires on a gate refusal');
		assert.ok(Array.isArray(seenStack) && seenStack.length >= 1 && seenStack[0].id === 'task', 'the fallback receives the reconstituted parent stack');
		assert.equal(factsOf(g, 'task').forged, true, 'the forge produced the cast (a typed template, re-enters the graph)');
		assert.notEqual(factsOf(g, 'task').Hot, true, 'the unsound delegate result was NEVER posted');
	} finally { restore(); }
});

test('reconstructStack — walks UP the parentSeg chain, bounded, typed-interface only', () => {
	const g = new Graph({ lastRev: 0, nodes: [{ _id: 'n', Node: true }],
		segments: [ { _id: 'root', Segment: true, originNode: 'n', targetNode: 'n', statement: 'ROOT' },
			{ _id: 'mid', Segment: true, originNode: 'n', targetNode: 'n', statement: 'MID', parentSeg: 'root', produces: 'x' },
			{ _id: 'leaf', Segment: true, originNode: 'n', targetNode: 'n', statement: 'LEAF', parentSeg: 'mid', needs: ['x'] } ] },
		CONF('stack'), { common: { childConcepts: {} } });
	const stack = reconstructStack(g, { _: g._objById['leaf']._etty._ });
	assert.deepEqual(stack.map(( s ) => s.id), ['leaf', 'mid', 'root'], 'self first, root last — the bounded problem stack');
	assert.deepEqual(stack.map(( s ) => s.statement), ['LEAF', 'MID', 'ROOT']);
	assert.ok(!('prose' in stack[0]) && stack[0].needs, 'only the typed interface travels (statement/produces/needs), not prose');
});
