/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C9 — the EXTERNAL CRITICAL MIND (`createCriticalMind`): README feature **F5**.
 *
 * WHAT THIS RUN IS. A topic string goes in. Nothing else — no statements, no viewpoints, no sides, no
 * answer. The model brainstorms the pool itself, labels each statement itself, and the split into
 * viewpoints is its own. What the GRAPH adds is one thing: **no point gets onto the table without naming
 * the statements that actually carry it** — and the points the model invents mid-debate face that same gate,
 * which is why you will watch one of them get refused below.
 *
 * WHAT IT DOES NOT CLAIM, and this is deliberate (owner, 2026-07-17): **the graph does not weigh the
 * arguments.** It counts what survived, and a count is not a judgment — "four points to two" tells you which
 * side listed more things, not which side is right. There is a limit to what should be decidable by a rule
 * engine at all; weighing a debate and synthesizing a position goes through a model, necessarily. So the
 * graph guarantees the INPUTS to the judgment — real arguments, traceable to their evidence — and leaves the
 * judgment where it belongs. This run shows exactly that, including the moment the count goes wrong.
 *
 * HISTORY, because it is the reason this file looks like it does. Until 2026-07-17 this demo handed C9 a
 * hand-written pool AND a hand-written frame, scripted the model's replies so it could not be wrong, and
 * quoted "24/24 vs 13/24" as though the run had produced it. That benchmark was confounded — a three-line
 * counter with no model scores 24/24 on it (docs/CAPABILITIES.md, "the head-to-head that used to sit here is
 * WITHDRAWN"). And the scripted `'NONE'` reply meant the generation gate this file advertised was never even
 * called: dead code behind a claim. This version is the harness from
 * WIP/experiments/2026-07-13-critical-live — which was honest all along — made shippable.
 *
 * Replays `c9-transcript.json` (recorded by `c9-record.js` on a real 9.5 GB local model, 38 calls). Every
 * prompt and reply below is verbatim from that run; the ledger is what the engine actually produced.
 *
 * Deterministic, no GPU:  node examples/bootstrap/c9-critical-mind.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'c9-transcript.json'), 'utf8'));
const R = T.result;
const W = 88;

/** print one real exchange, verbatim */
function exchange( match, why ) {
	const c = T.calls.find(( x ) => match.test(x.user) );
	if ( !c ) return null;
	gap();
	say('   ┌─ WE SENT THE MODEL ' + '─'.repeat(W - 22));
	wrap(c.user, 14);
	say('   ├─ IT REPLIED ' + '─'.repeat(W - 15));
	wrap(c.reply, 10);
	say('   └' + '─'.repeat(W - 1));
	if ( why ) note(why);
	return c;
}
function wrap( text, maxLines ) {
	const lines = String(text).split('\n');
	const shown = maxLines && lines.length > maxLines ? lines.slice(0, maxLines) : lines;
	for ( const l of shown ) {
		let s = l;
		if ( !s.length ) { say('   │'); continue; }
		while ( s.length > W - 4 ) { say('   │ ' + s.slice(0, W - 4)); s = '   ' + s.slice(W - 4); }
		say('   │ ' + s);
	}
	if ( shown.length < lines.length ) say('   │ … (' + (lines.length - shown.length) + ' more lines)');
}
const stageMsg = ( re ) => (T.stages.find(( s ) => re.test(s.msg) ) || {}).msg;

