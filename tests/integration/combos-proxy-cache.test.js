'use strict';
// C6 — the local-first proxy cache / distiller. Deterministic (a stub frontier that counts calls): a covered
// query is served LOCAL at 0 frontier calls; a miss escalates + enriches; drift re-escalates; a coverage-check
// reject never serves a wrong hit; a verify reject returns the frontier answer WITHOUT polluting the stock.
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const { createLearningLibrary } = require('../../lib/combos/learning-library.js');
const { createProxyCache, makeLocalCoverage } = require('../../lib/combos/proxy-cache.js');

function stubFrontier() {
	const calls = { n: 0, seen: [] };
	const ask = async ( q ) => { calls.n++; calls.seen.push(q); return 'ANSWER(' + q + ')'; };
	return { ask, calls };
}

test('proxy — miss ESCALATES to the frontier + enriches; a repeat is served LOCAL at 0 frontier calls', async () => {
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask });

	const r1 = await px.answer('capital of france?');
	assert.equal(r1.source, 'frontier');
	assert.equal(r1.enriched, true);
	assert.equal(r1.answer, 'ANSWER(capital of france?)');
	assert.equal(f.calls.n, 1, 'the frontier was asked once on the miss');

	const r2 = await px.answer('capital of france?');
	assert.equal(r2.source, 'local', 'the repeat is covered → served from the local stock');
	assert.equal(r2.cost, 0);
	assert.equal(r2.answer, 'ANSWER(capital of france?)');
	assert.equal(f.calls.n, 1, 'NO new frontier call — the stock covered it');
});

test('proxy — a DIFFERENT query still escalates (no false hit)', async () => {
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask });
	await px.answer('q1');
	const r = await px.answer('q2');
	assert.equal(r.source, 'frontier');
	assert.equal(f.calls.n, 2);
});

test('proxy — DRIFT invalidates the stock entry → the next ask re-escalates (anti-drift)', async () => {
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask });
	await px.answer('q');                     // frontier (1)
	await px.answer('q');                     // local (still 1)
	assert.equal(f.calls.n, 1);
	px.drift('q');                            // a fact drifted → invalidate
	const r = await px.answer('q');           // re-escalates
	assert.equal(r.source, 'frontier');
	assert.equal(f.calls.n, 2, 'drift forced a fresh frontier call');
});

test('proxy — COVERAGE-CHECK rejects a wrong/stale hit → invalidate + escalate (never serve a wrong answer)', async () => {
	const f = stubFrontier();
	let confirm = true;
	const px = createProxyCache({ frontierAsk: f.ask, coverageCheck: async () => confirm });
	await px.answer('q');                     // frontier (1), stored
	confirm = true;
	const good = await px.answer('q');        // hit confirmed → local
	assert.equal(good.source, 'local');
	assert.equal(f.calls.n, 1);
	confirm = false;                          // now the local model says the stocked answer does NOT fit
	const r = await px.answer('q');           // hit rejected → invalidate + escalate
	assert.equal(r.source, 'frontier');
	assert.equal(f.calls.n, 2, 'a rejected coverage-check escalated instead of serving the wrong hit');
});

test('proxy — VERIFY reject returns the frontier answer to the user but does NOT pollute the stock (no false neg)', async () => {
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask, verify: async () => false });   // reject every distillation
	const r1 = await px.answer('q');
	assert.equal(r1.answer, 'ANSWER(q)', 'the user still gets the frontier answer (no false negative)');
	assert.equal(r1.cached, false);
	const r2 = await px.answer('q');
	assert.equal(r2.source, 'frontier', 'nothing was stored → the repeat re-escalates');
	assert.equal(f.calls.n, 2);
});

test('proxy — .sgc on demand: pack the warm stock, load it into a fresh proxy (ships the operational stock)', async () => {
	// use a TYPED signature so the stock holds a crystallizable method (the exact-key cache is not a .sgc method).
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask });
	await px.answer('q');
	const bundle = px.pack({ name: 'stock', version: 'v1' });
	assert.equal(bundle.kind, 'methods');
	assert.equal(bundle.format, 'sgc');
	// a fresh proxy can load it (version-gated); the round-trip does not throw and reports a load result.
	const fresh = createProxyCache({ frontierAsk: f.ask });
	const r = fresh.load(bundle, { version: 'v1' });
	assert.ok(r && typeof r === 'object', 'load returns a version-gated result');
});

test('proxy — METRICS (the compass): coverage rises as repeats are served local; stock reuse tracked', async () => {
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask, retention: true });
	// 3 distinct queries, then repeat 2 of them
	for ( const q of ['a', 'b', 'c', 'a', 'b', 'a'] ) await px.answer(q);
	const m = px.metrics();
	assert.equal(m.frontier, 3, '3 distinct → 3 frontier calls');
	assert.equal(m.local, 3, '3 repeats served local');
	assert.equal(m.served, 6);
	assert.equal(m.coverage, 0.5, 'half the queries were covered by the stock');
	assert.equal(m.stock.size, 3);
	assert.equal(m.stock.reused, 2, 'a and b were reused; c never');
	assert.equal(m.stock.reuseRate, 2 / 3);
});

test('proxy — SEMANTIC coverage: a PARAPHRASE snaps to the same key and hits the stock (0 frontier call)', async () => {
	// a stub local model: canonicalizes a query → a normal form (paraphrases collide); confirms fit = yes.
	const localAsk = async ( { system, user } ) => {
		if ( /normal form/i.test(system) ) return /france/i.test(user) ? 'capital france' : /japan/i.test(user) ? 'capital japan' : String(user).toLowerCase();
		if ( /does the answer/i.test(system) ) return 'yes';
		return '';
	};
	const f = stubFrontier();
	const { semanticKey, coverageCheck } = makeLocalCoverage({ localAsk });
	const px = createProxyCache({ frontierAsk: f.ask, semanticKey, coverageCheck });

	const r1 = await px.answer('capital of France?');
	assert.equal(r1.source, 'frontier');
	assert.equal(f.calls.n, 1);

	const r2 = await px.answer("what is France's capital city?");   // a PARAPHRASE → same semantic key
	assert.equal(r2.source, 'local', 'the paraphrase is COVERED by the stock (semantic hit)');
	assert.equal(f.calls.n, 1, 'no new frontier call — the paraphrase was served from the stock');

	const r3 = await px.answer('capital of Japan?');                // a DIFFERENT question still escalates
	assert.equal(r3.source, 'frontier');
	assert.equal(f.calls.n, 2);
});

test('proxy — LIFECYCLE: a bounded/evicting stock drops what is never reused (the owner compass)', async () => {
	const f = stubFrontier();
	const px = createProxyCache({ frontierAsk: f.ask, evictGrace: 2 });
	await px.answer('keep'); await px.answer('keep');       // reused → survives
	await px.answer('junk1'); await px.answer('junk2'); await px.answer('junk3');   // one-offs, never reused
	const u = px.usage();
	assert.ok(u.evicted.deadWeight >= 1, 'never-reused entries were evicted');
	// the reused entry is still served local (0 new frontier call):
	const before = f.calls.n;
	const r = await px.answer('keep');
	assert.equal(r.source, 'local');
	assert.equal(f.calls.n, before, 'the kept entry still covers → no re-escalation');
});
