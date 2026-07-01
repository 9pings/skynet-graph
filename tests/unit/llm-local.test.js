'use strict';
/**
 * llm-local — makeLocalAsk is a thin handle over the centralized embedded-inference host. GPU-FREE here: a FAKE host
 * records the request, so the PER-CALL grammar threading (the G-1 rung-2 borderline touchpoint plumbing, cont.⁶) is
 * unit-testable without a model. The host itself (load-once / cache / eviction) is covered in `local-host.test.js`;
 * a separate gitignored live arm exercises the real node-llama-cpp path on the embedded 3B.
 *
 * WHY this patch: the borderline gate advertises constrained decoding (`enumGbnf(spec)`) but the grammar depends on the
 * PER-CALL spec, while `makeLocalAsk` baked a grammar at CONSTRUCTION — so the touchpoint could never actually request it
 * (both "grammar" and "free-text" arms secretly ran free-text). `local-host.ask` already forwards `req.grammar`; the only
 * missing link is `makeLocalAsk`'s handle honoring a per-call `grammar`, which this asserts.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeLocalAsk } = require('../../lib/providers/llm-local');
const { grammarKey } = require('../../lib/providers/local-host');

function fakeHost() {
	const reqs = [];
	return { reqs, async ask( req ) { reqs.push(req); return 'R:' + grammarKey(req.grammar); } };
}

test('makeLocalAsk forwards a PER-CALL grammar override to the host, and falls back to the construction-time grammar', async () => {
	const host = fakeHost();
	const ask = makeLocalAsk({ modelPath: '/fake.gguf', gbnf: 'root ::= "x"', host });   // construction-time gbnf baked
	await ask({ system: 's', user: 'u' });
	assert.deepEqual(host.reqs[0].grammar, { gbnf: 'root ::= "x"' }, 'no per-call grammar → the construction-time grammar');
	await ask({ system: 's', user: 'u2', grammar: { gbnf: 'root ::= "y"' } });
	assert.deepEqual(host.reqs[1].grammar, { gbnf: 'root ::= "y"' }, 'a per-call grammar OVERRIDES the construction one');
});

test('makeLocalAsk with NO construction grammar still forwards the per-call grammar (the borderline enumGbnf path)', async () => {
	const host = fakeHost();
	const ask = makeLocalAsk({ modelPath: '/fake.gguf', host });        // no baked grammar → free-text by default
	await ask({ system: 's', user: 'u' });
	assert.equal(host.reqs[0].grammar, null, 'no grammar at all → free-text (null forwarded)');
	await ask({ system: 's', user: 'u', grammar: { gbnf: 'root ::= "z"' } });
	assert.deepEqual(host.reqs[1].grammar, { gbnf: 'root ::= "z"' }, 'the per-call enumGbnf reaches the host even with no baked grammar');
});

test('makeLocalAsk threads reasoningBudget (construction default + per-call override) to the host', async () => {
	const host = fakeHost();
	const ask = makeLocalAsk({ modelPath: '/fake.gguf', reasoningBudget: 0, host });   // thinking OFF by default
	await ask({ system: 's', user: 'u' });
	assert.equal(host.reqs[0].reasoningBudget, 0, 'the construction reasoningBudget is forwarded (0 = thinking off)');
	await ask({ system: 's', user: 'u', reasoningBudget: 128 });
	assert.equal(host.reqs[1].reasoningBudget, 128, 'a per-call reasoningBudget overrides the construction default');
	const ask2 = makeLocalAsk({ modelPath: '/fake.gguf', host });                       // no default
	await ask2({ system: 's', user: 'u' });
	assert.equal(host.reqs[2].reasoningBudget, undefined, 'unset → undefined (the model default, thinking on)');
});
