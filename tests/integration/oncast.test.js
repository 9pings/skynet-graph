'use strict';
/**
 * onCast lifecycle hook (the standing-cluster keystone) — symmetric to `cleaner`. A live
 * source SUBSCRIBES on cast (onCast stores a handle on scope._liveHandles, off `_`) and TEARS
 * DOWN on uncast (cleaner closes it). Verifies the hook fires EXACTLY ONCE on the not-cast ->
 * cast transition (not on re-applies), that the cleaner closes the handle when the premise
 * falls, and that an uncast -> recast RE-fires onCast (re-subscribe). Core change (Concept.js
 * applyTo); the full suite stays green (default-off when no concept declares onCast).
 *
 * Roadmap: docs/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §7 (live regime).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

const etty = (g) => g._objById['truck']._etty;
const mem = (g) => g._objById['mem']._etty._;

test('onCast subscribes once on cast; cleaner tears down on uncast; recast re-subscribes', async () => {
	Graph._providers = {
		Live: {
			// onCast: (graph, concept, entity, argz, cb) — start the live subscription, store a handle
			subscribe( graph, concept, scope, argz, cb ) {
				scope._liveHandles = scope._liveHandles || {};
				scope._liveHandles[concept._name] = { open: true, on: scope._._id };   // off `_`, not serialized
				cb(null, { $$_id: 'mem', subs: { __push: scope._._id } });
			},
			// cleaner: (graph, concept, entity, argz, cb) — close the handle on uncast
			unsubscribe( graph, concept, scope, argz, cb ) {
				const h = scope._liveHandles && scope._liveHandles[concept._name];
				if ( h ) h.open = false;
				cb(null, { $$_id: 'mem', unsubs: { __push: scope._._id } });
			}
		}
	};
	const conceptMap = { common: { childConcepts: {
		// standing: cast while watching; onCast subscribes, cleaner unsubscribes. No provider -> default self-flag.
		Watcher: { _id: 'Watcher', _name: 'Watcher', require: 'truck', ensure: ['$watching'],
			onCast: ['Live::subscribe'], cleaner: ['Live::unsubscribe'] }
	} } };
	const seed = {
		lastRev: 0,
		freeNodes: [{ _id: 'mem', subs: [], unsubs: [] }],
		nodes: [{ _id: 'truck', truck: true, watching: true }],
		segments: []
	};

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('onCast lifecycle timed out at phase ' + phase)), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		const g = new Graph(seed, {
			label: 'oncast', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize( graph ) {
				try {
					if ( phase === 0 ) {
						phase = 1;
						assert.equal(etty(graph)._.Watcher, true, 'Watcher cast while watching');
						assert.equal(mem(graph).subs.length, 1, 'onCast fired EXACTLY once on cast (not per re-apply)');
						assert.ok(etty(graph)._liveHandles && etty(graph)._liveHandles.Watcher.open === true, 'a live handle is open (off `_`)');
						assert.equal(mem(graph).unsubs.length, 0, 'no teardown yet');
						graph.pushMutation({ $$_id: 'truck', watching: false }, 'truck');   // premise falls -> uncast
						if ( !graph._running ) graph._taskFlow.run();
					} else if ( phase === 1 ) {
						phase = 2;
						assert.ok(!etty(graph)._.Watcher, 'Watcher uncast when the premise fell');
						assert.equal(mem(graph).unsubs.length, 1, 'cleaner tore down the subscription on uncast');
						assert.equal(etty(graph)._liveHandles.Watcher.open, false, 'the live handle was closed');
						assert.equal(mem(graph).subs.length, 1, 'onCast did NOT re-fire spuriously');
						graph.pushMutation({ $$_id: 'truck', watching: true }, 'truck');    // re-cast
						if ( !graph._running ) graph._taskFlow.run();
					} else if ( phase === 2 ) {
						clearTimeout(timer);
						assert.equal(etty(graph)._.Watcher, true, 'Watcher re-cast');
						assert.equal(mem(graph).subs.length, 2, 'onCast RE-fired on recast (re-subscribe — symmetric with cleaner)');
						assert.equal(etty(graph)._liveHandles.Watcher.open, true, 'the handle is open again');
						resolve(true);
					}
				} catch ( e ) { fail(e); }
			}
		}, conceptMap);
	});
});
