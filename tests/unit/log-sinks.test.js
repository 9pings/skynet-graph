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

test('graphStats reports state, unstable node/segment split, loop queue', () => {
	const g = {
		_stabilizing: false,
		_unstable: [{ _etty: { _: { Node: true } } }, { _etty: { _: { Segment: true } } }, { _etty: { _: { Segment: true } } }],
		_pending: [], _stable: [{}, {}],
		_taskFlow: { todo: [1, 2, 3], _pos: 1, doAfter: [9], locks: 1 },
		_rev: 7, _applyId: 12, _statsByProvider: { 'AI::x': 1500 }
	};
	const s = S.graphStats(g);
	assert.equal(s.state, 'pending');          // has unstable, not stabilizing
	assert.equal(s.unstable, 3);
	assert.equal(s.nodes, 1);
	assert.equal(s.segments, 2);
	assert.equal(s.queue, 1 /*doAfter*/ + 2 /*todo-_pos*/);
	assert.equal(s.rev, 7);
	assert.equal(s.applies, 12);
});

test('graphStats: empty unstable + not stabilizing => stable', () => {
	assert.equal(S.graphStats({ _unstable: [], _taskFlow: {} }).state, 'stable');
	assert.equal(S.graphStats({ _stabilizing: true, _unstable: [] }).state, 'stabilizing');
});

test('formatStatusBar pads to width and shows state + counts', () => {
	const line = S.formatStatusBar({ _unstable: [], _stable: [{}], _taskFlow: {}, _rev: 2 }, 120, 1.5);
	assert.equal(line.length, 120);
	assert.match(line, /stable/);
	assert.match(line, /rev 2/);
	assert.match(line, /1\.5s/);
});

test('formatStatusBar truncates to a narrow width', () => {
	const line = S.formatStatusBar({ _unstable: [], _stable: [], _taskFlow: {} }, 30);
	assert.equal(line.length, 30);
});

test('banner shows the version (plain + colored)', () => {
	assert.match(S.banner('1.2.3', false), /SKYNET · GRAPH   v1\.2\.3/);
	assert.match(S.banner('1.2.3', false), /^┌─+┐/);
	assert.match(S.banner('1.2.3', true), /\x1b\[/); // contains ANSI when colored
});

test('dashboard (fake TTY) draws a status bar and scrolls the log line', () => {
	const writes = [];
	const stream = { isTTY: true, rows: 10, columns: 60, write: ( s ) => writes.push(s) };
	const g = { _stabilizing: false, _unstable: [], _stable: [{}], _taskFlow: { todo: [], doAfter: [], _pos: 0 }, _rev: 4, _applyId: 0, _statsByProvider: {}, cfg: { label: 't' } };
	const sink = S.createDashboardSink({ graph: g, stream, level: 'verbose' });
	sink(rec({ msg: 'hello-world' }));
	const out = writes.join('');
	assert.match(out, /hello-world/);      // the log line scrolled normally
	assert.match(out, /stable/);           // the status bar was drawn
	assert.match(out, /\x1b\[7m/);         // reverse-video bar
	sink.close();
	assert.match(writes.join(''), /\x1b\[r/); // scroll region reset on close
});
