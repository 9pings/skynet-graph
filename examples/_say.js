/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * _say — the examples' narrator.
 *
 * THE RULE: an example's output must be readable by someone who has never seen this codebase. No fact
 * names, no concept names, no JSON dumps — those live in the code, where a developer reads them with the
 * comments around them. The OUTPUT tells a person what happened and why it matters.
 *
 * The asserts remain the proof; this is only how the run narrates itself. Same text in your terminal and
 * on the website (scripts/build-site-demos.js captures this verbatim — one source of truth).
 *
 *   title('THE TO-DO LIST THAT KEEPS ITSELF')
 *   say('A question the model cannot answer alone.')
 *   step(1, 'The model asks to look up France.')
 *   note('the graph marks that call as pending — it is now on the list')
 *   good('the mark removed ITSELF. Nobody crossed it off.')
 *   bad('refused: the figure it needed is missing')
 *   done('You never maintain the list of pending calls. You ask the graph.')
 */

const W = 96;
const pad = ( s, n ) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

/** the demo's headline — what a reader should take away, in plain words. */
function title( t ) {
	console.log('');
	console.log('  ' + t);
	console.log('  ' + '─'.repeat(Math.min(W, t.length)));
}
/** a plain sentence of setup or narration. */
function say( t ) { console.log('  ' + t); }
/** a blank line — let it breathe. */
function gap() { console.log(''); }
/** a numbered beat in the story. */
function step( n, t ) { console.log('  ' + pad(n + '.', 4) + t); }
/** what the machine did in response — indented under its beat. */
function note( t ) { console.log('       → ' + t); }
/** something the machine got right / a guarantee holding. */
function good( t ) { console.log('       ✓ ' + t); }
/** a refusal or a stop — the interesting half of this project. */
function bad( t ) { console.log('       ✗ ' + t); }
/** a labelled value, aligned, when a number is the point. (always keeps ≥2 spaces, whatever the label) */
function val( label, v ) { console.log('       ' + pad(label, Math.max(24, String(label).length + 2)) + v); }
/** the closing line: what this proves, in one sentence a person can repeat. */
function done( t, marker ) {
	console.log('');
	console.log('  ' + (marker || 'OK') + ' — ' + t);
}

module.exports = { title, say, gap, step, note, good, bad, val, done };
