'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, LEVELS } = require('../../lib/graph/log.js');

function capture( level ) {
	const recs = [];
	const log = createLogger({ label: 't', level, console: false });
	log.addSink(( r ) => recs.push(r));
	return { log, recs };
}

test('threshold gates by severity rank (emit iff rank<=threshold)', () => {
	const { log, recs } = capture('warn');
	log.verbose('v'); log.info('i'); log.log('l'); log.warn('w'); log.error('e');
	assert.deepEqual(recs.map(( r ) => r.level), ['warn', 'error']);
});

test('child merges ctx into every record and shares parent sinks/buffer', () => {
	const { log, recs } = capture('verbose');
	const c = log.child({ concept: 'C', target: 's' });
	c.info('hi');
	assert.equal(recs.length, 1);
	assert.deepEqual(recs[0].ctx, { concept: 'C', target: 's' });
	assert.equal(recs[0].msg, 'hi');
});

test('addSink / removeSink', () => {
	const { log } = capture('verbose');
	const seen = [];
	const sink = ( r ) => seen.push(r.msg);
	log.addSink(sink); log.info('a'); log.removeSink(sink); log.info('b');
	assert.deepEqual(seen, ['a']);
});

test('tail returns last n and filters by ctx', () => {
	const { log } = capture('verbose');
	log.child({ concept: 'A', applyId: 1 }).info('x');
	log.child({ concept: 'B', applyId: 2 }).info('y');
	log.child({ concept: 'A', applyId: 3 }).info('z');
	assert.deepEqual(log.tail(2).map(( r ) => r.msg), ['y', 'z']);
	assert.deepEqual(log.tail(null, { concept: 'A' }).map(( r ) => r.msg), ['x', 'z']);
	assert.deepEqual(log.tail(null, { applyId: 2 }).map(( r ) => r.msg), ['y']);
});

test('ring buffer is bounded by capacity', () => {
	const log = createLogger({ label: 't', level: 'verbose', console: false, capacity: 3 });
	for ( let i = 0 ; i < 10 ; i++ ) log.info('m' + i);
	assert.deepEqual(log.records.map(( r ) => r.msg), ['m7', 'm8', 'm9']);
});

test('Error args are reduced to {name,message,stack} (JSON-safe)', () => {
	const { log, recs } = capture('verbose');
	log.error('boom', new Error('nope'));
	const a = recs[0].args[0];
	assert.equal(a.message, 'nope');
	assert.ok(typeof a.stack === 'string');
	assert.ok(!(a instanceof Error));
	JSON.stringify(recs[0]); // must not throw
});

test('setLevel changes the threshold at runtime', () => {
	const { log, recs } = capture('error');
	log.warn('drop'); log.setLevel('warn'); log.warn('keep');
	assert.deepEqual(recs.map(( r ) => r.msg), ['keep']);
});
