/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C1 — the TYPED-QA APPLIANCE (`createAppliance`): intake → typed barrier → reason-loop → memo.
 * THE GUARANTEE SHOWN: a typed question is ANSWERED (with a confidence band); an out-of-vocabulary intake
 * is REFUSED and the refusal NAMES the missing requirement — never a wrong answer. This is the
 * differentiator: the refusal is structured data, not an error string.
 *
 * Deterministic (a scripted ask stands in for the model). LIVE: pass `--local-model <path.gguf>` to
 * `sg ask "<q>" --concepts <dir>` — the CLI runs this same combo on the embedded model.
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { createAppliance } = require('../../lib/index.js').factories;

// a scripted model: typed intake → decompose → synthesize (the same dispatch shape a real gguf answers).
const typedAsk = async ( { system } ) => {
	const s = String(system || '');
	if ( /inbound message kind/i.test(s) ) return '{"kind":"question","prose":"restated"}';
	if ( /complexityClass/.test(s) )        return '{"complexityClass":"compound"}';
	if ( /"steps"/.test(s) )                return '{"steps":["find country","recall capital"]}';
	if ( /confBand/.test(s) )               return '{"confBand":"high"}';
	if ( /Synthesize/i.test(s) )            return 'Paris.';
	return 'Paris.';
};
// the same model on an OUT-OF-VOCAB input: the intake comes back untyped → the barrier refuses.
const untypedAsk = async ( { system } ) =>
	/inbound message kind/i.test(String(system)) ? '{"kind":"gibberish","prose":"x"}' : 'noise';

async function main() {
	// 1. a typed question is ANSWERED.
	const app = createAppliance({ ask: typedAsk, maxDepth: 1 });
	const ok = await app.answer('What is the capital of France?', { timeout: 30000 });
	app.close();
	console.log('typed   →', JSON.stringify({ status: ok.status, answer: ok.answer, confBand: ok.confBand }));
	assert.equal(ok.status, 'answered');

	// 2. an untyped intake is REFUSED — and the refusal NAMES the missing requirement.
	const app2 = createAppliance({ ask: untypedAsk });
	const no = await app2.answer('zzz?', { timeout: 30000 });
	app2.close();
	console.log('untyped →', JSON.stringify({ status: no.status, reason: no.reason, missing: no.missing }));
	assert.equal(no.status, 'refused', 'never a wrong answer');
	assert.ok(no.missing.includes('kind'), 'the refusal names the missing decision-bearing fact');

	console.log('BOOTSTRAP OK — typed question answered; OOV intake refused, the refusal NAMES the miss');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
