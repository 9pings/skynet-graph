/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * CLI log sinks — live in lib/sg/ because they touch fs/TTY and must stay out of
 * the fs-free engine core. A sink is fn(record); attach with graph.logger.addSink.
 *
 *   plain     : one clean line per record, no cursor control (pipe/CI friendly)
 *   dashboard : a fixed top stats pane + a scrolling log region (TTY only, zero-dep
 *               ANSI via a DECSTBM scroll region). Degrades to plain off a TTY.
 *   file      : append to a journal (.jsonl -> JSON lines, else formatted text)
 *
 * Per-sink level: the graph logger threshold is set to the MOST permissive level any
 * sink needs (records below it never reach any sink); each sink then drops what is
 * below its own level. This lets the file journal be verbose while the console is info.
 */
const fs = require('fs');
const util = require('util');
const { LEVELS } = require('../graph/log.js');

const PALETTE = { error: 31, warn: 33, log: 37, info: 36, verbose: 90 }; // ANSI fg codes

function passes ( level, threshold ) { return LEVELS[level] <= LEVELS[threshold]; }
function mostPermissive ( names ) { return names.reduce(function ( a, b ) { return LEVELS[b] > LEVELS[a] ? b : a; }); }

function two ( n ) { return (n < 10 ? '0' : '') + n; }
function hhmmss ( ts ) { var d = new Date(ts); return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); }

function ctxStr ( ctx ) {
	if ( !ctx ) return '';
	var bits = [];
	if ( ctx.concept ) bits.push(ctx.concept);
	if ( ctx.target )  bits.push((ctx.type ? ctx.type[0] + ':' : '') + ctx.target);
	return bits.length ? '·' + bits.join('/') : '';
}

// Render msg + args the way console does (printf %s/%d/%j, leftover args appended),
// so the engine's existing printf-style messages format correctly. Sanitized Errors
// ({message,stack}) are shown as their stack string rather than an inline object.
function formatBody ( rec ) {
	var args = (rec.args || []).map(function ( a ) { return (a && a.stack) ? a.stack : a; });
	return util.format.apply(util, [rec.msg].concat(args));
}

function formatLine ( rec, color ) {
	var head = hhmmss(rec.ts) + ' ' + rec.level.toUpperCase().padEnd(7) + ' [' + rec.label + ctxStr(rec.ctx) + '] ';
	var line = head + formatBody(rec);
	if ( color && PALETTE[rec.level] ) return '\x1b[' + PALETTE[rec.level] + 'm' + line + '\x1b[0m';
	return line;
}

function createPlainSink ( opts ) {
	opts = opts || {};
	var stream = opts.stream || process.stdout;
	var color  = opts.color != null ? opts.color : !!stream.isTTY;
	var min    = opts.level || 'verbose';
	return function ( rec ) { if ( passes(rec.level, min) ) stream.write(formatLine(rec, color) + '\n'); };
}

function createFileSink ( opts ) {
	var fd    = fs.openSync(opts.path, 'a');
	var jsonl = /\.jsonl$/i.test(opts.path);
	var min   = opts.level || 'verbose';
	return function ( rec ) {
		if ( !passes(rec.level, min) ) return;
		fs.writeSync(fd, (jsonl ? JSON.stringify(rec) : formatLine(rec, false)) + '\n');
	};
}

// Live snapshot of the graph's engine state for the status bar (pure / read-only).
function graphStats ( g ) {
	g = g || {};
	var unstable = g._unstable || [], nodes = 0, segs = 0, other = 0;
	for ( var i = 0 ; i < unstable.length ; i++ ) {
		var u = unstable[i], e = u && (u._etty ? u._etty._ : u._);
		if ( e && e.Node ) nodes++; else if ( e && e.Segment ) segs++; else other++;
	}
	// the main loop is _loopTF driven by _taskFlow; its pending work = queued tasks
	var tf = g._taskFlow || {};
	var queue = (tf.doAfter ? tf.doAfter.length : 0) + (tf.todo ? Math.max(0, tf.todo.length - (tf._pos || 0)) : 0);
	var stats = g._statsByProvider || {}, provMs = 0;
	for ( var k in stats ) provMs += stats[k];
	return {
		state   : g._stabilizing ? 'stabilizing' : (unstable.length ? 'pending' : 'stable'),
		unstable: unstable.length, nodes: nodes, segments: segs, other: other,
		pending : (g._pending || []).length, stable: (g._stable || []).length,
		queue   : queue, locks: tf.locks || 0,
		rev     : g._rev || 0, applies: g._applyId || 0, provMs: provMs
	};
}

// One-line status text (no positioning ANSI), padded/truncated to `width`.
function formatStatusBar ( g, width, elapsedS ) {
	var s = graphStats(g);
	var dot = s.state === 'stable' ? '●' : '◐';
	var parts = [
		dot + ' ' + s.state,
		'obj ' + (s.stable + s.unstable + s.pending),
		'unstable ' + s.unstable + ' (N' + s.nodes + '/S' + s.segments + (s.other ? '/?' + s.other : '') + ')',
		'queue ' + s.queue,
		'rev ' + s.rev,
		'applies ' + s.applies
	];
	if ( s.provMs )            parts.push('prov ' + (Math.round(s.provMs / 100) / 10) + 's');
	if ( elapsedS != null )    parts.push(elapsedS + 's');
	var line = ' ' + parts.join('  │  ') + ' ';
	width = width || 80;
	return line.length > width ? line.slice(0, width) : line + ' '.repeat(width - line.length);
}

