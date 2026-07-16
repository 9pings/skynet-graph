'use strict';
/**
 * U3 — DEFEASIBLE RE-AGGREGATION (2026-06-27), closing finding #31. The E4 wedge retracts the BELIEF on
 * drift but the {__push}-aggregated SUMMARY stayed stale (#22). `defeasibleAggregate` fixes it ZERO-CORE:
 * a part's cleaner un-pushes + re-folds on retract, so belief AND summary are both defeasible. Negative
 * control: a part whose premise still holds is NOT removed, and re-adding it restores the summary.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { defeasibleAggregate } = require('../../lib/authoring/core/reaggregate.js');

const agg = defeasibleAggregate({ anchor: ( s ) => s._.partOf, valueKey: 'val', fold: ( xs ) => xs.reduce(( a, x ) => a + x.val, 0) });
const tree = { common: { childConcepts: {
	Part: { _id: 'Part', _name: 'Part', require: ['Segment', 'partOf'], ensure: ['$srcOk'], provider: ['A::part'], cleaner: ['A::unpart'] },
	Summary: { _id: 'Summary', _name: 'Summary', require: ['Anchor', 'contributions'], provider: ['A::summary'] }
} } };

function boot() {
	Graph._providers = { A: { part: agg.contribute, unpart: agg.uncontribute, summary: agg.summarize } };
	const seed = { lastRev: 0, nodes: [{ _id: 'anc', Anchor: true }], segments: [
		{ _id: 'p1', Segment: true, partOf: 'anc', val: 10, srcOk: true },
		{ _id: 'p2', Segment: true, partOf: 'anc', val: 20, srcOk: true },
		{ _id: 'p3', Segment: true, partOf: 'anc', val: 30, srcOk: true }
	] };
	return new Graph(seed, { label: 're', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
}

test('a retracted part re-aggregates the SUMMARY (not just the belief) — closes #31', async () => {
	const g = boot();
	await nextStable(g);
	assert.equal(g.getEtty('anc')._.summary, 60, 'initial fold of all three parts');

	await new Promise(( r ) => g.ingest([{ id: 'p2', fields: { srcOk: false } }], r));   // DRIFT on p2
	const anc = g.getEtty('anc')._;
	assert.equal(g.getEtty('p2')._.Part, undefined, 'the belief retracted (Part uncast) — the E4 wedge');
	assert.equal(anc.summary, 40, 'the SUMMARY re-aggregated to the live cast set (10+30) — #31 closed');
	assert.deepEqual(anc.contributions.map(( x ) => x.id).sort(), ['p1', 'p3'], 'only the live parts contribute');
});

test('NEGATIVE control: a part whose premise holds is untouched; re-adding a part restores the summary', async () => {
	const g = boot();
	await nextStable(g);
	await new Promise(( r ) => g.ingest([{ id: 'p2', fields: { srcOk: false } }], r));
	assert.equal(g.getEtty('anc')._.summary, 40);
	assert.equal(g.getEtty('p1')._.Part, true, 'a still-valid sibling is NOT collapsed (bounded)');
	// re-validate p2 → it re-casts and re-contributes → summary restored.
	await new Promise(( r ) => g.ingest([{ id: 'p2', fields: { srcOk: true } }], r));
	assert.equal(g.getEtty('p2')._.Part, true, 'p2 re-cast');
	assert.equal(g.getEtty('anc')._.summary, 60, 'summary restored to the full live set');
});
