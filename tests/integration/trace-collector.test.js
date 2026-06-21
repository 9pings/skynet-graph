'use strict';
/**
 * Trace collector + render helpers (the `sg` CLI's engine). createTrace() collects
 * onConceptApply records during a run; the render helpers turn them into the views
 * the CLI prints (table, per-concept rollup, single-record detail); toArtifact()
 * bundles records + a graph snapshot for post-hoc inspection.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
const { createTrace, summarizeTrace, perConcept, formatRecord } = require('../../_lab/trace.js');
console.log = console.info = console.warn = () => {};

function run() {
	Graph._providers = { AI: { work(graph, concept, scope, argz, cb) { cb(null, { $_id: '_parent', Worked: true, result: 7 }); } } };
	const conceptMap = {
		common: {
			childConcepts: {
				Flag: { _id: 'Flag', _name: 'Flag', require: 'Segment' },
				Worked: { _id: 'Worked', _name: 'Worked', require: 'Segment', provider: ['AI::work'] }
			}
		}
	};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b' }] };
	const trace = createTrace();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('collector run timed out')), 15000);
		let done = false;
		const g = new Graph(seed, {
			label: 'col', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onConceptApply: trace.onConceptApply,
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve({ g, trace }); }
		}, conceptMap);
	});
}

test('createTrace collects records and renders table / per-concept / detail / artifact', async () => {
	const { g, trace } = await run();

	assert.ok(trace.records.length >= 2, 'collected concept-apply records');

	const rows = summarizeTrace(trace.records);
	assert.equal(rows.length, trace.records.length, 'one summary row per record');
	const r0 = rows[0];
	for (const k of ['n', 'rev', 'concept', 'target', 'kind', 'patch', 'ms']) assert.ok(k in r0, `row has ${k}`);
	assert.equal(typeof r0.patch, 'string', 'patch summarized to a string');

	const byC = perConcept(trace.records);
	assert.ok(Array.isArray(byC) && byC[0].count >= 1 && 'totalMs' in byC[0], 'per-concept rollup with count + totalMs');
	const worked = byC.find((c) => c.concept === 'Worked');
	assert.ok(worked, 'Worked concept in rollup');

	const detail = formatRecord(trace.records.find((r) => r.conceptName === 'Worked'));
	assert.ok(/Worked/.test(detail) && /result/.test(detail), 'detail shows concept + patch');

	const art = trace.toArtifact(g, { label: 'col' });
	assert.ok(art.records && art.snapshot && art.meta, 'artifact has records + snapshot + meta');
	assert.ok(typeof art.snapshot.graph === 'string', 'snapshot is a serialize() result');
	assert.deepEqual(JSON.parse(JSON.stringify(art)).records.length, trace.records.length, 'artifact is JSON-serializable');
});
