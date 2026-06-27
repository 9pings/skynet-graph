'use strict';
/**
 * REGRESSION — multiple ensure-gated concepts on ONE object must each retract independently.
 *
 * Bug (found 2026-06-27, fixed in Entity.js#updateApplicableConcepts): the ensure-watcher closure
 * captured `ensure` (a function-scoped `var` reassigned each loop iteration), so ALL of an object's
 * ensure-watchers ended up firing the LAST-processed concept's ensure. Earlier defeasible concepts
 * then never re-evaluated on their OWN gating fact's change — silent JTMS-retraction cross-wiring.
 * The same closure-over-var affected the `follow` (re-cast) path.
 *
 * This is load-bearing: objects routinely carry several defeasible concepts (the method/instance +
 * defeasance thesis). The fix captures the per-concept binding; this test pins it with both polarities
 * and a cross-wiring negative control.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
console.log = console.info = console.warn = () => {};

// Wait for TRUE quiescence: a cascade (A -> AChild) settles across >1 round and `stabilize` is a
// settle-hook that can re-fire (finding #13), so loop nextStable until no work survives a macrotask.
async function settle( g ) {
	for ( let i = 0; i < 50; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r));
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
}

function boot( childConcepts, seedNode ) {
	const g = new Graph(
		{ lastRev: 0, nodes: [seedNode], segments: [] },
		{ label: 'multiens', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts } }
	);
	return { g };
}

test('two ensure concepts on one object retract independently (closure-over-var regression)', async () => {
	let aRuns = 0, bRuns = 0;
	Graph._providers = { AI: {
		a( g, c, scope, argz, cb ) { aRuns++; cb(null, { $_id: '_parent', [c._name]: true }); },   // self-flag the CASTING concept (A or AChild)
		b( g, c, scope, argz, cb ) { bRuns++; cb(null, { $_id: '_parent', [c._name]: true }); }
	} };
	// A is declared FIRST (the broken case: A's watcher used to fire B's ensure). A has a cascading child.
	const tree = {
		A: { _id: 'A', _name: 'A', require: ['fa'], ensure: ['$fa == "on"'], provider: ['AI::a'],
			childConcepts: { AChild: { _id: 'AChild', _name: 'AChild', require: ['A'], provider: ['AI::a'] } } },
		B: { _id: 'B', _name: 'B', require: ['fb'], ensure: ['$fb == "on"'], provider: ['AI::b'] }
	};
	const { g } = boot(tree, { _id: 'n', fa: 'on', fb: 'on' });
	await settle(g);
	const e = () => g._objById['n']._etty;
	const cast = ( k ) => !!e()._mappedConcepts[k];
	assert.ok(cast('A') && cast('AChild') && cast('B'), 'fresh: A + AChild + B all cast');

	// flip A's OWN gating fact -> A must retract (this is the bug: it used to stay cast) + cascade its child
	g.pushMutation({ $$_id: 'n', fa: 'off' }, 'n'); await settle(g);
	assert.ok(!cast('A'), 'A retracts on its own fact change (was the cross-wiring bug)');
	assert.ok(!cast('AChild'), 'A child cascade-retracts');
	assert.ok(cast('B'), 'NEGATIVE CONTROL: B (the last-processed concept) is unaffected by A flipping');

	// flip A back on -> A re-casts (the follow/re-cast path, also closure-fixed) + its child
	g.pushMutation({ $$_id: 'n', fa: 'on' }, 'n'); await settle(g);
	assert.ok(cast('A') && cast('AChild'), 'A re-casts when its fact returns');

	// flip B's OWN gating fact -> B retracts, A unaffected (symmetric control)
	g.pushMutation({ $$_id: 'n', fb: 'off' }, 'n'); await settle(g);
	assert.ok(!cast('B'), 'B retracts on its own fact change');
	assert.ok(cast('A') && cast('AChild'), 'NEGATIVE CONTROL: A unaffected by B flipping');
});
