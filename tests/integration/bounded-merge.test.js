'use strict';
/**
 * Enforcement gate — the BOUNDED `project` at a fork/merge JOIN (2026-06-27, Lens 3 / study §2.3). The
 * default `Graph#merge` crosses the WHOLE serialized child (forkResult) → re-creates the O(N) blowup;
 * `boundedProject` crosses only the declared frontier (Σ_sep). Negative control: the default leaks; the
 * bounded projection is leak-free per `validateMergeProjection`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { boundedProject, validate } = require('../../lib/authoring/bounded-merge.js');

function mkParent() {
	return new Graph({ lastRev: 0, nodes: [{ _id: 'root', Root: true }], segments: [] },
		{ label: 'parent', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, { common: { childConcepts: {} } });
}
// a child world with a small RESULT plus a lot of internal SCRATCH that must NOT cross the join.
function mkChildSeed() {
	return { lastRev: 0, nodes: [
		{ _id: 'result', answer: 42, cost: 3 },
		{ _id: 'scratch1', internal: 'x'.repeat(100) }, { _id: 'scratch2', internal: 'y'.repeat(100) }, { _id: 'scratch3', internal: 'z'.repeat(100) }
	], segments: [] };
}

test('boundedProject crosses ONLY the frontier; the default merge leaks the whole child', async () => {
	const parent = mkParent();
	await nextStable(parent);
	const child = parent.fork(mkChildSeed(), { label: 'child' });
	await nextStable(child);

	// bounded projection: only {answer, cost} cross onto root.
	const proj = boundedProject({ targetId: 'root', from: 'result', keys: ['answer', 'cost'] });
	const tpl = proj(child);
	assert.deepEqual(tpl, { $$_id: 'root', answer: 42, cost: 3 }, 'only the frontier facts cross');
	assert.ok(!/scratch|internal/.test(JSON.stringify(tpl)), 'no child-internal scratch crosses the join');

	// the default projection (whole serialized child) — the leak the gate exists to prevent.
	const dflt = { $$_id: 'root', forkResult: JSON.parse(child.serialize().graph) };
	assert.ok(JSON.stringify(dflt).length > 200, 'the default crosses the entire serialized child (big)');
	assert.ok(JSON.stringify(dflt.forkResult).includes('scratch') || JSON.stringify(dflt).includes('internal'), 'the default leaks internal scratch');

	// apply the bounded merge — root gets only the frontier facts.
	parent.merge(child, 'root', proj);
	await nextStable(parent);
	const r = parent.getEtty('root')._;
	assert.equal(r.answer, 42); assert.equal(r.cost, 3);
	assert.ok(!('forkResult' in r) && !('internal' in r), 'the parent never received the child body');
});

test('validate: the bounded projection is leak-free; the default is flagged (frontier-leak)', () => {
	const ok = validate([{ $$_id: 'root', answer: 42, cost: 3 }], ['answer', 'cost']);
	assert.equal(ok.ok, true, 'a projection within the alphabet passes');
	assert.equal(ok.leaks.length, 0);

	const leaky = validate([{ $$_id: 'root', answer: 42, forkResult: { huge: true } }], ['answer', 'cost']);
	assert.equal(leaky.ok, false, 'the whole-child default is flagged');
	assert.ok(leaky.leaks.some(( l ) => l.ref === 'forkResult'), 'forkResult is reported as a frontier leak');
});
