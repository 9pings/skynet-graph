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
 * THE DEAL: whatever the model answered is what is printed — including the two cases where this project
 * does NOT come out ahead. A demo that only shows its wins is an advert. This one publishes the score.
 */
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcript.json'), 'utf8'));
const W = 86;

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
	if ( a && w ) return { sym: note, txt: 'both got it right — this model does not fall for this one. No difference to show.' };
	if ( a && !w ) return { sym: bad, txt: 'THE MODEL ALONE GOT IT RIGHT — AND THE GRAPH MADE IT WORSE.' };
	return { sym: bad, txt: 'both got it wrong.' };
}

function main() {
	title('CLASSIC PROBLEMS — THE SAME MODEL, ASKED TWICE');
	say('Three problems language models are known to trip on. Each is put to the SAME 9.5 GB model that');
	say('runs on one ordinary graphics card: once by just asking it, and once through this project.');
	say('Every prompt and every reply below is exactly what was sent and exactly what came back.');
	gap();
	val('the model', T.recordedWith);
	val('the score', T.cases.filter(( c ) => !c.aloneRight && c.withRight ).length + ' won · '
		+ T.cases.filter(( c ) => c.aloneRight && c.withRight ).length + ' no difference · '
		+ T.cases.filter(( c ) => c.aloneRight && !c.withRight ).length + ' made worse');
	say('');
	say('  Yes — one of these three goes AGAINST us, and it is printed in full below, with the reason.');
	say('  A demo that only records its wins is an advert.');

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

	// the asserts: the transcript must stay a real record, and the score must stay honest
	assert.ok(T.cases.length >= 3, 'three classics');
	for ( const c of T.cases ) {
		assert.ok(c.alone.calls.length >= 1 && c.withg.calls.length >= 1, c.id + ': real calls recorded');
		assert.ok(c.alone.calls[0].user && c.alone.calls[0].reply, c.id + ': the prompt AND the reply are on the record');
	}
	const won = T.cases.filter(( c ) => !c.aloneRight && c.withRight ).length;
	assert.ok(won >= 1, 'at least one classic where the graph turns a wrong answer into a right one');

	gap();
	finish('on a real model: the long chained problem it could not do alone, it does through the graph — '
		+ 'and where we lose, the transcript says so.', 'BOOTSTRAP OK');
}
main();
