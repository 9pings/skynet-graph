'use strict';
/**
 * forge-fallback (roadmap §5(b)) — the last-resort LEARNING fallback wired for P2's forge hook:
 *   reconstructStack → stackToPrompt (the LEVER) → forge (the model) → RE-ENTER the gate → INDEX-BACK (amortise).
 * The forged method is propose-only (assertPost DISPOSES a bad forge) and typed → determinism holds. The model is a
 * deterministic stub here. ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/index.js');
const { makeForgeFallback, defaultStackToPrompt } = require('../../lib/authoring/forge-fallback.js');
const { makeSegmentProxy } = require('../../lib/authoring/segment-proxy.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

const CONTRACT = { read: ['temp'], write: ['Hot'], post: ['$Hot == true'], effect: 'internal' };

test('the pipeline — stack → prompt → forge → re-gate → index-back (amortise)', async () => {
	const seen = {};
	const forge = ( prompt, args ) => { seen.prompt = prompt; seen.reason = args.reason;
		return { name: 'forgedHot', castTemplate: [{ $_id: '_parent', HotProxy: true, Hot: true }], summary: { Hot: true }, footprint: ['Hot'], method: { note: 'a forged concept-method' } }; };
	const fallback = makeForgeFallback({ forge });
	const stack = [{ id: 'leaf', statement: 'classify the temp', produces: 'Hot', needs: [] }, { id: 'root', statement: 'ROADMAP' }];
	const tpl = await fallback({ stack, contract: CONTRACT, reason: 'gate-refused', blame: { kind: 'post-violated' } });

	assert.deepEqual(tpl, [{ $_id: '_parent', HotProxy: true, Hot: true }], 'the forged cast template is returned to the proxy');
	assert.ok(/classify the temp/.test(seen.prompt) && /Hot/.test(seen.prompt), 'the LEVER: the prompt reconstitutes the stack ("what we\'re doing")');
	assert.equal(seen.reason, 'gate-refused');
	assert.ok(fallback.index.has('forgedHot'), 'the forged method is INDEXED back — the next matching case is a dispatch hit (amortise)');
});

test('propose → DISPOSE — a forged method that violates the contract is refused by the gate (cannot corrupt the caller)', async () => {
	const badForge = () => ({ name: 'bad', castTemplate: [{ $_id: '_parent', HotProxy: true }], summary: { Hot: false }, footprint: ['Hot'] });
	const fallback = makeForgeFallback({ forge: badForge });
	await assert.rejects(() => fallback({ stack: [{ id: 'x' }], contract: CONTRACT, reason: 'gate-refused' }),
		/REFUSED by the gate/, 'the induced post ($Hot==true) fails on the forged {Hot:false} → refused');
});

test('plugs into P2 — a gate-refused delegate triggers the forge, and the proxy casts the FORGED result', async () => {
	const index = new Map();
	const forge = () => ({ name: 'forgedHot', castTemplate: [{ $_id: '_parent', HotProxy: true, Hot: true }], summary: { Hot: true }, footprint: ['Hot'], method: { note: 'forged' } });
	const fallback = makeForgeFallback({ forge, index });
	// the delegate's conceptMap produces NOTHING → summary {} → contract post $Hot==true fails → gate-refused → forge fires.
	const proxy = makeSegmentProxy({ name: 'HotProxy', castWhen: ['Task'], contract: CONTRACT, methodMap: { common: { childConcepts: {} } },
		buildSeed: () => ({ lastRev: 0, nodes: [{ _id: 'IN', Node: true, temp: 120 }, { _id: 'OUT', Node: true }], segments: [{ _id: 's', Segment: true, originNode: 'IN', targetNode: 'OUT' }] }),
		boundedFrom: 's', boundedKeys: ['Hot'], forge: fallback });
	const saved = Graph._providers; Graph._providers = Object.assign({}, saved, proxy.provider);
	try {
		const tree = { common: { childConcepts: Object.assign({ Alert: { _id: 'Alert', _name: 'Alert', require: ['Segment'], ensure: ['$Hot == true'] } }, proxy.conceptFragment) } };
		const g = new Graph({ lastRev: 0, nodes: [{ _id: 'a', Node: true }, { _id: 'b', Node: true }],
			segments: [{ _id: 'task', Segment: true, Task: true, originNode: 'a', targetNode: 'b' }] }, { label: 'c', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
		await nextStable(g);
		const f = g._objById['task']._etty._;
		assert.equal(f.Hot, true, 'the delegate was gate-refused → the forge produced Hot → the proxy cast it');
		assert.equal(f.Alert, true, 'and it is JTMS-visible — the downstream cast on the forged output');
		assert.ok(index.size >= 1, 'the forged method was indexed (amortise)');
	} finally { Graph._providers = saved; }
});

test('defaultStackToPrompt serializes the typed interface of each level (bounded, no prose)', () => {
	const p = defaultStackToPrompt([{ id: 'l', statement: 'do X', produces: 'y', needs: ['a', 'b'] }, { id: 'r', statement: 'ROOT' }], { write: ['y'] }, { reason: 'no-method' });
	assert.ok(/do X/.test(p) && /⊢y/.test(p) && /⊨a,b/.test(p) && /ROOT/.test(p) && /no-method/.test(p) && /PRODUCE y/.test(p), 'the prompt carries statement/produces/needs + the goal — "what we\'re doing"');
});
