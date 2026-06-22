'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../lib/sg/log-sinks.js');

const rec = ( over ) => Object.assign({ level: 'warn', ts: 0, label: 'sg', ctx: null, msg: 'hello', args: [] }, over);

test('formatLine renders time, padded level, label·ctx and message', () => {
	const line = S.formatLine(rec({ ctx: { concept: 'C', target: 's', type: 'segment' } }), false);
	assert.match(line, /WARN/);
	assert.match(line, /\[sg·C\/s:s\]/);
	assert.match(line, /hello$/);
});

test('formatLine appends sanitized Error stack', () => {
	const line = S.formatLine(rec({ args: [{ message: 'x', stack: 'Error: x\n at y' }] }), false);
	assert.match(line, /Error: x/);
});

test('plain sink writes one line per record to the stream', () => {
	const out = [];
	const sink = S.createPlainSink({ stream: { write: ( s ) => out.push(s) }, color: false, level: 'verbose' });
	sink(rec({ msg: 'a' })); sink(rec({ msg: 'b' }));
	assert.equal(out.length, 2);
	assert.match(out[0], /a\n$/);
});

test('plain sink drops records below its own level', () => {
	const out = [];
	const sink = S.createPlainSink({ stream: { write: ( s ) => out.push(s) }, color: false, level: 'warn' });
	sink(rec({ level: 'info', msg: 'drop' })); sink(rec({ level: 'error', msg: 'keep' }));
	assert.equal(out.length, 1);
	assert.match(out[0], /keep/);
});

test('mostPermissive picks the highest-rank (most verbose) level', () => {
	assert.equal(S.mostPermissive(['warn', 'verbose', 'info']), 'verbose');
	assert.equal(S.mostPermissive(['error', 'warn']), 'warn');
});

test('dashboard sink degrades to a plain sink when stream is not a TTY', () => {
	const out = [];
	const sink = S.createDashboardSink({ graph: {}, stream: { write: ( s ) => out.push(s), isTTY: false }, level: 'verbose' });
	sink(rec({ msg: 'x' }));
	assert.equal(out.length, 1); // behaves like plain
});
