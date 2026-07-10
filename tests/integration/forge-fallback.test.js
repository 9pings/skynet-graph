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
const { makeForgeFallback, defaultStackToPrompt, defaultSerializeBlame } = require('../../lib/authoring/forge-fallback.js');
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

// ── BOUNDED BLAME-DRIVEN RETRY (residue USE-2(d), the open-regime DUAL of negotiate; live-proven 17/24→24/24) ──
const RCON = { write: ['n'], post: ['n>=10'], effect: 'pure' };

test('bounded retry — a first-shot gate refusal is RECOVERED by a revision (maxRounds>1); one-shot (default) still throws', async () => {
	const calls = [];
	const forge = ( prompt ) => { calls.push(prompt); const n = /REVISE/.test(prompt) ? 15 : 5;
		return { name: 'forgedN', castTemplate: [{ $_id: '_parent', N: true, n }], summary: { n }, footprint: ['n'], method: { note: 'm' } }; };
	// one-shot (default maxRounds 1): the first shot n=5 fails the post → throw (byte-identical old behavior)
	await assert.rejects(() => makeForgeFallback({ forge })({ stack: [{ id: 'x' }], contract: RCON, reason: 'hole' }), /REFUSED by the gate/, 'one-shot refuses a bad forge (backward-compatible)');
	// maxRounds 2: round-0 n=5 refused → the pushback ("REVISE") flips the stub → round-1 n=15 admitted
	const fb = makeForgeFallback({ forge, maxRounds: 2 });
	const tpl = await fb({ stack: [{ id: 'x' }], contract: RCON, reason: 'hole' });
	assert.deepEqual(tpl, [{ $_id: '_parent', N: true, n: 15 }], 'the revised, GATED candidate is returned');
	assert.equal(calls.length, 3, 'one-shot(1 call) + retry(2 calls) = 3 forge calls');
	assert.ok(fb.index.has('forgedN'), 'the ADMITTED (revised) method is indexed — the amortise is the good one, not the rejected');
});

test('the revision prompt carries the graph PUSHBACK — violated atoms + rejected-history (CONTENT, not just a nonce)', async () => {
	const prompts = [];
	const forge = ( prompt ) => { prompts.push(prompt); const n = /REVISE/.test(prompt) ? 15 : 5;
		return { name: 'f', castTemplate: [{ $_id: '_parent', n }], summary: { n }, footprint: ['n'] }; };
	await makeForgeFallback({ forge, maxRounds: 2 })({ stack: [{ id: 'x' }], contract: RCON, reason: 'hole' });
	assert.equal(prompts.length, 2);
	assert.ok(!/REVISE/.test(prompts[0]), 'round 0 = the bare stack prompt, no pushback');
	assert.ok(/n>=10/.test(prompts[1]), 'round 1 names the VIOLATED atom (n>=10) — the graph pushback content (the +1 lever)');
	assert.ok(/\{"n":5\}/.test(prompts[1]), 'round 1 lists the REJECTED prior ({"n":5}) — the do-not-repeat memory (the dominant lever)');
});

test('0-FALSE + termination — an always-failing forge exhausts maxRounds and throws (never admits a non-gated forge)', async () => {
	let n = 0;
	const forge = () => { n++; return { name: 'f', castTemplate: [{ $_id: '_parent', n: 1 }], summary: { n: 1 }, footprint: ['n'] }; };
	await assert.rejects(() => makeForgeFallback({ forge, maxRounds: 3 })({ stack: [{ id: 'x' }], contract: RCON, reason: 'hole' }), /REFUSED by the gate/, 'no gated candidate in K rounds → typed refusal, 0 admitted');
	assert.equal(n, 3, 'exactly maxRounds forge calls — bounded, terminates (no oscillation past the cap)');
});

test('defaultSerializeBlame folds violated atoms + undeclared writes + rejected-history + attempt number', () => {
	const s = defaultSerializeBlame([{ kind: 'post-violated', detail: 'n>=10' }, { kind: 'undeclared-write', detail: 'junk' }], [{ n: 5 }, { n: 3 }], 2);
	assert.ok(/n>=10/.test(s) && /junk/.test(s) && /\{"n":5\}/.test(s) && /\{"n":3\}/.test(s) && /attempt #3/.test(s), 'the pushback carries violated atoms, undeclared writes, rejected priors, and the attempt number');
});
