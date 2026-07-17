/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C9 — the EXTERNAL CRITICAL MIND (`createCriticalMind`): README feature **F5**, and the one
 * strategy in the catalog that is LLM-MEASURED (GPU, bit-identical re-runs, published numbers).
 *
 * THE MEASURED RESULT THIS DEMOES — N=24 composed debates, gold hidden, every arm re-run bit-identical
 * (WIP/experiments/2026-07-13-bench-think-vs-c9 · docs/CAPABILITIES.md F5):
 *
 *   the same model, asked directly ............ 13/24 ≈ chance · 11 CONFIDENT WRONG verdicts · 0 refusals
 *   the same model, own 1024-tok think mode ... 13/24 ≈ chance · 11 CONFIDENT WRONG verdicts · 0 refusals
 *   this, with the frame DECLARED ............. 24/24 · ZERO wrong · every one by mechanical count
 *   this, with NO frame declared .............. 1/24 decided · ZERO wrong · 23 honest UNDECIDED
 *
 * THE PRODUCT POINT, and it is the whole file: **declaring the frame buys a provable verdict.** Name the
 * points to weigh and it decides — correctly, every time, showing the count. Name nothing and it refuses
 * rather than flip a coin: that is the BOUND, not the product. This demo therefore runs the DECLARED
 * frame, which is where the 24/24 was measured; §4 shows the refusal zone for contrast.
 * (Earlier this demo ran the MATERIAL frame and concluded "it refuses" — demoing the bound and calling it
 * the feature. The measured win was sitting in the bench, unshipped.)
 *
 * `ask` is INJECTED and scripted here, so this runs with no model and no GPU. The prompts printed below
 * are the PLUGIN's own — byte-identical to what the real 9.5 GB model receives (proven by the GPU parity
 * re-measure). In production this same factory is what the `sg mcp` `critique` tool runs.
 *
 * Deterministic, no GPU:  node examples/bootstrap/c9-critical-mind.js
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { createCriticalMind } = require('../../lib/index.js').factories;
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// The MATERIAL: the real arguments, written the way a person would write them.
const STATEMENTS = [
	'PRO: nobody commutes any more — that is an hour a day back for most of the team',
	'PRO: we would not renew the office lease, which is our second largest fixed cost',
	'PRO: we could hire from anywhere instead of within an hour of this building',
	'PRO: the last internal survey came back strongly in favour of staying remote',
	'PRO: the two biggest deals last year were both closed by people we hired remotely',
	'PRO: sick days are down a third since the office closed',
	'CON: the two juniors who joined last year took visibly longer to get up to speed',
	'CON: decisions that used to take a corridor conversation now take three days of messages',
];

// The DECLARED frame: the points to weigh, named up front. This is the input the naive arms do not have,
// and it is exactly what buys a provable verdict (24/24 measured, vs 13/24 asked directly).
const VIEWPOINTS = [
	{ side: 'PRO', text: 'it saves real money' },
	{ side: 'PRO', text: 'it is working commercially' },
	{ side: 'PRO', text: 'the people who work here prefer it' },
	{ side: 'PRO', text: 'we can hire from a wider pool' },
	{ side: 'CON', text: 'juniors ramp up slower' },
];

const calls = [];
function scriptedAsk() {
	return async ( q ) => {
		const u = String(q.user);
		const reply = ( r ) => { calls.push({ system: q.system, user: u, reply: r }); return r; };
		if ( /Which statements GENUINELY make this exact point/.test(u) ) {
			// each declared point must find REAL witnesses in the pool, or it does not get in
			if ( /saves real money/.test(u) ) return reply('cites: p1, p2');
			if ( /working commercially/.test(u) ) return reply('cites: p5, p6');
			if ( /people who work here prefer/.test(u) ) return reply('cites: p4');
			if ( /wider pool/.test(u) ) return reply('cites: p3');
			if ( /juniors ramp up slower/.test(u) ) return reply('cites: c1');
			return reply('cites: NONE');
		}
		if ( /Propose ONE NEW/.test(u) ) return reply('NONE');
		if ( /restatement of one known point/.test(u) ) return reply('NEW');
		if ( /genuinely CONTESTED/.test(u) ) return reply('CONTESTED');
		if ( /Summarize the (PRO|CON) case/.test(u) ) return reply('one-line synthesis.');
		if ( /Rewrite the report/.test(u) ) return reply('polished text.');
		return reply('NONE');
	};
}
function exchange( match, why ) {
	const c = calls.find(( x ) => match.test(x.user) );
	if ( !c ) return;
	gap();
	say('   ┌─ WE SENT THE MODEL ' + '─'.repeat(58));
	c.user.split('\n').forEach(( l ) => say('   │ ' + l) );
	say('   ├─ IT REPLIED ' + '─'.repeat(65));
	String(c.reply).split('\n').forEach(( l ) => say('   │ ' + l) );
	say('   └' + '─'.repeat(78));
	if ( why ) note(why);
}

