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
 * Skynet-Graph logger — fs-free core.
 *
 * Lives in the engine (lib/graph/) so every engine file can require it without
 * pulling node:fs; all file/TTY sinks live in lib/sg/. This replaces the old
 * `var debug = console` indirection: same console-compatible call shape, but now
 * leveled, sinked, context-aware and per-graph.
 *
 * Levels (severity descending) — a record reaches sinks iff
 *   rank(record.level) <= rank(threshold):
 *     error(0) > warn(1) > log(2) > info(3) > verbose(4)
 *
 * A LogRecord { level, ts, label, ctx, msg, args } is JSON-serializable (Errors
 * in args are reduced to {name,message,stack}), so it crosses a worker_threads
 * boundary unchanged.
 *
 * child(ctx) returns a logger that shares the root's sinks / ring buffer / level
 * but merges ctx into every record. A concept-apply tags its logs with
 * { concept, target, applyId } this way, so they can be retrieved afterwards via
 * tail(n,{concept|applyId}) WITHOUT ever being stored on the graph objects.
 */

var LEVELS      = { error: 0, warn: 1, log: 2, info: 3, verbose: 4 };
var LEVEL_NAMES = ['error', 'warn', 'log', 'info', 'verbose'];

function rankOf ( name ) { return LEVELS[name] == null ? LEVELS.info : LEVELS[name]; }

// Reduce args to something JSON-serializable (Errors -> plain object, functions
// -> tag), so a record survives structured-clone across a worker boundary.
function sanitizeArgs ( args ) {
	return args.map(function ( a ) {
		if ( a instanceof Error ) return { name: a.name, message: a.message, stack: a.stack };
		if ( typeof a === 'function' ) return '[function ' + (a.name || 'anonymous') + ']';
		return a;
	});
}

function recordMatches ( rec, f ) {
	if ( !f ) return true;
	var c = rec.ctx || {};
	if ( f.level   != null && rec.level !== f.level )   return false;
	if ( f.concept != null && c.concept !== f.concept ) return false;
	if ( f.target  != null && c.target  !== f.target )  return false;
	if ( f.applyId != null && c.applyId !== f.applyId ) return false;
	return true;
}

// Default sink: format the record back into a console.<level>(...) call so the
// out-of-the-box behavior matches the old `debug = console` — but level-gated.
function consoleSink ( rec ) {
	var fn   = console[rec.level] || console.log;
	var head = '[' + rec.label + (rec.ctx && rec.ctx.concept ? '·' + rec.ctx.concept : '') + ']';
	fn.apply(console, [head, rec.msg].concat(rec.args || []));
}

/**
 * @param {object}   [opts]
 * @param {string}   [opts.label='graph']
 * @param {string}   [opts.level]        threshold; default env SG_LOG_LEVEL or 'warn'
 * @param {function} [opts.onRecord]     convenience sink fn(record)
 * @param {number}   [opts.capacity=500] ring-buffer size for tail()
 * @param {boolean}  [opts.console=true] install the default console sink
 * @returns {object} logger
 */
function createLogger ( opts ) {
	opts = opts || {};
	// shared mutable state — a child closes over the SAME state object as its root
	var state = {
		label: opts.label || 'graph',
		level: opts.level || (typeof process !== 'undefined' && process.env.SG_LOG_LEVEL) || 'warn',
		sinks: [],
		buf  : [],
		cap  : opts.capacity || 500
	};
	if ( opts.console !== false ) state.sinks.push(consoleSink);
	if ( opts.onRecord )          state.sinks.push(opts.onRecord);

	function make ( ctx ) {
		var logger = {};

		function emit ( level, msg, args ) {
			if ( rankOf(level) > rankOf(state.level) ) return;       // below threshold -> drop
			var rec = { level: level, ts: Date.now(), label: state.label, ctx: ctx, msg: msg, args: sanitizeArgs(args) };
			state.buf.push(rec);
			if ( state.buf.length > state.cap ) state.buf.shift();
			for ( var i = 0 ; i < state.sinks.length ; i++ ) {
				try { state.sinks[i](rec); } catch ( e ) { /* a broken sink must never break the engine */ }
			}
		}

		LEVEL_NAMES.forEach(function ( lvl ) {
			logger[lvl] = function ( msg ) { emit(lvl, msg, Array.prototype.slice.call(arguments, 1)); };
		});

		logger.child      = function ( extra ) { return make(Object.assign({}, ctx, extra)); };
		logger.addSink    = function ( fn ) { state.sinks.push(fn); return fn; };
		logger.removeSink = function ( fn ) { var i = state.sinks.indexOf(fn); if ( i >= 0 ) state.sinks.splice(i, 1); };
		logger.setLevel   = function ( name ) { if ( LEVELS[name] != null ) state.level = name; return state.level; };
		logger.tail       = function ( n, filter ) {
			var out = filter ? state.buf.filter(function ( r ) { return recordMatches(r, filter); }) : state.buf.slice();
			return n ? out.slice(-n) : out;
		};
		Object.defineProperty(logger, 'level',   { get: function () { return state.level; } });
		Object.defineProperty(logger, 'records', { get: function () { return state.buf.slice(); } });
		Object.defineProperty(logger, 'ctx',     { get: function () { return ctx; } });
		Object.defineProperty(logger, 'label',   { get: function () { return state.label; } });
		return logger;
	}

	return make(null);
}

// process-wide fallback for the rare engine spots with no graph in scope.
var defaultLogger = createLogger({ label: 'sg' });

module.exports = { createLogger: createLogger, defaultLogger: defaultLogger, LEVELS: LEVELS, LEVEL_NAMES: LEVEL_NAMES };
