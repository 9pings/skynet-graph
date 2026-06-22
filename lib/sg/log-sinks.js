/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <@pp9ping@gmail.com>
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

/**
 * Split-screen TTY dashboard: a fixed top pane (graph stats) + a scrolling log
 * region below it. Uses a DECSTBM scroll region (ESC[top;bottom r) so the header
 * stays put while log lines scroll; the header is repainted on a timer and reads
 * live graph state. Returns a sink fn with a `.close()` that restores the terminal.
 * Off a TTY it transparently degrades to a plain sink.
 */
function createDashboardSink ( opts ) {
	var graph  = opts.graph;
	var stream = opts.stream || process.stdout;
	var min    = opts.level || 'verbose';
	if ( !stream.isTTY ) return createPlainSink({ stream: stream, level: min });   // degrade

	var HEADER = 6, start = Date.now(), timer = null, installed = false;
	function rows () { return stream.rows || 24; }
	function cols () { return stream.columns || 80; }
	function esc ( s ) { stream.write('\x1b[' + s); }

	function drawHeader () {
		var g = graph || {};
		var stats = g._statsByProvider || {};
		var provs = Object.keys(stats).map(function ( k ) { return k + ' ' + Math.round(stats[k] / 100) / 10 + 's'; }).join('  ');
		var lines = [
			'\x1b[1m sg · ' + (g.cfg ? g.cfg.label : 'graph') + '\x1b[0m  rev ' + (g._rev || 0) + '   elapsed ' + Math.round((Date.now() - start) / 100) / 10 + 's',
			' objects   stable ' + ((g._stable || []).length) + '   unstable ' + ((g._unstable || []).length) + '   pending ' + ((g._pending || []).length),
			' applies   id ' + (g._applyId || 0),
			' providers ' + (provs || '(none)'),
			' ' + '─'.repeat(Math.max(0, cols() - 2))
		];
		esc('s');                                              // save cursor (inside the scrolling log region)
		for ( var i = 0 ; i < HEADER - 1 ; i++ ) { esc((i + 1) + ';1H'); esc('2K'); stream.write((lines[i] || '').slice(0, cols())); }
		esc('u');                                              // restore cursor
	}

	function install () {
		installed = true;
		esc('2J');                                             // clear
		esc((HEADER + 1) + ';' + rows() + 'r');                // scroll region = lines below the header
		esc((HEADER + 1) + ';1H');                             // park cursor in the log region
		drawHeader();
		timer = setInterval(drawHeader, 100);
		if ( timer.unref ) timer.unref();
	}

	function sink ( rec ) {
		if ( !installed ) install();
		if ( passes(rec.level, min) ) stream.write(formatLine(rec, true) + '\r\n');   // '\n' scrolls within the region
	}
	sink.close = function () {
		if ( timer ) clearInterval(timer);
		if ( installed ) { esc('r'); esc(rows() + ';1H'); stream.write('\n'); }        // reset scroll region + cursor
	};
	return sink;
}

module.exports = {
	createPlainSink, createFileSink, createDashboardSink,
	formatLine, formatBody, ctxStr, hhmmss, mostPermissive, passes
};