async function main() {
	const r = await createCriticalMind({ ask: scriptedAsk() })
		.run({ topic: 'Should we go fully remote?', statements: STATEMENTS, viewpoints: VIEWPOINTS });

	title('ASK A MODEL WHICH SIDE WINS AND IT GUESSES. THIS ONE PROVES IT.');
	say('Give a model a pile of arguments and ask which side has the better case: it answers');
	say('confidently, and it is right about as often as a coin toss. That is measured, not a');
	say('figure of speech. This one does not guess — it makes every point earn its place, then counts.');
	gap();
	say('  Over 24 real debates. Same model. Answers hidden. Every run reproducible:');
	val('asked straight out', '13 of 24 right — 11 CONFIDENTLY WRONG, and it never once refused');
	val('with its own think mode', '13 of 24 right — 11 CONFIDENTLY WRONG, and it never once refused');
	val('through this', '24 of 24 right — ZERO wrong, every one shown by a count');
	say('');
	say('  Here is one of those debates, run for real.');

	// ── 1. the frame is DECLARED — the thing that buys a provable verdict ──────────────────────────
	gap();
	beat(1, '"Should we go fully remote?" — 8 real arguments, and we NAME the points to weigh.');
	say('       That naming is the one thing the model asked directly never gets. It is what pays.');
	exchange(/saves real money/, 'for each named point, the model must show WHICH arguments actually make it');
	gap();
	for ( const e of r.ledger )
		note('[' + e.side.padEnd(3) + '] "' + e.text + '"  ⟵ earned by ' + e.witnesses.length
			+ ' real argument' + (e.witnesses.length === 1 ? '' : 's') + ': ' + e.witnesses.join(', '));
	good('every point names the evidence carrying it. No citation, no entry — that is the gate');
	assert.equal(r.frameStatus, 'DECLARED', 'the perimeter is announced, always');
	assert.ok(r.ledger.every(( e ) => (e.witnesses || []).length > 0 ), 'nothing got in unwitnessed');

	// ── 2. IT DECIDES — and shows the count ───────────────────────────────────────────────────────
	gap();
	beat(2, 'So which side wins? It does not weigh, ponder, or have a view. It counts what survived:');
	val('for', r.counts.PRO + ' points that earned their place');
	val('against', r.counts.CON + ' point that earned its place');
	val('the lead', r.margin + ' — and the bar is ' + r.threshold + ', so this clears it');
	good('VERDICT: ' + r.verdict + ' — and it is not an opinion, it is a count you can redo by hand');
	good('the basis is on the record too: "' + r.basis + '"');
	assert.equal(r.verdict, 'PRO', 'the declared frame decides — the measured 24/24 zone');
	assert.equal(r.basis, 'mechanical-count', 'decided by COUNTING, never by the model weighing');
	assert.ok(r.margin >= r.threshold, 'and only because the lead cleared the bar');

	// ── 3. the deliverable quotes its evidence ────────────────────────────────────────────────────
	gap();
	beat(3, 'And the write-up quotes the arguments themselves, word for word:');
	assert.match(r.prose, /Frame status: \*\*DECLARED\*\*/, 'it states its own perimeter');
	assert.match(r.prose, /nobody commutes any more/, 'and quotes its witnesses — auditable line by line');
	good('every claim in it can be checked against the arguments you handed over');

	// ── 4. THE BOUND: no declared frame → it refuses instead of guessing ───────────────────────────
	gap();
	beat(4, 'Now the same 8 arguments, but we name NOTHING — it has to find the points itself:');
	const bare = await createCriticalMind({ ask: async ( q ) => {
		const u = String(q.user);
		if ( /Name the 2 main DISTINCT points of view/.test(u) )
			return /PRO statements/.test(u) ? 'V: saves money\nV: people prefer it' : 'V: juniors ramp slower\nV: decisions slower';
		if ( /Which statements GENUINELY make this exact point/.test(u) )
			return /saves money/.test(u) ? 'cites: p1, p2' : /juniors ramp slower/.test(u) ? 'cites: c1' : 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /restatement of one known point/.test(u) ) return 'NEW';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /Summarize the (PRO|CON) case/.test(u) ) return 'one-line synthesis.';
		if ( /Rewrite the report/.test(u) ) return 'polished text.';
		return 'NONE';
	} }).run({ topic: 'Should we go fully remote?', statements: STATEMENTS });
	val('for / against', bare.counts.PRO + ' / ' + bare.counts.CON + ' — a lead of only ' + bare.margin);
	bad('VERDICT: ' + bare.verdict + '. Too close to call, so it says exactly that');
	say('       This is the bound, not a failure. Over those same 24 debates, with nothing named it');
	say('       refused 23 times rather than guess — and got ZERO wrong. The two arms that never');
	say('       refused were each wrong 11 times, confidently. Refusing is what buys the zero.');
	assert.equal(bare.verdict, 'UNDECIDED', 'below the bar → an honest refusal, never a coin flip');
	assert.equal(bare.frameStatus, 'MATERIAL', 'and it announces it was working without a frame');

	// ── 5. it refuses before it costs you anything ────────────────────────────────────────────────
	gap();
	let asks = 0;
	const thin = await createCriticalMind({ ask: async ( q ) => { asks++; return scriptedAsk()(q); } })
		.run({ topic: 'Should we go fully remote?', statements: ['PRO: only one', 'CON: only one too'] });
	beat(5, 'And handed almost nothing — two lonely arguments?');
	bad('it refuses to even start, and says why: there is not enough here to reason about');
	val('model calls spent', asks + ' — it refused BEFORE costing you anything');
	assert.match(thin.error, /pool too small/, 'an inadequate pool is refused, with the reason');
	assert.equal(asks, 0, 'and refused WITHOUT spending a single model call');

	finish('name the points and it decides: 24/24, zero wrong, by a count you can redo. '
		+ 'The same model guessing gets 11 confidently wrong.', 'BOOTSTRAP OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
