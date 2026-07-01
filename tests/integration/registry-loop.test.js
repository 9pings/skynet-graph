'use strict';
/**
 * G-1 — the AUTONOMOUS registry-convergence loop (the living catalog; sibling of relearn.js). The engine drives
 * borderline PROPOSAL → validated ring GROWTH as reactive concepts at the stabilize fixpoint, NO host glue: a proposal
 * deposited on a proxy node fires `RegistryMerge` → `Reg::merge` admits it via `mergeRingProposals` (member∈enum ∧
 * confluence re-checked) into a MUTABLE registry container → the ring grows + the version bumps. An invalid proposal is
 * rejected (registry unchanged) but still marks `merged` (no re-fire / no `divergent`). Real engine; each claim has a NEG.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { deriveRegistry, freezeRegistry, registryLoopTree, proposalTemplate, makeRegistryLoopProviders, resolveFactsSchema } = require('../../lib/authoring/registry.js');
console.log = console.info = console.warn = () => {};

// a starting registry: severity = {low, high}, NO ring yet (the exogenous vocab the loop will grow).
function startReg() {
	const tree = { childConcepts: { Sev: { _id: 'Sev', _name: 'Sev', require: ['Segment'], provider: ['LLM::complete'],
		prompt: { facts: { severity: { enum: ['low', 'high'] } }, prose: 's' } } } };
	return freezeRegistry(deriveRegistry(tree), 'v1');
}

async function boot( regBox, proposals ) {
	Graph._providers = Object.assign({}, Graph._providers, makeRegistryLoopProviders({ regBox }));
	// each proposal → a FRESH proxy node (a graph object carrying the proposal facts).
	const nodes = proposals.map(( p, i ) => Object.assign({ _id: 'reg_prop_' + i }, { proposalKey: p.key, proposalAlias: p.alias, proposalMember: p.member }));
	const g = new Graph({ lastRev: 0, nodes, segments: [] },
		{ label: 'reg-loop', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: registryLoopTree() });
	await nextStable(g);
	return g;
}

test('AUTONOMOUS admit — a valid proposal grows the ring + bumps the version, driven by the engine (no host glue)', async () => {
	const regBox = { registry: startReg() };
	const g = await boot(regBox, [{ key: 'severity', alias: 'severe', member: 'high' }]);
	// the reactive concept fired and admitted the alias into the MUTABLE registry container.
	assert.deepEqual(regBox.registry.keys.severity.synonyms.high, ['severe'], 'the alias joined the ring autonomously');
	assert.equal(regBox.registry.version, 'v2', 'the registry version bumped on admit');
	const node = g._objById['reg_prop_0']._etty._;
	// the concept fires ONCE then un-casts (the `!$merged` guard flips) → the marker is transient, the DATA facts persist
	// (the relearn pattern: assert the guard + outcome, not the transient cast marker).
	assert.equal(node.merged, true, 'the re-fire guard is set (the concept did its job and will not re-fire)');
	assert.equal(node.admitted, true);
	assert.ok(g.getRevisions().length < 50, 'bounded — no apply-cap runaway / divergent');
});

test('LIVING CATALOG — after the autonomous admit, the resolver snaps the NEW alias (the closure sees the grown ring)', async () => {
	const regBox = { registry: startReg() };
	// before: 'critical' is not in the ring → unresolved-as-such (canonValue would miss it).
	const before = resolveFactsSchema({ s: { ref: 'severity' } }, regBox.registry).facts.s;
	assert.ok(!(before.synonyms && before.synonyms.high && before.synonyms.high.includes('critical')), 'ring lacks "critical" before');
	await boot(regBox, [{ key: 'severity', alias: 'critical', member: 'high' }]);
	const after = resolveFactsSchema({ s: { ref: 'severity' } }, regBox.registry).facts.s;
	assert.ok(after.synonyms.high.includes('critical'), 'after the loop, the resolver sources the GROWN ring — the catalog is alive');
});

test('NEG — an INVALID proposal (member not in the enum) is rejected; registry unchanged; still merged (no divergence)', async () => {
	const regBox = { registry: startReg() };
	const v0 = regBox.registry.version;
	const g = await boot(regBox, [{ key: 'severity', alias: 'x', member: 'nope' }]);
	assert.equal(regBox.registry.version, v0, 'a rejected proposal does NOT bump the version');
	assert.deepEqual(regBox.registry.keys.severity.synonyms, undefined, 'the ring did not grow');
	const node = g._objById['reg_prop_0']._etty._;
	assert.equal(node.merged, true, 'still marked merged — no re-fire / no divergent');
	assert.equal(node.admitted, false);
	assert.match(node.rejectedReason, /member not in the enum/);
	assert.ok(g.getRevisions().length < 50, 'bounded');
});

test('NEG — a confluence-breaking proposal is rejected (the gate holds inside the reactive loop)', async () => {
	// seed a registry that already has severe↦high; then propose severe↦low (a collision) → rejected.
	const reg0 = startReg();
	reg0.keys.severity.synonyms = { high: ['severe'] };
	const regBox = { registry: reg0 };
	const g = await boot(regBox, [{ key: 'severity', alias: 'severe', member: 'low' }]);
	assert.deepEqual(regBox.registry.keys.severity.synonyms, { high: ['severe'] }, 'the ring is unchanged (collision refused)');
	const node = g._objById['reg_prop_0']._etty._;
	assert.equal(node.admitted, false);
	assert.match(node.rejectedReason, /confluence/);
});
