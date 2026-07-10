'use strict';
/**
 * DEFEASANCE-UNDER-DRIFT wedge (decisive-experiment E4; study §7 differentiator). When an input premise is
 * invalidated via `ingest()`, the engine's JTMS retracts EXACTLY the affected belief (bounded cascade — siblings
 * intact, zero wasted re-derivation), so the engine's live belief stays CORRECT while a stored answer (RAG /
 * output-cache / CBR) is STALE. This is the differentiator no value-cache has.
 *
 * Honest limit pinned too (finding #31): the `{__push}`-aggregated SUMMARY does NOT auto-update (monotonic append +
 * a cast rollup doesn't re-fire on a value change, #22) — defeasible RE-aggregation is the study's A6/A7 open point.
 * The BELIEF (which parts hold) is defeasible; the cached summary is not.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { tree, seed } = require('../../../WIP/experiments/2026-06-27-decisive-experiment/E4-defeasance.js');
console.log = console.info = console.warn = () => {};

async function settle( g ) { for ( let i = 0; i < 200; i++ ) { await nextStable(g); if ( !g._unstable.length && !g._triggeredCastCount ) { await new Promise(( r ) => setImmediate(r)); if ( !g._unstable.length && !g._triggeredCastCount ) return; } } }

test('input invalidation → bounded JTMS retraction; engine belief correct, stored answer stale', async () => {
	let parts = 0;
	Graph._providers = { R: {
		part( g, c, scope, argz, cb ) { parts++; const v = scope._.val; cb(null, [ { $_id: '_parent', Part: true, result: 'derived(' + v + ')' }, { $$_id: 'report', findings: { __push: 'derived(' + v + ')' } } ]); },
		rollup( g, c, scope, argz, cb ) { const f = (scope._.findings || []).slice().sort(); cb(null, { $_id: '_parent', Rollup: true, answer: f.join(' + ') }); }
	} };
	const g = new Graph(seed(), { label: 'def', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
	await settle(g);
	const cast = ( id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
	const stored = g._objById['report']._etty._.answer;          // a RAG / output-cache snapshots this
	assert.ok(cast('p1', 'Part') && cast('p2', 'Part') && cast('p3', 'Part'), 'all three parts derived initially');
	assert.equal(parts, 3);

	const before = parts;
	await new Promise(( res ) => g.ingest({ p2: { status: 'recalled' } }, res));   // invalidate one premise
	await settle(g);

	// BOUNDED, correct retraction:
	assert.equal(cast('p2', 'Part'), false, 'the invalidated part retracts (JTMS)');
	assert.ok(cast('p1', 'Part') && cast('p3', 'Part'), 'siblings intact — bounded cascade');
	assert.equal(parts - before, 0, 'zero wasted re-derivation (p1/p3 not re-run)');

	// the engine's LIVE belief is correct; the stored answer is stale.
	const liveBelief = ['p1', 'p2', 'p3'].filter(( id ) => cast(id, 'Part')).map(( id ) => g._objById[id]._etty._.result).sort();
	assert.deepEqual(liveBelief, ['derived(A)', 'derived(C)'], 'live belief excludes the recalled B');
	assert.ok(stored.includes('derived(B)'), 'the stored answer is STALE (still asserts B) — the RAG/output-cache failure mode');

	// finding #31 (honest limit): the {__push} summary did NOT auto-update — defeasible re-aggregation is A6/A7.
	assert.ok((g._objById['report']._etty._.answer || '').includes('derived(B)'), 'the cast rollup summary is monotonic/stale (#31, A6/A7) — belief is defeasible, the cached summary is not');
});
