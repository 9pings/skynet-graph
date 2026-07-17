/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * _live — replays the REAL model exchanges recorded by `_record.js` on a real 9.5 GB local model.
 *
 * Why: an example that hands the graph pre-made facts never shows the thing the whole project is about —
 * what went to the model, and what came back. These are real prompts and real replies, printed verbatim;
 * the graph around them runs for real too. Deterministic, no GPU (that is what the recording is for).
 */
const fs = require('node:fs');
const path = require('node:path');
const { say, gap, note } = require('../_say.js');

const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'transcript.json'), 'utf8'));
const W = 88;

/** the recorded exchanges for one strategy */
const of = ( id ) => T.exchanges[id] || [];
const MODEL = T.recordedWith;

/** print one real exchange: what we sent, what the model sent back. */
function exchange( id, i, why ) {
	const e = of(id)[i];
	if ( !e ) return null;
	gap();
	say('   ┌─ WE SENT THE MODEL  (' + e.label + ') ' + '─'.repeat(Math.max(0, W - 26 - e.label.length)));
	wrap(e.user);
	say('   ├─ IT REPLIED ' + '─'.repeat(W - 15));
	wrap(e.reply);
	say('   └' + '─'.repeat(W - 1));
	if ( why ) note(why);
	return e;
}
function wrap( text ) {
	for ( const line of String(text).split('\n') ) {
		let s = line;
		if ( !s.length ) { say('   │'); continue; }
		while ( s.length > W - 4 ) { say('   │ ' + s.slice(0, W - 4)); s = '   ' + s.slice(W - 4); }
		say('   │ ' + s);
	}
}
/** the banner every live-backed demo opens with */
function liveBanner() {
	say('  Every prompt and reply below is REAL: recorded from ' + MODEL + '.');
	say('  The graph around them runs for real too — only the GPU is replaced by the recording.');
}

module.exports = { of, exchange, liveBanner, MODEL, wrap };