// Styled boot banner: "SKYNET·GRAPH vX" + tagline (cyan/bold; plain if !color).
function banner ( version, color ) {
	var lines = [
		'  ⛓  SKYNET · GRAPH   v' + (version || '?'),
		'  rule-driven knowledge-graph reasoning substrate'
	];
	var w = Math.max(lines[0].length, lines[1].length) + 2;
	var bar = '─'.repeat(w);
	if ( !color ) return ['┌' + bar + '┐', '│' + lines[0] + ' '.repeat(w - lines[0].length) + '│',
		'│' + lines[1] + ' '.repeat(w - lines[1].length) + '│', '└' + bar + '┘'].join('\n');
	var C = '\x1b[1;36m', R = '\x1b[0m', D = '\x1b[2m';
	return [
		C + '┌' + bar + '┐' + R,
		C + '│' + R + lines[0] + ' '.repeat(w - lines[0].length) + C + '│' + R,
		C + '│' + R + D + lines[1] + R + ' '.repeat(w - lines[1].length) + C + '│' + R,
		C + '└' + bar + '┘' + R
	].join('\n');
}

/**
 * TTY dashboard: a live STATUS BAR kept at the bottom of the output over normal
 * COLORED scrolling logs (graph state, unstable nodes/segments, main-loop queue,
 * rev, applies, provider time, elapsed).
 *
 * Robust "reprint-in-place" technique (like npm/cargo progress bars) — NO scroll
 * region, NO absolute cursor positioning, NO save/restore (all of which are flaky
 * across WSL/tmux/embedded terminals and were flooding the scrollback): the bar is
 * always the LAST thing written and never gets a trailing newline, so the cursor
 * stays parked on it. To log: erase the bar line (`\r ESC[2K`), write the log line +
 * `\n` (the terminal scrolls naturally), then reprint the bar on the new last line.
 * A timer refreshes the bar in place. Off a TTY it degrades to a plain sink.
 */
function createDashboardSink ( opts ) {
	// either a static `graph` or a `getGraph()` (studio has many sessions → the active one)
	var getGraph = opts.getGraph || function () { return opts.graph; };
	var stream   = opts.stream || process.stdout;
	var min      = opts.level || 'verbose';
	if ( !stream.isTTY ) return createPlainSink({ stream: stream, level: min });   // degrade

	var start = Date.now(), timer = null, active = false;
	function cols () { return stream.columns || 80; }

	function barText () {
		var w = cols(), g = getGraph();
		var elapsed = Math.round((Date.now() - start) / 100) / 10;
		var line;
		if ( g ) line = formatStatusBar(g, w, elapsed);
		else { line = ' ◌ idle — no graph loaded   ' + elapsed + 's'; line = line.length > w ? line.slice(0, w) : line + ' '.repeat(w - line.length); }
		return '\x1b[7m' + line + '\x1b[0m';
	}
	function clearBarLine () { stream.write('\r\x1b[2K'); }            // col 0 + erase the whole line
	function drawBar () { clearBarLine(); stream.write(barText() + '\r'); }   // bar, cursor parked at its start (no newline)

	function mount () { active = true; drawBar(); timer = setInterval(drawBar, 250); if ( timer.unref ) timer.unref(); }

	function sink ( rec ) {
		if ( !active ) mount();
		if ( !passes(rec.level, min) ) return;
		clearBarLine();                               // wipe the bar off the last line
		stream.write(formatLine(rec, true) + '\n');   // print the log; the terminal scrolls
		drawBar();                                    // reprint the bar on the new last line
	}
	sink.close = function () {
		if ( timer ) { clearInterval(timer); timer = null; }
		if ( active ) { clearBarLine(); active = false; }   // remove the bar, leave a clean line
	};
	return sink;
}

// Log-only mode has no fixed bar, so stats are emitted into the log stream instead:
// a periodic info line with the same fields. (In dashboard mode the bar owns the stats
// and this is NOT used — stats never appear in the logs there.) Returns the timer.
function startStatsLogger ( logger, getGraph, intervalMs ) {
	var t = setInterval(function () {
		var g = getGraph && getGraph();
		if ( !g ) return;
		var s = graphStats(g);
		logger.info('stats — %s | unstable %s (N%s/S%s) | queue %s | rev %s | applies %s',
			s.state, s.unstable, s.nodes, s.segments, s.queue, s.rev, s.applies);
	}, intervalMs || 2000);
	if ( t.unref ) t.unref();
	return t;
}

module.exports = {
	createPlainSink, createFileSink, createDashboardSink, startStatsLogger,
	formatLine, formatBody, ctxStr, hhmmss, mostPermissive, passes,
	graphStats, formatStatusBar, banner
};
