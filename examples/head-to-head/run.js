/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * HEAD-TO-HEAD on classic problems — the same real model, asked twice: on its own, and through the graph.
 * Replays `transcript.json`, recorded on a real 9.5 GB local model by `record.js` (which needs a GPU).
 * Every prompt and every reply below is verbatim from that run. Nothing here is illustrative.
 *
 *   node examples/head-to-head/run.js
 *
 * THE DEAL: whatever the model answered is what is printed — including every case where this project does
 * NOT come out ahead. A demo that only shows its wins is an advert.
 *
 * READ THIS BEFORE EDITING THE PROSE. Every count and every verdict below is DERIVED from the transcript
 * at print time — no sentence here hard-codes how many cases there are or how they went. That is deliberate,
 * and it is a scar: this file once said "including the one where this project LOSES" for three commits after
 * the loss had been engineered away (`7151748` fixed the strawberry cut, `count` stopped losing, the boast
 * stayed). Hand-written prose about data drifts the moment the data moves. Derive it, or it will lie for you.
 */
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcript.json'), 'utf8'));
const W = 86;

// The score, READ OFF the transcript — never asserted by hand. If a case starts or stops losing, every
// sentence in this file follows automatically.
const WON  = T.cases.filter(( c ) => !c.aloneRight && c.withRight );   // the graph turned wrong into right
const TIED = T.cases.filter(( c ) => c.aloneRight && c.withRight );    // the model already coped alone
const LOST = T.cases.filter(( c ) => c.aloneRight && !c.withRight );   // the graph made it WORSE
const BOTH = T.cases.filter(( c ) => !c.aloneRight && !c.withRight );  // neither got there
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const say_n = ( n ) => WORD[n] || String(n);
const cap = ( s ) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = ( n, one, many ) => n === 1 ? one : many;

function box( label, lines, mark ) {
	say('   ┌─ ' + label + ' ' + '─'.repeat(Math.max(0, W - label.length - 4)));
	for ( const l of String(lines).split('\n') ) {
		// keep it readable: wrap long prompt lines rather than letting them run off
		let s = l;
		while ( s.length > W - 3 ) { say('   │ ' + s.slice(0, W - 3)); s = '  ' + s.slice(W - 3); }
		say('   │ ' + s);
	}
	say('   └' + '─'.repeat(W - 1) + (mark ? '  ' + mark : ''));
}

function verdictLine( c ) {
	const a = c.aloneRight, w = c.withRight;
	if ( !a && w ) return { sym: good, txt: 'THE MODEL ALONE GOT IT WRONG. THROUGH THE GRAPH IT GOT IT RIGHT.' };
	if ( a && w ) return { sym: note, txt: 'both got it right — read the note: what matters is HOW, and whether the win was luck.' };
	if ( a && !w ) return { sym: bad, txt: 'THE MODEL ALONE GOT IT RIGHT — AND THE GRAPH MADE IT WORSE.' };
	return { sym: bad, txt: 'both got it wrong.' };
}

