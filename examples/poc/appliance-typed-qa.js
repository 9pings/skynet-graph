'use strict';
/**
 * PoC — the typed-QA APPLIANCE (combo C1) end-to-end (roadmap P1.c).
 *
 * `Graph.factories.createAppliance` assembles the shipped bricks into one governed request/response
 * endpoint: the prose→typed front door (Intake), the packaged reason loop (createReasonLoop) over the
 * `concepts/_substrate` grammar, a durable content-addressed memo, and an answer/refusal projection —
 * with the product posture ON by default (fail-closed, memo ON, validator ON, constrained grammar OFF).
 *
 * It demonstrates the DIFFERENTIATOR: the system follows the typed SPEC, not world-plausibility. A
 * faithfully-typed question is answered; an input that does NOT cross the typed barrier is REFUSED with
 * the missing requirement NAMED — never a confident wrong answer. And a repeat question replays from the
 * persisted sub-graph at ZERO model calls (bit-identical).
 *
 * By default it runs with a CANNED, deterministic `ask` (no GPU, no network) so the mechanism is visible
 * out of the box, exactly like examples/poc/trip-decompose.js. Point it at a real embedded model with
 *     node examples/poc/appliance-typed-qa.js --local-model /path/to/model.gguf
 * (the appliance then runs node-llama-cpp in-process, reasoningBudget:0) — same code, real answers.
 *
 *   node examples/poc/appliance-typed-qa.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/index.js');

// ── the backend: a real embedded model if --local-model is given, else a canned deterministic ask ────
const argv = process.argv.slice(2);
const modelFlag = ( () => { const i = argv.indexOf('--local-model'); return i !== -1 ? argv[i + 1] : (process.env.LOCAL_MODEL || null); } )();

// The canned ask dispatches on the concept's system prompt (the substrate's authored prompts). It types
// any question as a 'question', decomposes into two steps, answers each, synthesizes, grades high — and,
// for the ONE input below, replies the honest out-of-enum 'other' (exactly what a real model does with
// the intake prompt's escape — measured live) so the typed refusal shows on both backends.
function cannedAsk() {
	return async ( { system, user } ) => {
		const s = String(system || '');
		if ( /inbound message kind/i.test(s) ) {
			// the deliberately-untypeable input → the out-of-enum escape → the intake stays `untyped`
			return /^\s*\.\.\./.test(String(user)) ? '{"kind":"other","prose":"unparseable request"}'
			                                       : '{"kind":"question","prose":"' + String(user).slice(0, 40).replace(/"/g, '') + '"}';
		}
		if ( /complexityClass/.test(s) ) return '{"complexityClass":"compound"}';
		if ( /"steps"/.test(s) )         return '{"steps":["identify the subject","state the fact"]}';
		if ( /confBand/.test(s) )        return '{"confBand":"high"}';
		if ( /Synthesize/i.test(s) )     return 'A concise, bounded synthesis of the sub-answers.';
		return 'A direct answer to: ' + String(user).replace(/^Step:\s*/, '').slice(0, 60);
	};
}

// Count model calls on ANY backend (canned or embedded) — the 0-call-replay gate is MEASURED, never
// assumed. The embedded backend is resolved through the shared §4 defaults (buildAsk: one place for
// reasoningBudget:0 etc.), then counted here like the canned one.
function counted( fn ) {
	let n = 0;
	const ask = async ( a ) => { n++; return fn(a); };
	ask.count = () => n;
	return ask;
}

( async () => {
	const ask = counted(modelFlag ? Graph.factories.buildAsk(Graph.factories.resolveComboDefaults({ ask: { localModel: modelFlag } }))
	                              : cannedAsk());
	const app = Graph.factories.createAppliance({ ask: ask, maxDepth: 1 });
	const line = ( s ) => console.log(s);

	line('\n=== PoC — typed-QA appliance (combo C1) ===');
	line('backend: ' + (modelFlag ? 'embedded model ' + modelFlag : 'canned deterministic ask (no GPU)') + '\n');

	// 1. a faithfully-typed question → an answer (+ a confidence band).
	const q1 = 'What is the capital of France?';
	const r1 = await app.answer(q1);
	line('Q: ' + q1);
	line('  → ' + r1.status.toUpperCase() + (r1.status === 'answered' ? ': ' + r1.answer + '  [confidence: ' + r1.confBand + ']' : ''));

	// 2. the SAME question again → served from the persisted sub-graph at 0 new model calls.
	const before = ask.count();
	const r1b = await app.answer(q1);
	const replay = ask.count() - before;
	line('\nQ (repeat): ' + q1);
	line('  → ' + r1b.status.toUpperCase() + ' — new model calls: ' + replay + (replay === 0 ? ' ✅ (0-call replay)' : ' ❌ (expected 0)'));

	// 3. an input that does NOT cross the typed barrier → a TYPED refusal that names the miss.
	const q3 = '... (an unparseable request)';
	const r3 = await app.answer(q3);
	line('\nQ: ' + q3);
	line('  → ' + (r3.status === 'refused'
		? 'REFUSED: reason=' + r3.reason + (r3.missing && r3.missing.length ? ', missing=[' + r3.missing.join(', ') + ']' : '') + '  ✅ (refused, not wrong-answered)'
		: 'ANSWERED: ' + r3.answer + '  ❌ (should have been refused)'));

	// the verdict is COMPUTED from the three results (a demo that also checks itself) — never asserted.
	const gates = [
		['typed question answered',           r1.status === 'answered'],
		['repeat served at 0 model calls',    r1b.status === 'answered' && replay === 0],
		['un-typeable input refused, miss named', r3.status === 'refused' && !!(r3.missing && r3.missing.length)]
	];
	line('');
	gates.forEach( ( g ) => line('  ' + (g[1] ? '✅' : '❌') + ' ' + g[0]) );
	const ok = gates.every( ( g ) => g[1] );
	line(ok ? '\nThe appliance follows the typed SPEC, not world-plausibility: answer, 0-call replay,'
	        : '\n❌ a gate FAILED on this backend — the mechanism claim does not hold here.');
	if ( ok ) line('and a typed refusal that names the missing requirement.\n');
	app.close();
	process.exit(ok ? 0 : 1);
} )().catch( ( e ) => { console.error(e); process.exit(1); } );