function main() {
	title('A DEBATE WHERE EVERY ARGUMENT HAS TO NAME ITS EVIDENCE');
	say('We give it a question. That is all it gets: no arguments, no sides, no answer. It has to');
	say('find the arguments itself, and then earn the right to put each one on the table.');
	gap();
	val('the question', '"' + T.topic + '"');
	val('the model', T.recordedWith);
	val('what we supplied', 'the sentence above, and nothing else');
	gap();
	say('  Every prompt and every reply below is real — recorded from that model, replayed here so it');
	say('  runs without a GPU. The graph around them ran for real.');

	// ── 1. the model finds the arguments ──────────────────────────────────────────────────────────
	gap();
	beat(1, 'First it has to come up with the arguments people actually make:');
	exchange(/List the strongest DISTINCT statements/, 'we asked for arguments on BOTH sides, and told it NOT to balance them artificially');
	gap();
	beat(2, 'Then every single statement gets sorted — one forced choice at a time:');
	exchange(/does this statement support answering YES/, null);
	const dropped = stageMsg(/dropped by the forced-choice label/);
	val('kept in the pool', R.pool.length + ' statements');
	if ( dropped ) bad(dropped.replace(/^(\d+) brainstormed statements dropped/, 'it threw $1 of its own out'));
	assert.ok(R.pool.length >= 8, 'the model produced a real pool');
	assert.equal(R.frameStatus, 'FREE', 'FREE = the pool is the model\'s own; coverage is relative to it, not the world');

	// ── 2. THE GATE: no evidence, no entry ────────────────────────────────────────────────────────
	gap();
	say('  Now the part the graph is for. Each point of view has to name the statements that GENUINELY');
	say('  make it — not just agree with its side. No citation, no entry:');
	exchange(/Which statements GENUINELY make this exact point/, 'it must cite specific statements, by id, from the pool');
	gap();
	for ( const e of R.ledger )
		note('[' + String(e.side).padEnd(3) + '] ' + e.key.padEnd(3) + ' "' + e.text.slice(0, 58)
			+ (e.text.length > 58 ? '…' : '') + '"  ⟵ ' + (e.witnesses || []).join(' + '));
	good('every point on that list names the evidence carrying it — that is the gate');
	assert.ok(R.ledger.length > 0, 'the debate produced a table');
	assert.ok(R.ledger.every(( e ) => (e.witnesses || []).length > 0 ), 'NOTHING got on the table unwitnessed');

	// ── 3. the model's OWN ideas face the same gate — including a refusal ──────────────────────────
	gap();
	beat(3, 'Mid-debate it goes looking for angles nobody listed. Its own ideas — and they get NO discount:');
	const gen = R.ledger.filter(( e ) => e.provenance === 'generated+witnesses' );
	const refusal = stageMsg(/gate refusal/);
	for ( const e of gen )
		good('it proposed "' + e.text.slice(0, 52) + '…" and PAID for it: ' + (e.witnesses || []).join(' + '));
	if ( refusal ) {
		bad('and one of its own ideas was REFUSED: ' + refusal.replace(/^PRO:\s*/, ''));
		say('       It had a thesis. It could not name two unused statements that made it. It does not');
		say('       get in. The model gets no benefit of the doubt for an idea being its own.');
	}
	assert.ok(gen.length > 0, 'the generative pass ran for real (the old demo scripted it away and never called it)');
	assert.ok(gen.every(( e ) => (e.witnesses || []).length >= 2 ), 'a generated thesis needs >= 2 real witnesses');
	assert.ok(refusal, 'THE BEAT: at least one of the model\'s own theses was refused by the gate');

	// ── 4. the count — and why it is NOT the answer ───────────────────────────────────────────────
	gap();
	beat(4, 'So who wins? Here is where we stop, and it is on purpose:');
	val('for', R.counts.PRO + ' points survived');
	val('against', R.counts.CON + ' points survived');
	val('the graph says', R.verdict);
	gap();
	say('  Look at the first row of that table. It is filed under FOR — and it says "Monetizing');
	say('  proprietary R&D for direct financial return". That is an argument AGAINST the question we');
	say('  asked. Its two witnesses are real and they genuinely make that point, so the gate was right');
	say('  to admit it: the evidence chain is sound. The model just put it on the wrong side.');
	gap();
	bad('so "' + R.counts.PRO + ' to ' + R.counts.CON + '" is not a verdict. It is an arithmetic over one model\'s filing.');
	say('       The graph refuses to call it, which is the right reflex — but refusing is a STOP, not');
	say('       wisdom. Counting how many points each side listed was never a way to weigh a debate.');
	assert.equal(R.verdict, 'UNDECIDED', 'the margin did not clear the bar, so no verdict is invented');
	const v1 = R.ledger[0];
	assert.equal(v1.side, 'PRO', 'the mislabelled row is real and on the record — we do not tidy it away');
	assert.ok((v1.witnesses || []).length >= 2, 'and its witnesses ARE genuine: the gate did its job');

	// ── 5. what you actually take away: an audited pool, and a model that reads it ─────────────────
	gap();
	beat(5, 'What the model then writes, over a pool where everything is traceable:');
	const forCase = String(R.prose).split(/## The case for/)[1];
	if ( forCase ) {
		const line = forCase.split('\n').map(( l ) => l.trim() ).filter(Boolean)[0];
		gap();
		say('   ┌─ ITS SYNTHESIS OF THE CASE FOR ' + '─'.repeat(W - 34));
		wrap(line, 6);
		say('   └' + '─'.repeat(W - 1));
		note('it read past the misfiled row and summarised the real case — the model weighing, which is its job');
	}
	assert.match(R.prose, /Frame status: \*\*FREE\*\*/, 'the report states its own perimeter, always');

	gap();
	finish('every argument names its evidence — the model\'s own included. Weighing them stays '
		+ 'the model\'s job.', 'BOOTSTRAP OK');
}
main();