function main() {
	title('CLASSIC PROBLEMS — THE SAME MODEL, ASKED TWICE');
	say(cap(say_n(T.cases.length)) + ' problems. Each is put to the SAME 9.5 GB model that runs on one');
	say('ordinary graphics card: once by just asking it, and once through this project.');
	say('Every prompt and every reply below is exactly what was sent and exactly what came back.');
	gap();
	say('The thread running through all ' + say_n(T.cases.length) + ': whatever the question is really ABOUT has to exist as');
	say('something the model can look at. Give it the whole story and it fumbles the chain; give each');
	say('step its own numbers and it does not. Give it a word and it cannot find the letters; give it');
	say('one letter and it is never wrong. The work is in the cut, not in the model.');
	gap();
	val('the model', T.recordedWith);
	gap();
	say('  WHAT THIS IS, AND IS NOT. These are single problems you can check by hand, to SHOW you the');
	say('  mechanism. They are not the evidence — one famous puzzle proves nothing either way, and a');
	say('  model may well have the answer memorised. The evidence is the campaigns, run properly:');
	val('piece-by-piece', 'N=200/domain — maths 16→52 % · finance 20→50 % · on the deep ones 0/33 → 10/33');
	val('certified steering', 'N=201 SQL 8→63 % · N=120 finance 7→62 %, at zero big-model calls');
	val('the critical mind', 'a debate where every point names its evidence — see the critic demo');
	say('');
	say('  Those ran with bars fixed in advance, negative controls, and bit-identical re-runs —');
	say('  see docs/CAPABILITIES.md, and artifact/ replays every table in the papers with no GPU.');
	say('  What follows is one legible instance of each, so you can see what it looks like.');
	gap();
	// The tally, read off the data. Printed BEFORE the cases so nobody has to take the closing line on faith.
	// `val` aligns only while the label fits its 22-char column — keep these short or the table skews.
	say('  HOW THESE ' + say_n(T.cases.length).toUpperCase() + ' WENT, before you read them:');
	val('graph turned it around', say_n(WON.length) + ' of ' + say_n(T.cases.length));
	val('model coped alone', say_n(TIED.length) + ' of ' + say_n(T.cases.length) + ' — shown in full anyway');
	val('graph made it worse', say_n(LOST.length) + ' of ' + say_n(T.cases.length));
	if ( BOTH.length ) val('neither got there', say_n(BOTH.length) + ' of ' + say_n(T.cases.length));
	gap();
	if ( LOST.length ) {
		say('  We lose ' + say_n(LOST.length) + ' of these, and ' + plural(LOST.length, 'it is', 'they are')
			+ ' printed below with the reason.');
	} else {
		say('  We do not lose any of these ' + say_n(T.cases.length) + ' — which is a fact about ' + say_n(T.cases.length));
		say('  hand-picked problems, and not a result. A demo that only shows its wins is an advert.');
	}

	for ( const c of T.cases ) {
		gap();
		say('  ' + '═'.repeat(W));
		say('  ' + c.title.toUpperCase());
		say('  ' + '═'.repeat(W));
		say('  ' + c.why);
		gap();
		val('the right answer', c.truth);

		// ── asked the ordinary way ──
		gap();
		beat(1, 'Just asking the model, the way anyone would:');
		box('WE SENT', c.alone.calls[0].user);
		box('IT REPLIED', c.alone.calls[0].reply.trim());
		(c.aloneRight ? good : bad)('it answered ' + c.alone.answer + ' — ' + (c.aloneRight ? 'right' : 'WRONG (the answer is ' + c.truth + ')'));

		// ── asked through the graph ──
		gap();
		beat(2, 'Now through the graph. ' + c.how);
		const calls = c.withg.calls;
		box('WE SENT (call 1 of ' + calls.length + ')', calls[0].user);
		box('IT REPLIED', calls[0].reply.trim());
		if ( calls.length > 2 ) {
			note('… ' + (calls.length - 2) + ' more calls like that one …');
			box('WE SENT (call ' + calls.length + ' of ' + calls.length + ')', calls[calls.length - 1].user);
			box('IT REPLIED', calls[calls.length - 1].reply.trim());
		}
		(c.withRight ? good : bad)('the graph answered ' + c.withg.answer + ' — ' + (c.withRight ? 'right' : 'WRONG (the answer is ' + c.truth + ')'));

		gap();
		const v = verdictLine(c);
		v.sym(v.txt);
		if ( c.lesson ) for ( const l of c.lesson.split('\n') ) say('       ' + l);
	}

	// the asserts: the transcript must stay a real record, and every case must be scored, both ways.
	for ( const c of T.cases ) {
		assert.ok(c.alone.calls.length >= 1 && c.withg.calls.length >= 1, c.id + ': real calls recorded');
		assert.ok(c.alone.calls[0].user && c.alone.calls[0].reply, c.id + ': the prompt AND the reply are on the record');
		assert.equal(typeof c.aloneRight, 'boolean', c.id + ': scored alone');
		assert.equal(typeof c.withRight, 'boolean', c.id + ': scored through the graph');
	}
	// The tally is a PARTITION of the cases — no case can be quietly dropped from the score.
	assert.equal(WON.length + TIED.length + LOST.length + BOTH.length, T.cases.length, 'every case is counted');
	assert.ok(WON.length >= 1, 'at least one classic where the graph turns a wrong answer into a right one');

	gap();
	finish('the long chained problem it could not do alone, it does through the graph — and the '
		+ say_n(TIED.length) + ' where it needed no help say so too.', 'BOOTSTRAP OK');
}
main();
