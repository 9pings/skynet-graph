'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createRetentionStore } = require('../../lib/authoring/retention');

test('retention — tracks reuse: a served get on a present key counts a use, has() does not', () => {
	const s = createRetentionStore(new Map());
	s.set('a', 1); s.set('b', 2);
	s.has('a');                       // a probe — not a reuse
	s.get('a'); s.get('a');           // two reuses
	s.get('b');                       // one reuse
	const u = s.usage();
	assert.equal(u.size, 2);
	assert.equal(u.reused, 2);        // a and b both reused
	assert.equal(u.byKey.find(( x ) => x.key === 'a' ).uses, 2);
	assert.equal(u.byKey.find(( x ) => x.key === 'b' ).uses, 1);
});

test('retention — DEAD WEIGHT: an entry never re-served past the grace window is evicted ("supprime ce qui n\'est jamais utilisé")', () => {
	const s = createRetentionStore(new Map(), { evictGrace: 2 });
	s.set('used', 1);
	s.get('used');                    // used → survives
	s.set('dead', 1);                 // never got
	// advance the clock past the grace with more sets (autoEvict runs on each set)
	s.set('x', 1); s.set('y', 1); s.set('z', 1);
	const u = s.usage();
	assert.equal(s.has('used'), true, 'a reused entry is never dead-weight-evicted');
	assert.equal(s.has('dead'), false, 'the never-used entry was evicted');
	assert.ok(u.evicted.deadWeight >= 1);
});

test('retention — BOUNDED: LRU eviction keeps the stock minimal past maxStock', () => {
	const s = createRetentionStore(new Map(), { maxStock: 2 });
	s.set('a', 1); s.get('a');        // a is recently used
	s.set('b', 1);
	s.set('c', 1);                    // over cap (3 > 2) → evict the LRU (b, since a was just used, c just added)
	assert.equal(s.size, 2);
	assert.equal(s.has('a'), true, 'the recently-used entry survives');
	assert.ok(s.evict().evicted.length >= 0);
	assert.ok(s.usage().evicted.lru >= 1);
});

test('retention — with NO rule it only MEASURES, never drops', () => {
	const s = createRetentionStore(new Map());
	for ( let i = 0; i < 10; i++ ) s.set('k' + i, i);   // none ever used
	assert.equal(s.size, 10, 'no eviction without a rule');
	assert.equal(s.usage().deadWeight, 10);
	assert.equal(s.usage().reuseRate, 0);
});

test('retention — reuseRate is the reused fraction of the live stock', () => {
	const s = createRetentionStore(new Map());
	s.set('a', 1); s.set('b', 1); s.set('c', 1); s.set('d', 1);
	s.get('a'); s.get('b');           // 2 of 4 reused
	assert.equal(s.usage().reuseRate, 0.5);
});

test('retention — deterministic replay (logical clock, no wall-clock)', () => {
	const run = () => { const s = createRetentionStore(new Map(), { evictGrace: 1 }); s.set('a', 1); s.get('a'); s.set('b', 1); s.set('c', 1); return JSON.stringify(s.usage().evicted); };
	assert.equal(run(), run(), 'same ops → identical eviction tally');
});
